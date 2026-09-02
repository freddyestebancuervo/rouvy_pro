/**
 * T-F1.2 Point 8C — bootstrap/revoke del ADMIN OPTION efímero, entrypoint
 * NARROW y tipado (PR #115 P1-B remediation, Phase 1/2).
 *
 * =============================================================================
 * QUÉ ES Y QUÉ NO ES
 * =============================================================================
 * Este archivo hace EXACTAMENTE una de dos cosas, según `BOOTSTRAP_MODE`:
 *
 *   - `grant-admin-option`: `GRANT korixa_app TO <ephemeral_admin> WITH ADMIN
 *     OPTION;` — el admin efímero se auto-otorga el ADMIN OPTION usando SU
 *     PROPIA credencial (ya tiene `cloudsqlsuperuser`).
 *   - `revoke-admin-option`: `REVOKE korixa_app FROM <ephemeral_admin>;` —
 *     mismo admin, misma credencial, antes de que se elimine.
 *
 * Ningún otro statement SQL existe en este archivo. NO es un ejecutor SQL
 * genérico — `EPHEMERAL_ADMIN_USERNAME` nunca se acepta como texto libre: se
 * valida contra el patrón EXACTO de `deriveEphemeralAdminUsername`
 * (`hardener-operation.ts`) antes de interpolarse en cualquier statement, ya
 * que `GRANT/REVOKE ROLE ... TO/FROM <identifier>` no admite parámetros
 * posicionales de `pg` para el nombre del rol (limitación real de SQL, no de
 * esta librería) — la validación de formato ES el mecanismo de seguridad acá,
 * no una capa cosmética adicional.
 *
 * =============================================================================
 * POR QUÉ EXISTE ESTE ARCHIVO (PR #115 P1-B remediation)
 * =============================================================================
 * La versión anterior de la orquestación efímera usaba
 * `gcloud sql instances execute-sql --password-secret-version`, que exige
 * `settings.dataApiAccess=ALLOW_DATA_API` en la instancia — un requisito real,
 * nunca antes verificado, que además cambia la postura de seguridad de una
 * instancia de IP privada (permite acceso vía ExecuteSql API desde internet a
 * usuarios autorizados). Este archivo reemplaza ese mecanismo: el
 * GRANT/REVOKE del ADMIN OPTION ahora corre exactamente por el mismo camino
 * VPC privado ya probado en vivo para preflight/apply/verify — un Cloud Run
 * Job efímero, `MIGRATION_EXECUTOR_SA`, `--vpc-egress=private-ranges-only`,
 * conectando directo a la IP privada de Cloud SQL vía `pg`. Cero dependencia
 * de la Cloud SQL Admin API ExecuteSql, cero requisito de `dataApiAccess`.
 *
 * =============================================================================
 * Contrato de entorno
 * =============================================================================
 * REQUERIDAS: `MIGRATION_DATABASE_URL`, `BOOTSTRAP_MODE`
 * (`grant-admin-option` | `revoke-admin-option`, sin ningún otro valor
 * aceptado), `EPHEMERAL_ADMIN_USERNAME`, `EXPECTED_DATABASE`,
 * `EXPECTED_DB_HOST`, `EXPECTED_SOURCE_SHA`.
 * PROHIBIDA: `DATABASE_URL` — su sola presencia aborta antes de leer
 * cualquier otra cosa, misma disciplina que `db-role-hardener.ts`.
 *
 * `BOOTSTRAP_TARGET_ROLE` es una constante hardcodeada — igual que en
 * `db-role-hardener.ts`, ningún identificador SQL de este archivo se deriva
 * jamás de una variable de entorno salvo `EPHEMERAL_ADMIN_USERNAME`, que
 * SIEMPRE se valida contra un patrón fijo antes de usarse.
 *
 * =============================================================================
 * Reachability — mismo contrato que `db-role-hardener.ts`: `require.main ===
 * module` es la única puerta de entrada que toca una base real. Importar
 * este módulo para sus funciones exportadas NUNCA conecta a nada.
 * =============================================================================
 */

import { Client } from 'pg';
import { classifySafeConnectionFailure, parseConnectionString, assertExpectedTarget, HardenerError } from './db-role-hardener';
import { EPHEMERAL_ADMIN_USERNAME_PATTERN } from './hardener-operation';

