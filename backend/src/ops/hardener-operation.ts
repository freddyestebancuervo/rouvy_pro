/**
 * T-F1.2 Point 8C — ephemeral hardener-admin operation identity.
 *
 * =============================================================================
 * QUÉ ES
 * =============================================================================
 * Utilidades PURAS (sin I/O, sin gcloud, sin red) para derivar, de un único
 * `operation_id`, los tres nombres de recursos que la orquestación efímera
 * (workflow `production-db-role-hardener-ephemeral.yml`) necesita crear y —
 * más importante — volver a encontrar exactamente para hacer cleanup, sin
 * mantener ningún estado propio entre el dispatch de `bootstrap_and_preflight`
 * y el dispatch posterior de `apply`:
 *
 *   - el usuario PostgreSQL built-in-auth efímero (`korixa_db_hardener_once_
 *     <sufijo>`)
 *   - el Secret Manager secret efímero dedicado (`korixa-production-db-
 *     hardener-once-<sufijo>`)
 *
 * Ningún valor generado acá es secreto — `operation_id` se diseña
 * explícitamente para ser seguro de loguear (GITHUB_STEP_SUMMARY, workflow
 * run name, etc.): nunca contiene password, DSN, ni ningún fragmento
 * derivado de un secreto real.
 *
 * =============================================================================
 * POR QUÉ operation_id DEBE ser lo único que ata todo
 * =============================================================================
 * La orquestación efímera es, por diseño, DOS dispatches separados del mismo
 * workflow (`bootstrap_and_preflight` y `apply`), cada uno un runner de
 * GitHub Actions completamente nuevo sin memoria del anterior. El único
 * puente entre ambos es el valor NO SECRETO `operation_id` que el operador
 * copia del resumen del primer dispatch al segundo. Que los nombres de
 * recursos sean una función PURA y DETERMINÍSTICA de ese valor (nunca un
 * UUID aleatorio adicional guardado en algún lado) es lo que permite que
 * `apply` —y, crucialmente, `cleanup_only`— puedan encontrar exactamente los
 * recursos de una operación dada sin ningún almacenamiento de estado externo
 * nuevo.
 *
 * =============================================================================
 * Reachability
 * =============================================================================
 * Módulo puro — importarlo nunca conecta a nada ni ejecuta ningún comando.
 * =============================================================================
 */

// =============================================================================
// operation_id — collision-resistant, seguro de loguear, charset restringido.
// =============================================================================

/**
 * 12 caracteres hex en minúsculas (48 bits de entropía criptográfica) —
 * suficiente resistencia a colisión para un identificador de una operación
 * humana, manual, de baja frecuencia (nunca automatizada/recurrente), y
 * corto+charset restringido para caber dentro de los límites de nombre más
 * estrictos de los tres consumidores (usuario Cloud SQL, Secret Manager,
 * nombre de Cloud Run Job).
 */
export const OPERATION_ID_PATTERN = /^[0-9a-f]{12}$/;

export interface RandomHexSource {
  /** Debe devolver `byteLength` bytes criptográficamente aleatorios. */
  randomBytes(byteLength: number): Uint8Array;
}

/**
 * Genera un `operation_id` fresco. Requiere que el caller inyecte una fuente
 * de aleatoriedad criptográfica explícita (p. ej. `crypto.randomBytes` de
 * Node) — este módulo nunca importa `crypto` directamente para permanecer
 * 100% puro/testeable sin mocks de módulos globales.
 */
export function generateOperationId(source: RandomHexSource): string {
  const bytes = source.randomBytes(6);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  if (!OPERATION_ID_PATTERN.test(hex)) {
    // Solo alcanzable si `source` está rota (no devuelve 6 bytes reales) —
    // nunca debe fallar silenciosamente derivando nombres de recursos de un
    // valor a medio generar.
    throw new Error('generateOperationId: la fuente de aleatoriedad no produjo 12 hex chars válidos.');
  }
  return hex;
}

export function isValidOperationId(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_ID_PATTERN.test(value);
}

export function assertValidOperationId(value: unknown): asserts value is string {
  if (!isValidOperationId(value)) {
    throw new Error(
      `operation_id inválido: debe ser exactamente 12 caracteres hexadecimales en minúsculas. Recibido: '${String(value)}'`,
    );
  }
}

// =============================================================================
// Nombres derivados — funciones puras, deterministas, un único operation_id
// como entrada. Nunca se acepta un operation_id inválido silenciosamente.
// =============================================================================

