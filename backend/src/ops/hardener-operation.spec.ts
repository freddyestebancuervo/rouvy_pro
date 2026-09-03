import { randomBytes } from 'crypto';
import {
  OPERATION_ID_PATTERN,
  EPHEMERAL_ADMIN_USERNAME_PATTERN,
  generateOperationId,
  isValidOperationId,
  assertValidOperationId,
  deriveEphemeralAdminUsername,
  deriveEphemeralDsnSecretName,
  deriveEphemeralJobName,
  deriveOperationResourceNames,
  assertValidTransition,
  IllegalOperationTransitionError,
  hasZeroPrivilegedResources,
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

  it('EPHEMERAL_ADMIN_USERNAME_PATTERN acepta exactamente lo que deriveEphemeralAdminUsername produce, y rechaza cualquier otra cosa', () => {
    expect(deriveEphemeralAdminUsername(id)).toMatch(EPHEMERAL_ADMIN_USERNAME_PATTERN);
    for (const bad of [
      'korixa_app', // el rol objetivo, nunca un admin efímero
      'postgres',
      'korixa_db_hardener_once_', // sin sufijo
      'korixa_db_hardener_once_ABCDEF012345', // mayúsculas
      'korixa_db_hardener_once_0123456789a', // 11 hex
      "korixa_db_hardener_once_0123456789ab'; DROP TABLE x; --", // intento de inyección
      '',
    ]) {
      expect(bad).not.toMatch(EPHEMERAL_ADMIN_USERNAME_PATTERN);
    }
  });

  it('deriveEphemeralDsnSecretName tiene el prefijo exacto y respeta charset/longitud de Secret Manager', () => {
    const name = deriveEphemeralDsnSecretName(id);
    expect(name).toBe(`korixa-production-db-hardener-dsn-${id}`);
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
    expect(deriveEphemeralDsnSecretName(id)).toBe(deriveEphemeralDsnSecretName(id));
    expect(deriveEphemeralJobName(id)).toBe(deriveEphemeralJobName(id));
  });

  it('deriveOperationResourceNames agrupa los tres de forma consistente (PR #115 P1-B: sin secret de password)', () => {
    const names = deriveOperationResourceNames(id);
    expect(names).toEqual({
      operationId: id,
      ephemeralAdminUsername: `korixa_db_hardener_once_${id}`,
      ephemeralDsnSecretName: `korixa-production-db-hardener-dsn-${id}`,
      ephemeralJobName: `korixa-prod-hardener-once-${id}`,
    });
  });

  it('rechaza un operation_id inválido antes de derivar cualquier nombre — nunca deriva de basura', () => {
    expect(() => deriveEphemeralAdminUsername('not-hex!!')).toThrow();
    expect(() => deriveEphemeralDsnSecretName('not-hex!!')).toThrow();
    expect(() => deriveEphemeralJobName('not-hex!!')).toThrow();
    expect(() => deriveOperationResourceNames('not-hex!!')).toThrow();
  });

  it('dos operation_id distintos nunca producen el mismo nombre derivado', () => {
    const other = 'ffffffffffff';
    expect(deriveEphemeralAdminUsername(id)).not.toBe(deriveEphemeralAdminUsername(other));
    expect(deriveEphemeralDsnSecretName(id)).not.toBe(deriveEphemeralDsnSecretName(other));
  });
});