// =============================================================================
// Identificadores fijos — nunca configurables, nunca leídos de env/args.
// =============================================================================

export const BOOTSTRAP_TARGET_ROLE = 'korixa_app' as const;

export type BootstrapMode = 'grant-admin-option' | 'revoke-admin-option';
const VALID_BOOTSTRAP_MODES: readonly BootstrapMode[] = ['grant-admin-option', 'revoke-admin-option'];

// =============================================================================
// Contrato de entorno
// =============================================================================

export interface BootstrapEnv {
  MIGRATION_DATABASE_URL: string;
  BOOTSTRAP_MODE: BootstrapMode;
  EPHEMERAL_ADMIN_USERNAME: string;
  EXPECTED_DATABASE: string;
  EXPECTED_DB_HOST: string;
  EXPECTED_SOURCE_SHA: string;
}

// =============================================================================
// Códigos de error saneados — misma disciplina que `HardenerError`: nunca se
// propaga el DSN, un password, ni el objeto crudo de `pg`.
// =============================================================================

export type BootstrapErrorCode =
  | 'FORBIDDEN_DATABASE_URL_IN_BOOTSTRAP_CONTEXT'
  | 'MISSING_MIGRATION_DATABASE_URL'
  | 'MISSING_BOOTSTRAP_MODE'
  | 'INVALID_BOOTSTRAP_MODE'
  | 'MISSING_EPHEMERAL_ADMIN_USERNAME'
  | 'INVALID_EPHEMERAL_ADMIN_USERNAME_FORMAT'
  | 'MISSING_EXPECTED_DATABASE'
  | 'UNEXPECTED_TARGET_DATABASE_CONFIGURED'
  | 'MISSING_EXPECTED_DB_HOST'
  | 'MISSING_EXPECTED_SOURCE_SHA'
  | 'INVALID_MIGRATION_DATABASE_URL'
  | 'DATABASE_HOST_MISMATCH'
  | 'DATABASE_NAME_MISMATCH'
  | 'DB_CONNECTION_FAILED'
  | 'CONNECTED_IDENTITY_NOT_EPHEMERAL_ADMIN'
  | 'GRANT_ADMIN_OPTION_FAILED'
  | 'REVOKE_ADMIN_OPTION_FAILED'
  | 'UNEXPECTED_BOOTSTRAP_ERROR';

export class BootstrapError extends Error {
  readonly code: BootstrapErrorCode;
  /** Evidencia segura adicional — nunca password/DSN/stack de `pg`. */
  readonly evidence?: Record<string, string | number | boolean>;

  constructor(code: BootstrapErrorCode, message: string, evidence?: Record<string, string | number | boolean>) {
    super(message);
    this.name = 'BootstrapError';
    this.code = code;
    this.evidence = evidence;
  }
}

function sanitizeUnexpectedError(
  code: BootstrapErrorCode,
  context: string,
  evidence?: Record<string, string | number | boolean>,
): BootstrapError {
  return new BootstrapError(code, `${context} — nunca se propaga DSN, password ni el objeto crudo de \`pg\`.`, evidence);
}

const TARGET_DATABASE_CONSTANT = 'korixa_production' as const;

// =============================================================================
// Lectura/validación de entorno — pura, sin conectar. `DATABASE_URL` se
// verifica PRIMERO, antes de leer cualquier otra cosa (mismo orden que
// `db-role-hardener.ts`/`privilege-reconciler.ts`).
// =============================================================================

