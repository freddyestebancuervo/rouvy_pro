import * as fs from 'fs';
import * as path from 'path';

/**
 * TASK21-PHASE21B (T-F1.3, Goal 7/8) — prueba de contrato para el
 * esqueleto de despliegue de Staging
 * (`.github/workflows/backend-deploy-staging.yml`). Mismo patrón que
 * `hardener-workflow-contract.spec.ts` (TF12): extrae el YAML real y
 * verifica su contenido operativo, nunca solo su existencia.
 *
 * Objetivo específico: probar, de forma automatizada y repetible, que
 * este esqueleto NUNCA adquiere accidentalmente un identificador real de
 * Producción o de Development (project ID, project number, WIF
 * provider, service account, nombre de servicio Cloud Run/Cloud SQL) —
 * ninguno de los dos entornos reales debe poder filtrarse a Staging por
 * copy-paste o por un futuro edit descuidado — y que el workflow es
 * mecánicamente incapaz de desplegar nada (sin autenticación WIF, sin
 * job de deploy).
 */
const WORKFLOW_PATH = path.resolve(__dirname, '../../../.github/workflows/backend-deploy-staging.yml');
const source = fs.readFileSync(WORKFLOW_PATH, 'utf8');

// Identificadores reales conocidos de Development y Producción — nunca
// deben aparecer en el esqueleto de Staging. Extraídos de los propios
// workflows reales (`backend-deploy-development.yml`,
// `production-db-role-hardening.yml`, `production-deploy.yml`), nunca
// inventados.
const FORBIDDEN_REAL_IDENTIFIERS = [
  'ridepro-development', // project ID de Development
  'ridepro-dbafe', // project ID de Producción
  '1020003121433', // project number de Development
  '731660820861', // project number de Producción
  'ridepro-github-deployer', // WIF SA de Development
  'ridepro-backend-dev', // Cloud Run service / Cloud SQL prefix de Development
  'ridepro-backend-dev-pg', // Cloud SQL instance de Development
  'korixa-production-deployer', // WIF SA de Producción (DEPLOYER_SA, Task 20)
  'korixa-prod-migration-exec', // SA de Producción (MIGRATION_EXECUTOR_SA, Task 20)
  'korixa-production-postgres', // Cloud SQL instance de Producción
  'github-production-deployer', // WIF provider de Producción
  'github-actions-provider', // WIF provider de Development
];

describe('backend-deploy-staging.yml — esqueleto inerte, provider-neutral (TASK21-PHASE21B)', () => {
  it('el archivo existe y no está vacío', () => {
    expect(source.length).toBeGreaterThan(100);
  });

  it.each(FORBIDDEN_REAL_IDENTIFIERS)('nunca contiene el identificador real %s (ni de Producción ni de Development)', (identifier) => {
    expect(source).not.toContain(identifier);
  });

  it('el trigger es exclusivamente workflow_dispatch — nunca push/schedule/pull_request', () => {
    const onBlock = source.split(/\non:/)[1]?.split(/\npermissions:/)[0] ?? '';
    expect(onBlock).toMatch(/workflow_dispatch/);
    expect(onBlock).not.toMatch(/\bpush:/);
    expect(onBlock).not.toMatch(/\bschedule:/);
    expect(onBlock).not.toMatch(/\bpull_request:/);
  });

  it('nunca declara id-token: write — no hay ningún step de autenticación WIF que lo justifique', () => {
    expect(source).not.toMatch(/id-token:\s*write/);
  });

  it('nunca referencia un GitHub Environment (`environment:`) — ese Environment no existe todavía y crearlo está fuera de alcance', () => {
    expect(source).not.toMatch(/^\s*environment:\s*\S/m);
  });

  it('nunca contiene un step de autenticación google-github-actions/auth — mecánicamente no puede obtener credenciales cloud', () => {
    expect(source).not.toMatch(/google-github-actions\/auth/);
  });

  it('nunca contiene un comando gcloud/docker/firebase real — ningún job de build/push/deploy existe todavía', () => {
    expect(source).not.toMatch(/\bgcloud (run|sql|secrets|artifacts) /);
    expect(source).not.toMatch(/\bdocker (build|push) /);
    expect(source).not.toMatch(/\bfirebase deploy/);
  });

  it('el único job (guard) siempre falla explícitamente con exit 1 — nunca puede completar con éxito hoy', () => {
    expect(source).toMatch(/exit 1/);
    expect(source).toMatch(/HOLD_STAGING_DEPLOY_NOT_AUTHORIZED/);
  });

  it('el mensaje de guard documenta la razón exacta (D8 sin reconciliar, sin recursos de staging) — nunca un fallo silencioso/genérico', () => {
    expect(source).toMatch(/D8_STAGING_POSTPONEMENT_UNRECONCILED/);
    expect(source).toMatch(/Documento 23/);
  });

  it('permissions de nivel de archivo se limitan a contents: read — nunca write, nunca id-token', () => {
    expect(source).toMatch(/\npermissions:\s*\n\s*contents:\s*read\s*\n/);
  });

  // TASK21-PHASE21B-PR116-FINAL-AUDIT-CERTIFICATION — hallazgo del
  // auditor B (Area 4): las pruebas anteriores son todas de patrón
  // prohibido (blocklist) — ninguna prueba que el archivo tenga
  // EXACTAMENTE un job. Un futuro job agregado junto a `guard` (sin
  // `needs: [guard]`, sin repetir ninguno de los strings prohibidos de
  // arriba — p. ej. un `uses:` a un workflow reusable existente, un
  // `gcloud storage`/`gcloud functions deploy`, un `curl` directo a una
  // API de GCP, o una referencia a `${{ secrets.* }}`/`${{ vars.* }}`)
  // pasaría TODAS las pruebas anteriores sin ser detectado. Esta prueba
  // estructural (allowlist, no blocklist) cierra ese hueco: prueba la
  // lista COMPLETA de jobs del archivo, no solo la ausencia de patrones
  // conocidos.
  it('el archivo declara EXACTAMENTE un job (guard) — ningún job adicional puede agregarse sin que esta prueba falle primero', () => {
    const jobsBlock = source.split(/\njobs:\n/)[1] ?? '';
    const jobNames = [...jobsBlock.matchAll(/^ {2}([a-zA-Z_][\w-]*):\s*$/gm)].map((m) => m[1]);

    expect(jobNames).toEqual(['guard']);
  });

  it('el job guard tiene permissions: {} explícito — ni siquiera contents: read a nivel de job, cero permisos heredados', () => {
    expect(source).toMatch(/guard:\n(?:.*\n)*?\s*permissions:\s*\{\}/);
  });

  it('el archivo nunca referencia ${{ secrets.* }} ni ${{ vars.* }} — ninguna configuración de despliegue puede inyectarse hoy, y un futuro edit que lo intente en `guard` mismo (sin agregar un job nuevo) también debe fallar esta prueba', () => {
    expect(source).not.toMatch(/\$\{\{\s*secrets\./);
    expect(source).not.toMatch(/\$\{\{\s*vars\./);
  });
});
