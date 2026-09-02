import { randomBytes } from 'crypto';
import {
  OPERATION_ID_PATTERN,
  generateOperationId,
  isValidOperationId,
  assertValidOperationId,
  deriveEphemeralAdminUsername,
  deriveEphemeralSecretName,
  deriveEphemeralJobName,
  deriveOperationResourceNames,
  assertValidTransition,
  IllegalOperationTransitionError,
  classifyCleanupState,
  isCleanupComplete,
  classifyFinalOutcome,
  type OperationState,
  type CleanupResourceState,
} from './hardener-operation';

const nodeCryptoSource = { randomBytes: (n: number) => new Uint8Array(randomBytes(n)) };

describe('generateOperationId', () => {
  it('produces exactly 12 lowercase hex characters', () => {
    const id = generateOperationId(nodeCryptoSource);
    expect(id).toMatch(OPERATION_ID_PATTERN);
    expect(id).toHaveLength(12);
    expect(id).toBe(id.toLowerCase());
  });

  it('is collision-resistant across many generations (statistical, not a proof)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) {
      seen.add(generateOperationId(nodeCryptoSource));
    }
    expect(seen.size).toBe(5000);
  });

  it('throws instead of returning a malformed id if the randomness source is broken', () => {
    const brokenSource = { randomBytes: () => new Uint8Array(0) };
    expect(() => generateOperationId(brokenSource)).toThrow();
  });

  it('never contains characters outside [0-9a-f] regardless of byte values', () => {
    const allFF = { randomBytes: (n: number) => new Uint8Array(n).fill(0xff) };
    const id = generateOperationId(allFF);
    expect(id).toBe('ffffffffffff');
    expect(id).toMatch(OPERATION_ID_PATTERN);
  });
});

describe('isValidOperationId / assertValidOperationId', () => {
  it.each(['0123456789ab', 'ffffffffffff', '000000000000'])('accepts valid id %s', (id) => {
    expect(isValidOperationId(id)).toBe(true);
    expect(() => assertValidOperationId(id)).not.toThrow();
  });

  it.each([
    'ABCDEF012345', // mayúsculas
    '0123456789a', // 11 chars
    '0123456789abc', // 13 chars
    '0123456789ag', // 'g' no es hex
    '', // vacío
    'DROP TABLE x', // intento de inyección obvio
    "'; --", // idem
    undefined,
    null,
    123456789012,
  ])('rejects invalid id %p', (bad) => {
    expect(isValidOperationId(bad)).toBe(false);
    expect(() => assertValidOperationId(bad)).toThrow();
  });
});