export function readRequiredBootstrapEnv(env: NodeJS.ProcessEnv = process.env): BootstrapEnv {
  if (env.DATABASE_URL !== undefined) {
    throw new BootstrapError(
      'FORBIDDEN_DATABASE_URL_IN_BOOTSTRAP_CONTEXT',
      'DATABASE_URL está presente en el proceso del bootstrap — un contexto de endurecimiento de la identidad de migración nunca debe recibir la variable exclusiva del runtime, sin importar su valor. Abortando antes de conectar.',
    );
  }

  const MIGRATION_DATABASE_URL = env.MIGRATION_DATABASE_URL;
  if (!MIGRATION_DATABASE_URL) {
    throw new BootstrapError('MISSING_MIGRATION_DATABASE_URL', 'MIGRATION_DATABASE_URL no está definida.');
  }

  const rawMode = env.BOOTSTRAP_MODE;
  if (!rawMode) {
    throw new BootstrapError('MISSING_BOOTSTRAP_MODE', 'BOOTSTRAP_MODE no está definida.');
  }
  if (!VALID_BOOTSTRAP_MODES.includes(rawMode as BootstrapMode)) {
    throw new BootstrapError(
      'INVALID_BOOTSTRAP_MODE',
      `BOOTSTRAP_MODE debe ser exactamente uno de: ${VALID_BOOTSTRAP_MODES.join(', ')}. Ningún otro valor es aceptado.`,
      { received_length: rawMode.length },
    );
  }
  const BOOTSTRAP_MODE = rawMode as BootstrapMode;

  const EPHEMERAL_ADMIN_USERNAME = env.EPHEMERAL_ADMIN_USERNAME;
  if (!EPHEMERAL_ADMIN_USERNAME) {
    throw new BootstrapError('MISSING_EPHEMERAL_ADMIN_USERNAME', 'EPHEMERAL_ADMIN_USERNAME no está definida.');
  }
  // La validación de formato ES el mecanismo de seguridad: este valor se
  // interpola más abajo en un statement GRANT/REVOKE (los identificadores de
  // rol no admiten parámetros posicionales de `pg`) — nunca se acepta un
  // valor que no coincida EXACTAMENTE con el patrón de
  // `deriveEphemeralAdminUsername`.
  if (!EPHEMERAL_ADMIN_USERNAME_PATTERN.test(EPHEMERAL_ADMIN_USERNAME)) {
    throw new BootstrapError(
      'INVALID_EPHEMERAL_ADMIN_USERNAME_FORMAT',
      `EPHEMERAL_ADMIN_USERNAME no coincide con el patrón exacto esperado (${EPHEMERAL_ADMIN_USERNAME_PATTERN.source}) — nunca se interpola un identificador de rol no probado en SQL.`,
    );
  }

  const EXPECTED_DATABASE = env.EXPECTED_DATABASE;
  if (!EXPECTED_DATABASE) {
    throw new BootstrapError('MISSING_EXPECTED_DATABASE', 'EXPECTED_DATABASE no está definida.');
  }
  if (EXPECTED_DATABASE !== TARGET_DATABASE_CONSTANT) {
    throw new BootstrapError(
      'UNEXPECTED_TARGET_DATABASE_CONFIGURED',
      `EXPECTED_DATABASE debe ser exactamente '${TARGET_DATABASE_CONSTANT}' — valor recibido no coincide.`,
      { expected: TARGET_DATABASE_CONSTANT },
    );
  }

  const EXPECTED_DB_HOST = env.EXPECTED_DB_HOST;
  if (!EXPECTED_DB_HOST) {
    throw new BootstrapError('MISSING_EXPECTED_DB_HOST', 'EXPECTED_DB_HOST no está definida.');
  }

  const EXPECTED_SOURCE_SHA = env.EXPECTED_SOURCE_SHA;
  if (!EXPECTED_SOURCE_SHA) {
    throw new BootstrapError('MISSING_EXPECTED_SOURCE_SHA', 'EXPECTED_SOURCE_SHA no está definida.');
  }

  return {
    MIGRATION_DATABASE_URL,
    BOOTSTRAP_MODE,
    EPHEMERAL_ADMIN_USERNAME,
    EXPECTED_DATABASE,
    EXPECTED_DB_HOST,
    EXPECTED_SOURCE_SHA,
  };
}

// =============================================================================
// Statements fijos — construidos ÚNICAMENTE a partir de un
// EPHEMERAL_ADMIN_USERNAME ya validado contra el patrón exacto (ver
// `readRequiredBootstrapEnv`). Nunca se acepta SQL arbitrario de ninguna
// fuente — estas son las DOS únicas formas de statement que este archivo
// puede ejecutar, en total.
// =============================================================================

export function buildGrantAdminOptionStatement(ephemeralAdminUsername: string): string {
  if (!EPHEMERAL_ADMIN_USERNAME_PATTERN.test(ephemeralAdminUsername)) {
    throw new BootstrapError('INVALID_EPHEMERAL_ADMIN_USERNAME_FORMAT', 'buildGrantAdminOptionStatement: username no válido.');
  }
  return `GRANT ${BOOTSTRAP_TARGET_ROLE} TO ${ephemeralAdminUsername} WITH ADMIN OPTION;`;
}