describe('máquina de estados de la operación (PR #115 zero-standing-privilege remediation, Phase 8)', () => {
  const HAPPY_PATH: OperationState[] = [
    'PREFLIGHT_NOT_STARTED',
    'PREFLIGHT_BOOTSTRAPPING',
    'PREFLIGHT_RUNNING',
    'PREFLIGHT_EVIDENCE_CAPTURED',
    'PREFLIGHT_CLEANING',
    'PREFLIGHT_CLEAN',
    'WAITING_FOR_APPLY_HUMAN_GATE',
    'APPLY_BOOTSTRAPPING',
    'APPLY_FRESH_PREFLIGHT',
    'APPLYING',
    'TARGET_CLOUDSQL_ROLE_REMOVED',
    'VERIFYING',
    'APPLY_CLEANING',
    'CLEAN',
  ];

  it('el camino feliz completo (stage 1 -> gate -> stage 2) es una secuencia de transiciones válidas', () => {
    for (let i = 0; i < HAPPY_PATH.length - 1; i += 1) {
      expect(() => assertValidTransition(HAPPY_PATH[i]!, HAPPY_PATH[i + 1]!)).not.toThrow();
    }
  });

  it('CLEAN es terminal — ninguna transición posterior es válida, ni siquiera hacia HOLD', () => {
    expect(() => assertValidTransition('CLEAN', 'HOLD')).toThrow(IllegalOperationTransitionError);
    expect(() => assertValidTransition('CLEAN', 'PREFLIGHT_BOOTSTRAPPING')).toThrow(IllegalOperationTransitionError);
  });

  it('HOLD es alcanzable desde cualquier estado no terminal excepto PREFLIGHT_CLEAN y WAITING_FOR_APPLY_HUMAN_GATE (nada puede fallar ahí — no hay recurso privilegiado activo)', () => {
    const statesWithoutPrivilegedRisk = new Set<OperationState>(['PREFLIGHT_CLEAN', 'WAITING_FOR_APPLY_HUMAN_GATE', 'CLEAN']);
    for (const state of HAPPY_PATH) {
      if (statesWithoutPrivilegedRisk.has(state)) continue;
      expect(() => assertValidTransition(state, 'HOLD')).not.toThrow();
    }
  });

  it('HOLD solo puede avanzar hacia PREFLIGHT_CLEANING o APPLY_CLEANING (cleanup_only) — nunca reanuda la operación original', () => {
    expect(() => assertValidTransition('HOLD', 'PREFLIGHT_CLEANING')).not.toThrow();
    expect(() => assertValidTransition('HOLD', 'APPLY_CLEANING')).not.toThrow();
    expect(() => assertValidTransition('HOLD', 'APPLYING')).toThrow(IllegalOperationTransitionError);
    expect(() => assertValidTransition('HOLD', 'PREFLIGHT_BOOTSTRAPPING')).toThrow(IllegalOperationTransitionError);
  });

  it('nunca se puede saltar preflight -> apply sin pasar por WAITING_FOR_APPLY_HUMAN_GATE', () => {
    expect(() => assertValidTransition('PREFLIGHT_EVIDENCE_CAPTURED', 'APPLY_BOOTSTRAPPING')).toThrow(
      IllegalOperationTransitionError,
    );
    expect(() => assertValidTransition('PREFLIGHT_CLEAN', 'APPLYING')).toThrow(IllegalOperationTransitionError);
  });

  it('la limpieza de stage 1 nunca puede saltearse — PREFLIGHT_EVIDENCE_CAPTURED solo avanza hacia PREFLIGHT_CLEANING (o HOLD), nunca directo a WAITING_FOR_APPLY_HUMAN_GATE, sin importar si el preflight fue PASS o FAIL', () => {
    expect(() => assertValidTransition('PREFLIGHT_EVIDENCE_CAPTURED', 'WAITING_FOR_APPLY_HUMAN_GATE')).toThrow(
      IllegalOperationTransitionError,
    );
  });

  it('stage 2 nunca puede reutilizar la identidad de stage 1 — WAITING_FOR_APPLY_HUMAN_GATE solo avanza hacia APPLY_BOOTSTRAPPING (bootstrap de una identidad NUEVA), nunca directo a APPLYING', () => {
    expect(() => assertValidTransition('WAITING_FOR_APPLY_HUMAN_GATE', 'APPLYING')).toThrow(
      IllegalOperationTransitionError,
    );
  });

  it('el fresh preflight de stage 2 es obligatorio — APPLY_BOOTSTRAPPING solo avanza hacia APPLY_FRESH_PREFLIGHT (o HOLD), nunca directo a APPLYING', () => {
    expect(() => assertValidTransition('APPLY_BOOTSTRAPPING', 'APPLYING')).toThrow(IllegalOperationTransitionError);
  });

  it('nunca se puede retroceder (p. ej. de APPLYING de vuelta a APPLY_FRESH_PREFLIGHT, o de VERIFYING de vuelta a APPLYING)', () => {
    expect(() => assertValidTransition('APPLYING', 'APPLY_FRESH_PREFLIGHT')).toThrow(IllegalOperationTransitionError);
    expect(() => assertValidTransition('VERIFYING', 'APPLYING')).toThrow(IllegalOperationTransitionError);
  });

  it('nunca se puede saltar la remoción de cloudsqlsuperuser del target antes de verificar', () => {
    expect(() => assertValidTransition('APPLYING', 'VERIFYING')).toThrow(IllegalOperationTransitionError);
  });
});