const EPHEMERAL_ADMIN_PREFIX = 'korixa_db_hardener_once_';
const EPHEMERAL_SECRET_PREFIX = 'korixa-production-db-hardener-once-';
const EPHEMERAL_JOB_PREFIX = 'korixa-prod-hardener-once-';

/**
 * Nombre de usuario PostgreSQL/Cloud SQL efímero.
 *
 * Longitud: `korixa_db_hardener_once_` (25) + 12 hex = 37 caracteres.
 * PostgreSQL identifiers: máximo 63 bytes (NAMEDATALEN=64, con margen) — 37
 * está muy por debajo. Cloud SQL Postgres username: mismo límite de
 * identificador de Postgres — cumple. Charset: `[a-z0-9_]`, ya que
 * `operation_id` es hex minúscula y el prefijo es snake_case — válido como
 * identificador Postgres sin comillas (empieza con letra, sin caracteres
 * especiales).
 */
export function deriveEphemeralAdminUsername(operationId: string): string {
  assertValidOperationId(operationId);
  return `${EPHEMERAL_ADMIN_PREFIX}${operationId}`;
}

/**
 * Nombre de Secret Manager secret efímero.
 *
 * Longitud: `korixa-production-db-hardener-once-` (36) + 12 hex = 48
 * caracteres. Límite de Secret Manager: 255 caracteres — cumple con margen
 * amplio. Charset permitido por Secret Manager: letras, dígitos, `-`, `_` —
 * el prefijo usa `-` (kebab-case, consistente con los otros secrets del
 * proyecto: `korixa-production-migration-database-url`,
 * `korixa-production-database-url`), el sufijo hex es `[a-z0-9]`.
 */
export function deriveEphemeralSecretName(operationId: string): string {
  assertValidOperationId(operationId);
  return `${EPHEMERAL_SECRET_PREFIX}${operationId}`;
}

/**
 * Nombre del Cloud Run Job efímero para esta operación — deliberadamente
 * DISTINTO del Job persistente `korixa-production-db-role-hardener` que usa
 * el workflow anterior (T-F1.2 Point 8B/8C), para que ambos mecanismos nunca
 * puedan pisarse si coexisten temporalmente durante la migración de uno a
 * otro.
 *
 * Longitud: `korixa-prod-hardener-once-` (27) + 12 hex = 39 caracteres.
 * Límite de Cloud Run: 63 caracteres — cumple.
 */
export function deriveEphemeralJobName(operationId: string): string {
  assertValidOperationId(operationId);
  return `${EPHEMERAL_JOB_PREFIX}${operationId}`;
}

export interface OperationResourceNames {
  operationId: string;
  ephemeralAdminUsername: string;
  ephemeralSecretName: string;
  ephemeralJobName: string;
}

/** Punto único de verdad — evita que dos sitios del workflow deriven el
 * mismo nombre con lógica duplicada que podría divergir. */
export function deriveOperationResourceNames(operationId: string): OperationResourceNames {
  assertValidOperationId(operationId);
  return {
    operationId,
    ephemeralAdminUsername: deriveEphemeralAdminUsername(operationId),
    ephemeralSecretName: deriveEphemeralSecretName(operationId),
    ephemeralJobName: deriveEphemeralJobName(operationId),
  };
}

// =============================================================================
// Máquina de estados de la operación (Phase 13) — modelo puro, sin I/O.
// Transiciones unidireccionales y validadas; una transición ilegal lanza en
// vez de reconstruirse silenciosamente a partir de una suposición.
// =============================================================================

export type OperationState =
  | 'NOT_STARTED'
  | 'BOOTSTRAPPING'
  | 'PREFLIGHT_READY'
  | 'WAITING_APPLY_GATE'
  | 'APPLYING'
  | 'TARGET_SQL_HARDENED'
  | 'TARGET_CLOUDSQL_ROLE_REMOVED'
  | 'VERIFIED'
  | 'CLEANING'
  | 'CLEAN'
  | 'HOLD';

/** Grafo de transiciones permitidas — cualquier arista no listada acá es
 * ilegal. `HOLD` es alcanzable desde CUALQUIER estado (fail-closed ante
 * cualquier error), pero nunca es un estado de origen válido para avanzar
 * automáticamente — solo cleanup_only puede actuar sobre una operación en
 * HOLD, y solo para limpiar, nunca para reintentar la operación original. */
