import { createHash } from 'crypto';
import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../exceptions/api.exception';

/**
 * Codec y validación de paginación keyset opt-in para `GET /equipment` y
 * `GET /workouts` — implementa exactamente el diseño de
 * `docs/tasks/TF0_5_PAGINATION_CONTRACT.md` (Tarea #13, fusionado en
 * `main`), secciones 7-9, 12 y 15. Compartido entre ambos módulos para
 * no duplicar la lógica de codec/validación/errores.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
export const CURSOR_VERSION = 1;
export const MAX_CURSOR_LENGTH = 512;

export const PAGINATION_LIMIT_INVALID = (): ApiException =>
  new ApiException(
    HttpStatus.BAD_REQUEST,
    'PAGINATION_LIMIT_INVALID',
    'El parámetro "limit" no es válido: debe ser un entero entre 1 y 100.',
  );

export const PAGINATION_CURSOR_INVALID = (): ApiException =>
  new ApiException(
    HttpStatus.BAD_REQUEST,
    'PAGINATION_CURSOR_INVALID',
    'El cursor de paginación no es válido o está corrupto.',
  );

export const PAGINATION_CURSOR_FILTER_MISMATCH = (): ApiException =>
  new ApiException(
    HttpStatus.BAD_REQUEST,
    'PAGINATION_CURSOR_FILTER_MISMATCH',
    'El cursor de paginación no corresponde a los filtros de esta solicitud.',
  );

/**
 * Entero estricto en base 10, sin signo, sin ceros a la izquierda, sin
 * parte decimal — rechaza "abc", "1.5", "-1", "0", "01" (regex, no
 * `parseInt`/`Number()` sueltos: esas funciones son permisivas con
 * strings como "1.5abc" o notación exponencial, contract §9.3).
 */
const STRICT_POSITIVE_INTEGER_RE = /^[1-9][0-9]*$/;

/**
 * `limit` ausente → `DEFAULT_LIMIT` (contract §9.1: cursor sin limit usa
 * el default). Cualquier valor presente pero inválido falla la
 * validación con `PAGINATION_LIMIT_INVALID` — nunca clamp silencioso
 * (contract §9.3, requisito explícito de Task14 Fase E).
 */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }
  if (!STRICT_POSITIVE_INTEGER_RE.test(raw)) {
    throw PAGINATION_LIMIT_INVALID();
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw PAGINATION_LIMIT_INVALID();
  }
  return value;
}

/**
 * Fingerprint corto (12 hex) de los filtros EFECTIVOS que producen un
 * cursor — contract §8.1/§12. `node:crypto` únicamente, sin dependencia
 * externa. El segundo argumento de `JSON.stringify` como array de keys
 * fija tanto qué propiedades se serializan como el ORDEN en que
 * aparecen en el JSON resultante (comportamiento estándar de
 * `JSON.stringify` con replacer-array) — asegura que el mismo conjunto
 * lógico de filtros produzca siempre el mismo fingerprint sin depender
 * del orden en que el caller construyó el objeto.
 */