export function buildRevokeAdminOptionStatement(ephemeralAdminUsername: string): string {
  if (!EPHEMERAL_ADMIN_USERNAME_PATTERN.test(ephemeralAdminUsername)) {
    throw new BootstrapError('INVALID_EPHEMERAL_ADMIN_USERNAME_FORMAT', 'buildRevokeAdminOptionStatement: username no válido.');
  }
  return `REVOKE ${BOOTSTRAP_TARGET_ROLE} FROM ${ephemeralAdminUsername};`;
}

// =============================================================================
// Conexión — nunca se sobreescribe `ssl` (misma lección que
// `db-role-hardener.ts`/`db-readonly-inspector.ts`).
// =============================================================================

function createClient(migrationDatabaseUrl: string): Client {
  return new Client({
    connectionString: migrationDatabaseUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'korixa-db-hardener-bootstrap',
  });
}

interface ConnectedIdentity {
  currentUser: string;
}

// =============================================================================
// Parseo/validación del DSN — reutiliza las funciones puras ya auditadas de
// `db-role-hardener.ts` (evita duplicar esa lógica), pero traduce cualquier
// `HardenerError` resultante al código `BootstrapError` equivalente, para que
// la superficie de error pública de ESTE módulo sea siempre `BootstrapError`
// — nunca una mezcla de dos clases de error distintas.
// =============================================================================

const HARDENER_TO_BOOTSTRAP_ERROR_CODE: Record<string, BootstrapErrorCode> = {
  INVALID_MIGRATION_DATABASE_URL: 'INVALID_MIGRATION_DATABASE_URL',
  DATABASE_HOST_MISMATCH: 'DATABASE_HOST_MISMATCH',
  DATABASE_NAME_MISMATCH: 'DATABASE_NAME_MISMATCH',
};

function parseAndValidateTarget(migrationDatabaseUrl: string, expectedHost: string, expectedDatabase: string): void {
  try {
    const parsed = parseConnectionString(migrationDatabaseUrl);
    assertExpectedTarget(parsed, expectedHost, expectedDatabase);
  } catch (error) {
    if (error instanceof HardenerError) {
      const mappedCode = HARDENER_TO_BOOTSTRAP_ERROR_CODE[error.code];
      if (mappedCode) throw new BootstrapError(mappedCode, error.message, error.evidence);
    }
    throw sanitizeUnexpectedError('UNEXPECTED_BOOTSTRAP_ERROR', 'Error inesperado validando MIGRATION_DATABASE_URL');
  }
}

async function connectAndIdentify(client: Client): Promise<ConnectedIdentity> {
  try {
    await client.connect();
  } catch (error: unknown) {
    throw sanitizeUnexpectedError('DB_CONNECTION_FAILED', 'No se pudo conectar a la base de datos', {
      connection_failure_class: classifySafeConnectionFailure(error),
    });
  }
  const identityResult = await client.query('SELECT current_user AS current_user;');
  const row = identityResult.rows[0] as { current_user: string };
  return { currentUser: row.current_user };
}

function assertConnectedIsEphemeralAdmin(currentUser: string, expected: string): void {
  if (currentUser !== expected) {
    throw new BootstrapError(
      'CONNECTED_IDENTITY_NOT_EPHEMERAL_ADMIN',
      'current_user no coincide con EPHEMERAL_ADMIN_USERNAME — el bootstrap/revoke siempre corre bajo la identidad efímera exacta, nunca se infiere ni se asume.',
    );
  }
}

// =============================================================================
// grant-admin-option — la única mutación de este modo.
// =============================================================================

export interface BootstrapGrantResult {
  mode: 'grant-admin-option';
  source_sha: string;
  ephemeral_admin_username: string;
  outcome: 'ADMIN_OPTION_GRANTED';
}