const ALLOWED_TRANSITIONS: Readonly<Record<OperationState, ReadonlySet<OperationState>>> = {
  NOT_STARTED: new Set<OperationState>(['BOOTSTRAPPING', 'HOLD']),
  BOOTSTRAPPING: new Set<OperationState>(['PREFLIGHT_READY', 'HOLD']),
  PREFLIGHT_READY: new Set<OperationState>(['WAITING_APPLY_GATE', 'HOLD']),
  WAITING_APPLY_GATE: new Set<OperationState>(['APPLYING', 'HOLD']),
  APPLYING: new Set<OperationState>(['TARGET_SQL_HARDENED', 'HOLD']),
  TARGET_SQL_HARDENED: new Set<OperationState>(['TARGET_CLOUDSQL_ROLE_REMOVED', 'HOLD']),
  TARGET_CLOUDSQL_ROLE_REMOVED: new Set<OperationState>(['VERIFIED', 'HOLD']),
  VERIFIED: new Set<OperationState>(['CLEANING', 'HOLD']),
  CLEANING: new Set<OperationState>(['CLEAN', 'HOLD']),
  CLEAN: new Set<OperationState>([]), // estado terminal — ninguna transición más
  HOLD: new Set<OperationState>(['CLEANING']), // solo cleanup_only puede sacar una operación de HOLD, y solo hacia limpieza
};

export class IllegalOperationTransitionError extends Error {
  constructor(
    readonly from: OperationState,
    readonly to: OperationState,
  ) {
    super(`Transición de estado ilegal: '${from}' -> '${to}'. Esta operación no puede continuar automáticamente.`);
    this.name = 'IllegalOperationTransitionError';
  }
}

export function assertValidTransition(from: OperationState, to: OperationState): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed || !allowed.has(to)) {
    throw new IllegalOperationTransitionError(from, to);
  }
}

// =============================================================================
// Phase 11 — máquina de estados de CLEANUP. Modela específicamente qué
// recursos privilegiados siguen activos, para que "cleanup falló" nunca
// pueda esconderse detrás de "la operación falló" — son dos hechos
// separados que deben reportarse juntos.
// =============================================================================

export interface CleanupResourceState {
  /** A — ADMIN OPTION temporal sobre korixa_app revocada. */
  targetAdminOptionRevoked: boolean;
  /** B — usuario PostgreSQL efímero eliminado. */
  ephemeralAdminDeleted: boolean;
  /** C — secret/version efímero deshabilitado o eliminado. */
  ephemeralSecretDisabled: boolean;
  /** D — binding IAM a nivel de secreto eliminado (implícito si C es true,
   * ya que el secreto ya no existe — se rastrea por separado para poder
   * reportar la causa exacta de cualquier falla parcial). */
  ephemeralIamBindingRemoved: boolean;
}

export type CleanupState =
  | 'CLEANUP_STATE_0' // recursos activos
  | 'CLEANUP_STATE_1' // A hecho
  | 'CLEANUP_STATE_2' // A + B
  | 'CLEANUP_STATE_3' // A + B + C
  | 'CLEANUP_STATE_4' // A + B + C + D
  | 'CLEANUP_STATE_5'; // A + B + C + D, y además verificado independientemente

export function classifyCleanupState(resources: CleanupResourceState, independentlyVerified: boolean): CleanupState {
  if (!resources.targetAdminOptionRevoked) return 'CLEANUP_STATE_0';
  if (!resources.ephemeralAdminDeleted) return 'CLEANUP_STATE_1';
  if (!resources.ephemeralSecretDisabled) return 'CLEANUP_STATE_2';
  if (!resources.ephemeralIamBindingRemoved) return 'CLEANUP_STATE_3';
  if (!independentlyVerified) return 'CLEANUP_STATE_4';
  return 'CLEANUP_STATE_5';
}

export function isCleanupComplete(state: CleanupState): boolean {
  return state === 'CLEANUP_STATE_5';
}

/**
 * Regla explícita de Phase 11: si la operación principal falló Y el cleanup
 * también quedó incompleto, ese es el hallazgo de mayor severidad posible —
 * nunca debe reportarse simplemente como "la operación falló".
 */
export function classifyFinalOutcome(
  operationSucceeded: boolean,
  cleanupState: CleanupState,
): 'SUCCESS_AND_CLEAN' | 'FAILED_BUT_CLEAN' | 'HOLD_OPERATION_FAILED_AND_PRIVILEGED_CLEANUP_INCOMPLETE' | 'HOLD_CLEANUP_INCOMPLETE' {
  const clean = isCleanupComplete(cleanupState);
  if (operationSucceeded && clean) return 'SUCCESS_AND_CLEAN';
  if (!operationSucceeded && clean) return 'FAILED_BUT_CLEAN';
  if (!operationSucceeded && !clean) return 'HOLD_OPERATION_FAILED_AND_PRIVILEGED_CLEANUP_INCOMPLETE';
  return 'HOLD_CLEANUP_INCOMPLETE';
}