export function computeFilterFingerprint(effectiveFilters: Record<string, string | boolean | null>): string {
  const orderedKeys = Object.keys(effectiveFilters).sort();
  const canonical = JSON.stringify(effectiveFilters, orderedKeys);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export interface CursorPosition {
  createdAt: string;
  id: string;
}

interface EncodeCursorInput extends CursorPosition {
  fingerprint: string;
}

const CURSOR_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const CURSOR_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURSOR_FINGERPRINT_RE = /^[0-9a-f]{12}$/;
const BASE64URL_ALPHABET_RE = /^[A-Za-z0-9_-]+$/;
const CURSOR_EXPECTED_KEYS = 'createdAt,f,id,v';

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * `CURSOR_TIMESTAMP_RE` solo valida la FORMA (conteo de dígitos por
 * componente) — `"2026-02-30T10:20:30.123456Z"` matchea el regex
 * perfectamente aunque el 30 de febrero no exista (hallazgo bloqueante
 * de revisión de PR #52). Esta función valida el CALENDARIO real:
 * mes 1-12, día válido para ese mes (con año bisiesto correcto para
 * febrero), hora 0-23, minuto 0-59, segundo 0-59.
 *
 * Determinista y sin dependencias: NO usa `Date`/`Date.UTC` — evita
 * cualquier ambigüedad sobre auto-normalización de fechas inválidas
 * (p. ej. `new Date(Date.UTC(2026, 1, 30))` "corrige" en silencio el 30
 * de febrero a 2 de marzo en vez de señalarlo como inválido) y evita
 * cualquier acoplamiento a la precisión de milisegundos de `Date`.
 *
 * Recibe un string que YA pasó `CURSOR_TIMESTAMP_RE` — el slicing por offsets
 * fijos es seguro porque el formato de ancho fijo ya está garantizado.
 */
function isValidCalendarTimestamp(iso: string): boolean {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const hour = Number(iso.slice(11, 13));
  const minute = Number(iso.slice(14, 16));
  const second = Number(iso.slice(17, 19));

  if (month < 1 || month > 12) {
    return false;
  }
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > maxDay) {
    return false;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  return true;
}

/**
 * Cursor v1 (contract §8.1): `base64url(JSON({v,createdAt,id,f}))`, sin
 * padding. El orden de claves del JSON es fijo para que
 * `encode(decode(cursor))` sea estable byte a byte.
 */
export function encodeCursor(input: EncodeCursorInput): string {
  const json = JSON.stringify({
    v: CURSOR_VERSION,
    createdAt: input.createdAt,
    id: input.id,
    f: input.fingerprint,
  });
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Validación fail-closed en el orden exacto del contrato §15: longitud,
 * alfabeto, decode, JSON, schema exacto (sin campos extra), versión,
 * timestamp, UUID, fingerprint — cualquier fallo estructural es
 * `PAGINATION_CURSOR_INVALID` (400); un fingerprint que no matchea los
 * filtros efectivos del request actual es `PAGINATION_CURSOR_FILTER_MISMATCH`
 * (400), nunca 500, nunca ignorado en silencio.
 *
 * `Buffer.from(str, 'base64url')` es permisivo con basura fuera del
 * alfabeto/con padding inesperado — no alcanza con que no lance
 * excepción (hallazgo explícito de la Tarea #14, Fase F). Por eso se
 * valida el alfabeto ANTES de decodificar, y se exige que re-codificar
 * los bytes decodificados reproduzca EXACTAMENTE el string recibido: si
 * Buffer decodificó "a su manera" algo que no era un base64url válido,
 * el roundtrip no coincide y se rechaza.
 */
export function decodeCursor(raw: string, expectedFingerprint: string): CursorPosition {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) {
    throw PAGINATION_CURSOR_INVALID();
  }
  if (!BASE64URL_ALPHABET_RE.test(raw)) {
    throw PAGINATION_CURSOR_INVALID();
  }

  const decoded = Buffer.from(raw, 'base64url');
  if (decoded.toString('base64url') !== raw) {
    throw PAGINATION_CURSOR_INVALID();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.toString('utf8'));
  } catch {
    throw PAGINATION_CURSOR_INVALID();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw PAGINATION_CURSOR_INVALID();
  }
  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).sort().join(',') !== CURSOR_EXPECTED_KEYS) {
    throw PAGINATION_CURSOR_INVALID();
  }
  if (obj.v !== CURSOR_VERSION) {
    throw PAGINATION_CURSOR_INVALID();
  }
  if (
    typeof obj.createdAt !== 'string' ||
    !CURSOR_TIMESTAMP_RE.test(obj.createdAt) ||
    !isValidCalendarTimestamp(obj.createdAt)
  ) {
    throw PAGINATION_CURSOR_INVALID();
  }
  if (typeof obj.id !== 'string' || !CURSOR_UUID_RE.test(obj.id)) {
    throw PAGINATION_CURSOR_INVALID();
  }
  if (typeof obj.f !== 'string' || !CURSOR_FINGERPRINT_RE.test(obj.f)) {
    throw PAGINATION_CURSOR_INVALID();
  }

  if (obj.f !== expectedFingerprint) {
    throw PAGINATION_CURSOR_FILTER_MISMATCH();
  }

  return { createdAt: obj.createdAt, id: obj.id };
}