export async function runGrantAdminOption(env: BootstrapEnv): Promise<BootstrapGrantResult> {
  parseAndValidateTarget(env.MIGRATION_DATABASE_URL, env.EXPECTED_DB_HOST, env.EXPECTED_DATABASE);

  const client = createClient(env.MIGRATION_DATABASE_URL);
  let connected = false;
  try {
    const identity = await connectAndIdentify(client);
    connected = true;
    assertConnectedIsEphemeralAdmin(identity.currentUser, env.EPHEMERAL_ADMIN_USERNAME);

    const statement = buildGrantAdminOptionStatement(env.EPHEMERAL_ADMIN_USERNAME);
    try {
      await client.query(statement);
    } catch {
      throw sanitizeUnexpectedError('GRANT_ADMIN_OPTION_FAILED', 'Falló GRANT ... WITH ADMIN OPTION');
    }

    return {
      mode: 'grant-admin-option',
      source_sha: env.EXPECTED_SOURCE_SHA,
      ephemeral_admin_username: env.EPHEMERAL_ADMIN_USERNAME,
      outcome: 'ADMIN_OPTION_GRANTED',
    };
  } catch (error) {
    if (error instanceof BootstrapError) throw error;
    throw sanitizeUnexpectedError('UNEXPECTED_BOOTSTRAP_ERROR', 'Error inesperado durante grant-admin-option');
  } finally {
    if (connected) {
      await client.end().catch(() => {});
    }
  }
}

// =============================================================================
// revoke-admin-option — idempotente por semántica nativa de PostgreSQL:
// `REVOKE role FROM member` sobre una membresía inexistente emite un NOTICE,
// nunca un error — no se necesita manejo especial acá para ese caso. La
// idempotencia "admin ya eliminado" se resuelve en la capa de orquestación
// (el workflow solo despacha este Job si el admin efímero todavía existe),
// ya que sin el usuario Postgres el propio DSN no podría autenticar.
// =============================================================================

export interface BootstrapRevokeResult {
  mode: 'revoke-admin-option';
  source_sha: string;
  ephemeral_admin_username: string;
  outcome: 'ADMIN_OPTION_REVOKED';
}

export async function runRevokeAdminOption(env: BootstrapEnv): Promise<BootstrapRevokeResult> {
  parseAndValidateTarget(env.MIGRATION_DATABASE_URL, env.EXPECTED_DB_HOST, env.EXPECTED_DATABASE);

  const client = createClient(env.MIGRATION_DATABASE_URL);
  let connected = false;
  try {
    const identity = await connectAndIdentify(client);
    connected = true;
    assertConnectedIsEphemeralAdmin(identity.currentUser, env.EPHEMERAL_ADMIN_USERNAME);

    const statement = buildRevokeAdminOptionStatement(env.EPHEMERAL_ADMIN_USERNAME);
    try {
      await client.query(statement);
    } catch {
      throw sanitizeUnexpectedError('REVOKE_ADMIN_OPTION_FAILED', 'Falló REVOKE ... FROM <admin efímero>');
    }

    return {
      mode: 'revoke-admin-option',
      source_sha: env.EXPECTED_SOURCE_SHA,
      ephemeral_admin_username: env.EPHEMERAL_ADMIN_USERNAME,
      outcome: 'ADMIN_OPTION_REVOKED',
    };
  } catch (error) {
    if (error instanceof BootstrapError) throw error;
    throw sanitizeUnexpectedError('UNEXPECTED_BOOTSTRAP_ERROR', 'Error inesperado durante revoke-admin-option');
  } finally {
    if (connected) {
      await client.end().catch(() => {});
    }
  }
}

// =============================================================================
// Dispatcher — única función invocada por el entrypoint CLI real.
// =============================================================================

export type BootstrapResult = BootstrapGrantResult | BootstrapRevokeResult;

export async function runBootstrap(): Promise<BootstrapResult> {
  const env = readRequiredBootstrapEnv();
  switch (env.BOOTSTRAP_MODE) {
    case 'grant-admin-option':
      return runGrantAdminOption(env);
    case 'revoke-admin-option':
      return runRevokeAdminOption(env);
  }
}

if (require.main === module) {
  runBootstrap()
    .then((result) => {
      // Único punto de salida de evidencia — JSON estructurado, campos
      // aprobados únicamente. Nunca MIGRATION_DATABASE_URL cruda.
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      const safe =
        error instanceof BootstrapError
          ? { error_code: error.code, message: error.message, evidence: error.evidence }
          : {
              error_code: 'UNEXPECTED_BOOTSTRAP_ERROR' as BootstrapErrorCode,
              message: 'Ocurrió un error inesperado, de un tipo no reconocido — nunca se serializa el error crudo, su mensaje ni su stack.',
              evidence: undefined,
            };
      process.stderr.write(`${JSON.stringify(safe, null, 2)}\n`);
      process.exitCode = 1;
    });
}
