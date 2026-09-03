/**
 * T-F1.2 Point 8C — IAM P1 remediation
 * (TF12-POINT8C-STAGE1-IAM-P1-ROOT-CAUSE-AND-REMEDIATION-20260903 /
 * TF12-POINT8C-IAM-P1-CODE-REMEDIATION-PREHUMANGATE-20260903).
 *
 * =============================================================================
 * QUÉ ES
 * =============================================================================
 * Única fuente de verdad — el manifiesto exacto de permisos GCP IAM que
 * `korixa-production-deployer@ridepro-dbafe.iam.gserviceaccount.com`
 * (DEPLOYER_SA, la identidad WIF bajo la que corre TODO el control-plane de
 * `production-db-role-hardening.yml`) necesita para completar cada etapa del
 * hardener efímero, más el rol IAM custom que los agrupa y las 2
 * meta-permissions que el propio gate de readiness (Fase 4/`verify-deployer-
 * permissions`) necesita para poder leerse a sí mismo.
 *
 * Este archivo NUNCA conecta a nada ni ejecuta ningún comando — es un módulo
 * puro de datos + funciones de validación, importado por:
 *   - `hardener-workflow-contract.spec.ts` (prueba que el array bash
 *     duplicado en `production-db-role-hardening.yml` coincide EXACTAMENTE
 *     con este manifiesto — nunca dos listas mantenidas independientemente);
 *   - `production-hardener-required-permissions.spec.ts` (prueba las
 *     invariantes del manifiesto en sí: conteo exacto, sin exceso, sin
 *     `secretmanager.versions.access`, sin duplicados).
 *
 * =============================================================================
 * POR QUÉ ESTE ARCHIVO EXISTE
 * =============================================================================
 * El run real de Producción `33718581473` falló con HTTP 403 en `gcloud sql
 * users create` — DEPLOYER_SA nunca tuvo ningún permiso de mutación de
 * Cloud SQL users/Secret Manager. La causa raíz de PROCESO (no solo la de
 * IAM) fue que ninguna auditoría previa comparó nunca el conjunto de
 * permisos REQUERIDOS por el workflow contra el conjunto REALMENTE
 * otorgado — cada auditoría verificó únicamente que el IAM no había
 * cambiado (drift), nunca que fuera SUFICIENTE. Este archivo es la
 * corrección estructural de esa brecha: mientras exista y esté conectado a
 * un test de contrato + a un job de readiness que lo consuma en vivo, un
 * futuro comando mutante agregado al workflow sin actualizar este
 * manifiesto falla el build, no en un run real contra Producción.
 *
 * =============================================================================
 * ARQUITECTURA DE IDENTIDAD — SIN CAMBIOS (confirmado en la investigación
 * previa, TASK TF12-POINT8C-STAGE1-IAM-P1-ROOT-CAUSE-AND-REMEDIATION)
 * =============================================================================
 * DEPLOYER_SA sigue siendo el orquestador de control-plane — ya realiza
 * todas las demás mutaciones de este workflow (Cloud Run Jobs deploy/
 * execute/delete, vía `roles/run.developer`, ya confirmado suficiente en
 * vivo). Agregarle permisos de Cloud SQL users/Secret Manager es la MISMA
 * clase de privilegio que ya ejerce, no una categoría nueva.
 * MIGRATION_EXECUTOR_SA permanece exactamente como está: CERO roles
 * project-level standing, solo el binding `secretmanager.secretAccessor`
 * resource-scoped y efímero (creado/revocado por operación) que ya usa —
 * este archivo NUNCA le agrega nada.
 *
 * =============================================================================
 * POR QUÉ NO roles/cloudsql.admin NI roles/secretmanager.admin
 * =============================================================================
 * `roles/cloudsql.admin` incluye `cloudsql.databases.{create,delete,update}`
 * — gestión de bases de datos que este workflow nunca ejerce (solo LEE
 * `cloudsql.databases.list`, ya otorgado vía `korixaProductionMetadataReader`
 * y sin relación con este manifiesto).
 * `roles/secretmanager.admin` incluye `secretmanager.versions.access` —
 * lectura del PAYLOAD de CUALQUIER secret del proyecto. Otorgarlo a
 * DEPLOYER_SA revertiría, en silencio, la separación de responsabilidades
 * que este diseño mantiene deliberadamente desde su origen: DEPLOYER_SA crea
 * el contenedor del secret efímero y gestiona su IAM/ciclo de vida, pero
 * NUNCA puede leer su contenido — solo MIGRATION_EXECUTOR_SA puede, y solo
 * mediante el binding resource-scoped que el propio bootstrap otorga por
 * operación. `FORBIDDEN_DEPLOYER_PERMISSIONS` hace esta prohibición
 * explícita y testeable, no solo documentada en prosa.
 * =============================================================================
 */

