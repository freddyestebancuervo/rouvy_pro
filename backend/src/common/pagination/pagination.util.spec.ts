import {
  DEFAULT_LIMIT,
  MAX_CURSOR_LENGTH,
  MAX_LIMIT,
  computeFilterFingerprint,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from './pagination.util';

/**
 * T-F0.5 (docs/tasks/TF0_5_PAGINATION_CONTRACT.md) — codec/validación
 * de paginación keyset, probado unitariamente porque `EquipmentService`
 * y `WorkoutsService` solo lo consumen (no reimplementan ninguna regla
 * acá probada).
 */
function expectPaginationError(fn: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  expect((thrown as { code?: string } | undefined)?.code).toBe(code);
}

describe('parseLimit', () => {
  it('devuelve DEFAULT_LIMIT (50) cuando limit está ausente', () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(DEFAULT_LIMIT).toBe(50);
  });

  it('acepta el mínimo (1) y el máximo (100)', () => {
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit('100')).toBe(100);
    expect(MAX_LIMIT).toBe(100);
  });

  it('limit=0 → PAGINATION_LIMIT_INVALID', () => {
    expectPaginationError(() => parseLimit('0'), 'PAGINATION_LIMIT_INVALID');
  });

  it('limit=-1 → PAGINATION_LIMIT_INVALID', () => {
    expectPaginationError(() => parseLimit('-1'), 'PAGINATION_LIMIT_INVALID');
  });

  it('limit=abc → PAGINATION_LIMIT_INVALID', () => {
    expectPaginationError(() => parseLimit('abc'), 'PAGINATION_LIMIT_INVALID');
  });

  it('limit=1.5 → PAGINATION_LIMIT_INVALID', () => {
    expectPaginationError(() => parseLimit('1.5'), 'PAGINATION_LIMIT_INVALID');
  });

  it('limit=101 (> MAX_LIMIT) → PAGINATION_LIMIT_INVALID, sin clamp a 100', () => {
    expectPaginationError(() => parseLimit('101'), 'PAGINATION_LIMIT_INVALID');
  });

  it('limit con ceros a la izquierda ("01") → PAGINATION_LIMIT_INVALID', () => {
    expectPaginationError(() => parseLimit('01'), 'PAGINATION_LIMIT_INVALID');
  });

  it('limit absurdamente grande (fuera de rango seguro) → PAGINATION_LIMIT_INVALID, no se trunca', () => {
    expectPaginationError(() => parseLimit('999999999999999999999999'), 'PAGINATION_LIMIT_INVALID');
  });
});