describe('hasZeroPrivilegedResources — prueba machine-checkable de zero-standing-privilege (PR #115 P1 remediation)', () => {
  it('PREFLIGHT_NOT_STARTED, PREFLIGHT_CLEAN, WAITING_FOR_APPLY_HUMAN_GATE y CLEAN son, y solo ellos, estados sin ningún recurso privilegiado activo', () => {
    const expectedZero: OperationState[] = [
      'PREFLIGHT_NOT_STARTED',
      'PREFLIGHT_CLEAN',
      'WAITING_FOR_APPLY_HUMAN_GATE',
      'CLEAN',
    ];
    for (const state of expectedZero) {
      expect(hasZeroPrivilegedResources(state)).toBe(true);
    }
  });

  it('ningún estado con una identidad efímera potencialmente viva reporta zero-privileged-resources', () => {
    const expectedNonZero: OperationState[] = [
      'PREFLIGHT_BOOTSTRAPPING',
      'PREFLIGHT_RUNNING',
      'PREFLIGHT_EVIDENCE_CAPTURED',
      'PREFLIGHT_CLEANING',
      'APPLY_BOOTSTRAPPING',
      'APPLY_FRESH_PREFLIGHT',
      'APPLYING',
      'TARGET_CLOUDSQL_ROLE_REMOVED',
      'VERIFYING',
      'APPLY_CLEANING',
    ];
    for (const state of expectedNonZero) {
      expect(hasZeroPrivilegedResources(state)).toBe(false);
    }
  });

  it('HOLD nunca se asume limpio — un fallo no anticipado nunca se reporta como zero-privileged sin re-verificación real', () => {
    expect(hasZeroPrivilegedResources('HOLD')).toBe(false);
  });

  it('WAITING_FOR_APPLY_HUMAN_GATE específicamente reporta cero recursos privilegiados — esta es la propiedad P1 que motivó toda la remediación (una operación de stage 1 exitosa, abandonada para siempre, nunca deja nada activo)', () => {
    expect(hasZeroPrivilegedResources('WAITING_FOR_APPLY_HUMAN_GATE')).toBe(true);
  });
});

describe('máquina de estados de cleanup (Phase 11 / Phase 7 remediación P1-B — un solo secret DSN + Cloud Run Job efímero, sin secret de password)', () => {
  const NONE: CleanupResourceState = {
    targetAdminOptionRevoked: false,
    ephemeralAdminDeleted: false,
    dsnSecretDeleted: false,
    dsnSecretIamRemoved: false,
    ephemeralJobDeleted: false,
  };

  const ALL_DONE: CleanupResourceState = {
    targetAdminOptionRevoked: true,
    ephemeralAdminDeleted: true,
    dsnSecretDeleted: true,
    dsnSecretIamRemoved: true,
    ephemeralJobDeleted: true,
  };

  it('CLEANUP_STATE_0 cuando nada fue revocado todavía', () => {
    expect(classifyCleanupState(NONE, false)).toBe('CLEANUP_STATE_0');
  });

  it('progresa exactamente en el orden A -> B -> C(DSN) -> D(DSN IAM) -> E(Cloud Run Job) -> verificación', () => {
    expect(classifyCleanupState({ ...NONE, targetAdminOptionRevoked: true }, false)).toBe('CLEANUP_STATE_1');
    expect(
      classifyCleanupState({ ...NONE, targetAdminOptionRevoked: true, ephemeralAdminDeleted: true }, false),
    ).toBe('CLEANUP_STATE_2');
    expect(
      classifyCleanupState(
        { ...NONE, targetAdminOptionRevoked: true, ephemeralAdminDeleted: true, dsnSecretDeleted: true },
        false,
      ),
    ).toBe('CLEANUP_STATE_3');
    expect(
      classifyCleanupState(
        {
          ...NONE,
          targetAdminOptionRevoked: true,
          ephemeralAdminDeleted: true,
          dsnSecretDeleted: true,
          dsnSecretIamRemoved: true,
        },
        false,
      ),
    ).toBe('CLEANUP_STATE_4');
    expect(classifyCleanupState({ ...ALL_DONE }, false)).toBe('CLEANUP_STATE_5');
  });

  it('CLEANUP_STATE_6 solo cuando los 5 recursos (secret DSN + su IAM + Cloud Run Job + admin + ADMIN OPTION) están limpios Y la verificación independiente pasó', () => {
    expect(classifyCleanupState(ALL_DONE, false)).toBe('CLEANUP_STATE_5');
    expect(classifyCleanupState(ALL_DONE, true)).toBe('CLEANUP_STATE_6');
    expect(isCleanupComplete(classifyCleanupState(ALL_DONE, true))).toBe(true);
  });

  it('un solo recurso pendiente, sin importar cuál de los 5, nunca reporta completo', () => {
    for (const key of Object.keys(ALL_DONE) as Array<keyof CleanupResourceState>) {
      const partial: CleanupResourceState = { ...ALL_DONE, [key]: false };
      expect(isCleanupComplete(classifyCleanupState(partial, true))).toBe(false);
    }
  });
});

describe('classifyFinalOutcome — Phase 11, la clasificación más importante de todas', () => {
  it('éxito + cleanup completo -> SUCCESS_AND_CLEAN', () => {
    expect(classifyFinalOutcome(true, 'CLEANUP_STATE_6')).toBe('SUCCESS_AND_CLEAN');
  });

  it('falla de operación + cleanup completo -> FAILED_BUT_CLEAN (no privilegios huérfanos)', () => {
    expect(classifyFinalOutcome(false, 'CLEANUP_STATE_6')).toBe('FAILED_BUT_CLEAN');
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