// =============================================================================
// Permisos operativos — las 10 permissions exactas de la mutación de Cloud
// SQL users + Secret Manager que el workflow real ejecuta. Ver el comentario
// junto a cada bloque para el/los comando(s) exacto(s) que lo requieren
// (Fase 1 de la investigación: recorrido completo del archivo, no solo del
// comando que falló).
// =============================================================================

/** `gcloud sql users create` (bootstrap-ephemeral-admin, bootstrap-apply-admin). */
const CLOUDSQL_USERS_CREATE = 'cloudsql.users.create' as const;
/** `gcloud sql users delete` (cleanup-after-preflight, cleanup-after-apply, cleanup-only). */
const CLOUDSQL_USERS_DELETE = 'cloudsql.users.delete' as const;
/** `gcloud sql users assign-roles ... --revoke-existing-roles` (remove-target-cloudsqlsuperuser, Stage 2 únicamente). */
const CLOUDSQL_USERS_UPDATE = 'cloudsql.users.update' as const;
/** `gcloud sql users describe` (verify-target-role-preconditions y los tres jobs de cleanup — el comando más frecuente del archivo). */
const CLOUDSQL_USERS_GET = 'cloudsql.users.get' as const;

/** `gcloud secrets create` (bootstrap-ephemeral-admin, bootstrap-apply-admin). */
const SECRETMANAGER_SECRETS_CREATE = 'secretmanager.secrets.create' as const;
/** `gcloud secrets delete` (los tres jobs de cleanup). */
const SECRETMANAGER_SECRETS_DELETE = 'secretmanager.secrets.delete' as const;
/** `gcloud secrets describe` (usado en casi todos los jobs para chequeos de existencia idempotentes). */
const SECRETMANAGER_SECRETS_GET = 'secretmanager.secrets.get' as const;
/** `gcloud secrets add-iam-policy-binding` — mitad de escritura del read-modify-write que ese comando ejecuta internamente. */
const SECRETMANAGER_SECRETS_SET_IAM_POLICY = 'secretmanager.secrets.setIamPolicy' as const;
/** `gcloud secrets add-iam-policy-binding` — mitad de lectura del mismo read-modify-write (gcloud lee la política actual antes de fusionar el nuevo binding). */
const SECRETMANAGER_SECRETS_GET_IAM_POLICY = 'secretmanager.secrets.getIamPolicy' as const;
/** `gcloud secrets versions add` (bootstrap-ephemeral-admin, bootstrap-apply-admin — escribe el DSN efímero como payload). */
const SECRETMANAGER_VERSIONS_ADD = 'secretmanager.versions.add' as const;

// =============================================================================
// Meta-permisos — necesarios para que el propio gate de readiness
// (`verify-deployer-permissions`) pueda leer, en vivo, qué roles tiene
// otorgados DEPLOYER_SA y qué permisos otorga cada uno. Determinados por
// investigación en vivo (Fase 2): `roles/run.developer` incluye
// `resourcemanager.projects.get/.list` pero NO `.getIamPolicy`;
// `korixaProductionMetadataReader` incluye `iam.serviceAccounts.get` pero NO
// `iam.roles.get` ni `iam.serviceAccounts.getIamPolicy`. Sin estos, el
// propio gate no podría ejecutarse como DEPLOYER_SA — se agregan acá,
// explícitamente, en vez de asumirlos o ampliar IAM en silencio.
//
// TF12-POINT8C-IAM-P1-INDEPENDENT-AUDIT-REMEDIATION (P1-B, primera
// versión, SUPERSEDED): esa iteración agregó `iam.serviceAccounts.
// getIamPolicy` para leer la política IAM de MIGRATION_EXECUTOR_SA e
// INFERIR `actAs` de la presencia del binding `roles/iam.serviceAccountUser`.
// Una auditoría independiente posterior rechazó también esa versión — un
// binding conocido NUNCA prueba el permiso EFECTIVO real (una deny
// policy, una condición de organización, o cualquier otro mecanismo IAM
// invisible a `get-iam-policy` podría revocarlo en la práctica).
//
// TF12-POINT8C-IAM-P1-EFFECTIVE-ACTAS-FINAL-REMEDIATION: el chequeo de
// actAs ahora usa `projects.serviceAccounts.testIamPermissions` — el
// método de la propia API de IAM diseñado exactamente para esto, que
// devuelve el permiso EFECTIVO real evaluado por el backend de IAM, nunca
// inferido de un binding visible. Verificado en vivo, de solo lectura,
// durante esta misma investigación: `testIamPermissions` NO exige ningún
// permiso IAM adicional más allá de credenciales autenticadas válidas —
// por eso `iam.serviceAccounts.getIamPolicy` se ELIMINA de este
// manifiesto, no se preserva artificialmente. El rol propuesto vuelve a
// 12 permisos.
// =============================================================================