describe('computeFilterFingerprint', () => {
  it('es determinista sin importar el orden de las keys del objeto de entrada', () => {
    const a = computeFilterFingerprint({ category: 'bike', includeArchived: false });
    const b = computeFilterFingerprint({ includeArchived: false, category: 'bike' });
    expect(a).toBe(b);
  });

  it('produce 12 caracteres hex en minúscula', () => {
    const fp = computeFilterFingerprint({ mine: true });
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
  });

  it('filtros lógicamente distintos producen fingerprints distintos', () => {
    const a = computeFilterFingerprint({ category: 'bike', includeArchived: false });
    const b = computeFilterFingerprint({ category: 'power_meter', includeArchived: false });
    const c = computeFilterFingerprint({ category: 'bike', includeArchived: true });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('ausente vs. false explícito producen el mismo fingerprint cuando el caller ya los normalizó al mismo valor efectivo', () => {
    // El servicio es quien normaliza "ausente" y "false" al mismo booleano
    // efectivo (contract §8.1 nota de Fase H) — acá se confirma que, una
    // vez normalizados, el fingerprint es idéntico.
    const a = computeFilterFingerprint({ mine: false });
    const b = computeFilterFingerprint({ mine: false });
    expect(a).toBe(b);
  });
});

describe('encodeCursor / decodeCursor', () => {
  const fingerprint = computeFilterFingerprint({ mine: false });
  const validPosition = { createdAt: '2026-08-16T21:07:33.123456Z', id: '6f2c1e2a-1111-4c1a-9a2b-000000000001' };

  it('encode(decode(cursor)) conserva exactamente la posición lógica', () => {
    const cursor = encodeCursor({ ...validPosition, fingerprint });
    const decoded = decodeCursor(cursor, fingerprint);
    expect(decoded).toEqual(validPosition);

    const reEncoded = encodeCursor({ ...decoded, fingerprint });
    expect(reEncoded).toBe(cursor);
  });

  it('el cursor codificado es base64url sin padding (sin "+", "/", "=")', () => {
    const cursor = encodeCursor({ ...validPosition, fingerprint });
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it('cursor con padding "=" es rechazado (alfabeto base64url estándar, no base64 clásico)', () => {
    const cursor = encodeCursor({ ...validPosition, fingerprint });
    expectPaginationError(() => decodeCursor(`${cursor}=`, fingerprint), 'PAGINATION_CURSOR_INVALID');
  });

  it('cursor con caracteres fuera del alfabeto base64url ("+"/"/") es rechazado', () => {
    expectPaginationError(() => decodeCursor('abc+def/', fingerprint), 'PAGINATION_CURSOR_INVALID');
  });

  it('cursor que excede MAX_CURSOR_LENGTH (512) es rechazado', () => {
    expect(MAX_CURSOR_LENGTH).toBe(512);
    const oversized = 'A'.repeat(MAX_CURSOR_LENGTH + 1);
    expectPaginationError(() => decodeCursor(oversized, fingerprint), 'PAGINATION_CURSOR_INVALID');
  });

  it('string vacío es rechazado', () => {
    expectPaginationError(() => decodeCursor('', fingerprint), 'PAGINATION_CURSOR_INVALID');
  });

  it('base64url válido pero JSON inválido es rechazado', () => {
    const garbage = Buffer.from('esto no es json', 'utf8').toString('base64url');
    expectPaginationError(() => decodeCursor(garbage, fingerprint), 'PAGINATION_CURSOR_INVALID');
  });

  it('JSON válido pero con un campo extra (schema exacto) es rechazado', () => {
    const withExtra = Buffer.from(
      JSON.stringify({ ...validPosition, v: 1, f: fingerprint, extra: 'nope' }),
      'utf8',
    ).toString('base64url');
    expectPaginationError(() => decodeCursor(withExtra, fingerprint), 'PAGINATION_CURSOR_INVALID');
  });

  it('JSON válido pero con una key faltante es rechazado', () => {
    const missingId = Buffer.from(JSON.stringify({ v: 1, createdAt: validPosition.createdAt, f: fingerprint }), 'utf8').toString(
      'base64url',
    );
    expectPaginationError(() => decodeCursor(missingId, fingerprint), 'PAGINATION_CURSOR_INVALID');
  });

  it('versión de cursor desconocida (v != 1) es rechazada', () => {
    const unknownVersion = Buffer.from(
      JSON.stringify({ v: 2, createdAt: validPosition.createdAt, id: validPosition.id, f: fingerprint }),
      'utf8',
    ).toString('base64url');
    expectPaginationError(() => decodeCursor(unknownVersion, fingerprint), 'PAGINATION_CURSOR_INVALID');
  });

  it('timestamp sin precisión de microsegundos es rechazado', () => {
    const badTimestamp = Buffer.from(
      JSON.stringify({ v: 1, createdAt: '2026-08-16T21:07:33.123Z', id: validPosition.id, f: fingerprint }),
      'utf8',
    ).toString('base64url');
    expectPaginationError(() => decodeCursor(badTimestamp, fingerprint), 'PAGINATION_CURSOR_INVALID');
  });

  it('UUID con formato inválido es rechazado', () => {
    const badUuid = Buffer.from(
      JSON.stringify({ v: 1, createdAt: validPosition.createdAt, id: 'no-es-un-uuid', f: fingerprint }),
      'utf8',
    ).toString('base64url');
    expectPaginationError(() => decodeCursor(badUuid, fingerprint), 'PAGINATION_CURSOR_INVALID');
  });

  it('fingerprint que no coincide con los filtros del request actual → PAGINATION_CURSOR_FILTER_MISMATCH', () => {
    const cursor = encodeCursor({ ...validPosition, fingerprint });
    const differentFingerprint = computeFilterFingerprint({ mine: true });
    expectPaginationError(() => decodeCursor(cursor, differentFingerprint), 'PAGINATION_CURSOR_FILTER_MISMATCH');
  });
});