describe('nombres derivados', () => {
  const id = 'a1b2c3d4e5f6';

  it('deriveEphemeralAdminUsername tiene el prefijo exacto y longitud dentro de límites de Postgres/Cloud SQL', () => {
    const name = deriveEphemeralAdminUsername(id);
    expect(name).toBe(`korixa_db_hardener_once_${id}`);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^[a-z_][a-z0-9_]*$/);
  });

  it('deriveEphemeralSecretName tiene el prefijo exacto y respeta charset/longitud de Secret Manager', () => {
    const name = deriveEphemeralSecretName(id);
    expect(name).toBe(`korixa-production-db-hardener-once-${id}`);
    expect(name.length).toBeLessThanOrEqual(255);
    expect(name).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('deriveEphemeralJobName es distinto del Job persistente legado y respeta el límite de 63 de Cloud Run', () => {
    const name = deriveEphemeralJobName(id);
    expect(name).not.toBe('korixa-production-db-role-hardener');
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });

  it('las tres funciones son deterministas — mismo operation_id siempre produce los mismos tres nombres', () => {
    expect(deriveEphemeralAdminUsername(id)).toBe(deriveEphemeralAdminUsername(id));
    expect(deriveEphemeralSecretName(id)).toBe(deriveEphemeralSecretName(id));
    expect(deriveEphemeralJobName(id)).toBe(deriveEphemeralJobName(id));
  });

  it('deriveOperationResourceNames agrupa los tres de forma consistente', () => {
    const names = deriveOperationResourceNames(id);
    expect(names).toEqual({
      operationId: id,
      ephemeralAdminUsername: `korixa_db_hardener_once_${id}`,
      ephemeralSecretName: `korixa-production-db-hardener-once-${id}`,
      ephemeralJobName: `korixa-prod-hardener-once-${id}`,
    });
  });

  it('rechaza un operation_id inválido antes de derivar cualquier nombre — nunca deriva de basura', () => {
    expect(() => deriveEphemeralAdminUsername('not-hex!!')).toThrow();
    expect(() => deriveEphemeralSecretName('not-hex!!')).toThrow();
    expect(() => deriveEphemeralJobName('not-hex!!')).toThrow();
    expect(() => deriveOperationResourceNames('not-hex!!')).toThrow();
  });

  it('dos operation_id distintos nunca producen el mismo nombre derivado', () => {
    const other = 'ffffffffffff';
    expect(deriveEphemeralAdminUsername(id)).not.toBe(deriveEphemeralAdminUsername(other));
    expect(deriveEphemeralSecretName(id)).not.toBe(deriveEphemeralSecretName(other));
  });
});

describe('máquina de estados de la operación (Phase 13)', () => {
  const HAPPY_PATH: OperationState[] = [
    'NOT_STARTED',
    'BOOTSTRAPPING',
    'PREFLIGHT_READY',
    'WAITING_APPLY_GATE',
    'APPLYING',
    'TARGET_SQL_HARDENED',
    'TARGET_CLOUDSQL_ROLE_REMOVED',
    'VERIFIED',
    'CLEANING',
    'CLEAN',
  ];

  it('el camino feliz completo es una secuencia de transiciones válidas', () => {
    for (let i = 0; i < HAPPY_PATH.length - 1; i += 1) {
      expect(() => assertValidTransition(HAPPY_PATH[i]!, HAPPY_PATH[i + 1]!)).not.toThrow();
    }
  });

  it('CLEAN es terminal — ninguna transición posterior es válida, ni siquiera hacia HOLD', () => {
    expect(() => assertValidTransition('CLEAN', 'HOLD')).toThrow(IllegalOperationTransitionError);
    expect(() => assertValidTransition('CLEAN', 'BOOTSTRAPPING')).toThrow(IllegalOperationTransitionError);
  });

  it('HOLD es alcanzable desde cualquier estado no terminal', () => {
    for (const state of HAPPY_PATH) {
      if (state === 'CLEAN') continue;
      expect(() => assertValidTransition(state, 'HOLD')).not.toThrow();
    }
  });

  it('HOLD solo puede avanzar hacia CLEANING (cleanup_only) — nunca reanuda la operación original', () => {
    expect(() => assertValidTransition('HOLD', 'CLEANING')).not.toThrow();
    expect(() => assertValidTransition('HOLD', 'APPLYING')).toThrow(IllegalOperationTransitionError);
    expect(() => assertValidTransition('HOLD', 'BOOTSTRAPPING')).toThrow(IllegalOperationTransitionError);
  });

  it('nunca se puede saltar preflight -> apply sin pasar por WAITING_APPLY_GATE', () => {
    expect(() => assertValidTransition('PREFLIGHT_READY', 'APPLYING')).toThrow(IllegalOperationTransitionError);
  });

  it('nunca se puede retroceder (p. ej. de APPLYING de vuelta a PREFLIGHT_READY)', () => {
    expect(() => assertValidTransition('APPLYING', 'PREFLIGHT_READY')).toThrow(IllegalOperationTransitionError);
    expect(() => assertValidTransition('VERIFIED', 'APPLYING')).toThrow(IllegalOperationTransitionError);
  });

  it('nunca se puede saltar la remoción de cloudsqlsuperuser del target antes de verificar', () => {
    expect(() => assertValidTransition('TARGET_SQL_HARDENED', 'VERIFIED')).toThrow(IllegalOperationTransitionError);
  });
});

describe('máquina de estados de cleanup (Phase 11)', () => {
  const NONE: CleanupResourceState = {
    targetAdminOptionRevoked: false,
    ephemeralAdminDeleted: false,
    ephemeralSecretDisabled: false,
    ephemeralIamBindingRemoved: false,
  };

  it('CLEANUP_STATE_0 cuando nada fue revocado todavía', () => {
    expect(classifyCleanupState(NONE, false)).toBe('CLEANUP_STATE_0');
  });

  it('progresa exactamente en el orden A -> B -> C -> D -> verificación', () => {
    expect(classifyCleanupState({ ...NONE, targetAdminOptionRevoked: true }, false)).toBe('CLEANUP_STATE_1');
    expect(
      classifyCleanupState({ ...NONE, targetAdminOptionRevoked: true, ephemeralAdminDeleted: true }, false),
    ).toBe('CLEANUP_STATE_2');
    expect(
      classifyCleanupState(
        { ...NONE, targetAdminOptionRevoked: true, ephemeralAdminDeleted: true, ephemeralSecretDisabled: true },
        false,
      ),
    ).toBe('CLEANUP_STATE_3');
    expect(
      classifyCleanupState(
        {
          targetAdminOptionRevoked: true,
          ephemeralAdminDeleted: true,
          ephemeralSecretDisabled: true,
          ephemeralIamBindingRemoved: true,
        },
        false,
      ),
    ).toBe('CLEANUP_STATE_4');
  });

  it('CLEANUP_STATE_5 solo cuando los 4 recursos están limpios Y la verificación independiente pasó', () => {
    const allDone: CleanupResourceState = {
      targetAdminOptionRevoked: true,
      ephemeralAdminDeleted: true,
      ephemeralSecretDisabled: true,
      ephemeralIamBindingRemoved: true,
    };
    expect(classifyCleanupState(allDone, false)).toBe('CLEANUP_STATE_4');
    expect(classifyCleanupState(allDone, true)).toBe('CLEANUP_STATE_5');
    expect(isCleanupComplete(classifyCleanupState(allDone, true))).toBe(true);
  });

  it('un solo recurso pendiente, sin importar cuál, nunca reporta CLEANUP_STATE_5', () => {
    const partial: CleanupResourceState = {
      targetAdminOptionRevoked: true,
      ephemeralAdminDeleted: true,
      ephemeralSecretDisabled: true,
      ephemeralIamBindingRemoved: false, // solo este falta
    };
    expect(isCleanupComplete(classifyCleanupState(partial, true))).toBe(false);
  });
});

describe('classifyFinalOutcome — Phase 11, la clasificación más importante de todas', () => {
  it('éxito + cleanup completo -> SUCCESS_AND_CLEAN', () => {
    expect(classifyFinalOutcome(true, 'CLEANUP_STATE_5')).toBe('SUCCESS_AND_CLEAN');
  });

  it('falla de operación + cleanup completo -> FAILED_BUT_CLEAN (no privilegios huérfanos)', () => {
    expect(classifyFinalOutcome(false, 'CLEANUP_STATE_5')).toBe('FAILED_BUT_CLEAN');
  });

  it('20. la falla de operación NUNCA se esconde detrás de un cleanup incompleto — máxima severidad', () => {
    expect(classifyFinalOutcome(false, 'CLEANUP_STATE_2')).toBe(
      'HOLD_OPERATION_FAILED_AND_PRIVILEGED_CLEANUP_INCOMPLETE',
    );
    expect(classifyFinalOutcome(false, 'CLEANUP_STATE_0')).toBe(
      'HOLD_OPERATION_FAILED_AND_PRIVILEGED_CLEANUP_INCOMPLETE',
    );
  });

  it('éxito de operación pero cleanup incompleto también es HOLD, nunca un éxito silencioso', () => {
    expect(classifyFinalOutcome(true, 'CLEANUP_STATE_3')).toBe('HOLD_CLEANUP_INCOMPLETE');
    expect(classifyFinalOutcome(true, 'CLEANUP_STATE_0')).toBe('HOLD_CLEANUP_INCOMPLETE');
  });
});