/** Leer el IAM policy del PROYECTO — necesario para que el gate descubra qué roles tiene DEPLOYER_SA. */
const RESOURCEMANAGER_PROJECTS_GET_IAM_POLICY = 'resourcemanager.projects.getIamPolicy' as const;
/** Leer la definición de un rol CUSTOM del proyecto (los roles predefinidos son públicamente legibles sin este permiso — pero el rol nuevo de este manifiesto es custom). */
const IAM_ROLES_GET = 'iam.roles.get' as const;

export const READINESS_GATE_META_PERMISSIONS = [RESOURCEMANAGER_PROJECTS_GET_IAM_POLICY, IAM_ROLES_GET] as const;

// =============================================================================
// Permisos PROHIBIDOS explícitamente para DEPLOYER_SA — nunca deben
// aparecer en ningún rol otorgado a esta identidad, sin importar cómo se
// implemente la remediación. `secretmanager.versions.access` es el único
// permiso de esta lista con impacto de seguridad real y directo (lectura de
// payload); el resto de `roles/cloudsql.admin`/`roles/secretmanager.admin`
// que tampoco se otorgan (`cloudsql.databases.create/delete/update`,
// `secretmanager.secrets.rotate`, etc.) no están acá porque nunca fueron
// parte del manifiesto operativo en primer lugar — no hace falta prohibir
// explícitamente algo que nunca se propuso incluir.
// =============================================================================

export const FORBIDDEN_DEPLOYER_PERMISSIONS = ['secretmanager.versions.access'] as const;

// =============================================================================
// Manifiesto por etapa — separado explícitamente, per Fase 3. Cada
// permission aparece en TODAS las etapas donde algún comando real la
// requiere (algunas se repiten entre etapas — p. ej. CLOUDSQL_USERS_GET es
// necesaria en las tres).
// =============================================================================

export const STAGE1_REQUIRED_PERMISSIONS = [
  CLOUDSQL_USERS_CREATE,
  CLOUDSQL_USERS_GET,
  SECRETMANAGER_SECRETS_CREATE,
  SECRETMANAGER_SECRETS_GET,
  SECRETMANAGER_SECRETS_SET_IAM_POLICY,
  SECRETMANAGER_SECRETS_GET_IAM_POLICY,
  SECRETMANAGER_VERSIONS_ADD,
] as const;

export const STAGE2_REQUIRED_PERMISSIONS = [
  CLOUDSQL_USERS_CREATE,
  CLOUDSQL_USERS_UPDATE,
  CLOUDSQL_USERS_GET,
  SECRETMANAGER_SECRETS_CREATE,
  SECRETMANAGER_SECRETS_GET,
  SECRETMANAGER_SECRETS_SET_IAM_POLICY,
  SECRETMANAGER_SECRETS_GET_IAM_POLICY,
  SECRETMANAGER_VERSIONS_ADD,
] as const;

export const CLEANUP_REQUIRED_PERMISSIONS = [
  CLOUDSQL_USERS_DELETE,
  CLOUDSQL_USERS_GET,
  SECRETMANAGER_SECRETS_DELETE,
  SECRETMANAGER_SECRETS_GET,
] as const;

/** Unión deduplicada y ordenada de forma estable — el conjunto exacto de 10
 * permisos operativos que la investigación previa determinó completo,
 * mínimo y sin exceso (Fase 1). Nunca se deriva incluyendo
 * `cloudsql.users.list`: ningún comando real del workflow lo requiere hoy —
 * agregarlo "por si acaso" sería exactamente el tipo de exceso no
 * justificado que este manifiesto existe para prevenir. */
export const ALL_REQUIRED_DEPLOYER_PERMISSIONS: readonly string[] = Array.from(
  new Set([...STAGE1_REQUIRED_PERMISSIONS, ...STAGE2_REQUIRED_PERMISSIONS, ...CLEANUP_REQUIRED_PERMISSIONS]),
).sort();

/** Longitud esperada, documentada explícitamente (Fase 6: "PERMISSION_COUNT
 * = ..., EXCESS_PERMISSION_COUNT = 0") — un test dedicado prueba que este
 * número nunca cambia sin que quien lo cambie lo haga a propósito. */
export const EXPECTED_ALL_REQUIRED_DEPLOYER_PERMISSIONS_COUNT = 10;

// =============================================================================
// Rol IAM custom propuesto — Fase 6. Artefacto DISEÑADO Y REVISADO, NUNCA
// creado en GCP por este código ni por ningún test — ningún test de este
// repositorio ejecuta `gcloud iam roles create`. La creación real requiere
// su propio Human Gate (IAM_CUSTOM_ROLE_CREATE_AND_GRANT), fuera del
// alcance de esta tarea.
// =============================================================================

export interface ProposedCustomRoleDefinition {
  readonly roleId: string;
  readonly title: string;
  readonly description: string;
  readonly stage: 'GA' | 'BETA' | 'ALPHA';
  readonly includedPermissions: readonly string[];
}

export const PROPOSED_HARDENER_ORCHESTRATOR_ROLE: ProposedCustomRoleDefinition = {
  roleId: 'korixaProductionDbHardenerOrchestrator',
  title: 'Korixa Production DB Hardener Orchestrator',
  description:
    'Purpose-scoped control-plane permissions for the ephemeral DB role hardener orchestrator ' +
    '(korixa-production-deployer@ridepro-dbafe.iam.gserviceaccount.com only). Grants exactly the Cloud SQL ' +
    'user lifecycle and Secret Manager secret lifecycle permissions the production-db-role-hardening.yml ' +
    'workflow requires, plus the minimum IAM-metadata-read permissions its own effective-permission readiness ' +
    'gate needs to verify itself before any mutation. Deliberately excludes secretmanager.versions.access ' +
    '(secret payload read — reserved exclusively for korixa-prod-migration-exec, resource-scoped, per ' +
    'operation) and all Cloud SQL database-lifecycle permissions (this role never creates/drops/alters ' +
    'databases, only ephemeral users).',
  stage: 'GA',
  includedPermissions: [...ALL_REQUIRED_DEPLOYER_PERMISSIONS, ...READINESS_GATE_META_PERMISSIONS].sort(),
};

export const EXPECTED_PROPOSED_ROLE_PERMISSION_COUNT = 12;

// =============================================================================
// Validación pura — usada por los tests de contrato, nunca por sí sola en
// producción (el gate de readiness real vive en el workflow YAML, en bash,
// espejando este mismo conjunto — ver `hardener-workflow-contract.spec.ts`).
// =============================================================================

export interface PermissionGapReport {
  readonly missing: readonly string[];
  readonly forbiddenButPresent: readonly string[];
  readonly sufficient: boolean;
}

/** Función pura: dado el conjunto de permisos que una identidad realmente
 * tiene (ya expandido desde sus roles), determina si cubre exactamente lo
 * requerido y si contiene algo explícitamente prohibido. Nunca conecta a
 * IAM — el caller (el job de readiness, o un test) es quien obtiene
 * `grantedPermissions` primero. */
export function evaluatePermissionSufficiency(grantedPermissions: ReadonlySet<string>): PermissionGapReport {
  const required = [...ALL_REQUIRED_DEPLOYER_PERMISSIONS, ...READINESS_GATE_META_PERMISSIONS];
  const missing = required.filter((permission) => !grantedPermissions.has(permission));
  const forbiddenButPresent = FORBIDDEN_DEPLOYER_PERMISSIONS.filter((permission) => grantedPermissions.has(permission));
  return {
    missing,
    forbiddenButPresent,
    sufficient: missing.length === 0 && forbiddenButPresent.length === 0,
  };
}
