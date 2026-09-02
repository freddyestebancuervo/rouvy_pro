import * as fs from 'fs';
import * as path from 'path';

/**
 * T-F1.2 Point 8C — contrato estático del workflow efímero. Parsea el YAML
 * real (nunca una copia/paráfrasis) y prueba, mecánicamente, las
 * invariantes de seguridad centrales de las Phases 7/8/9/11/12/14/15 de la
 * misión: separación de gates, drift de contexto, cleanup siempre
 * intentado, cero acoplamiento con migraciones.
 */

const WORKFLOW_PATH = path.resolve(
  __dirname,
  '../../../.github/workflows/production-db-role-hardener-ephemeral.yml',
);
const source = fs.readFileSync(WORKFLOW_PATH, 'utf8');

/** Extrae el texto de un job por nombre — desde su línea `  <name>:` hasta
 * la siguiente línea de job de nivel superior (2 espacios de indentación) o
 * fin de archivo. Evitamos depender de un parser YAML (solo transitivo en
 * este proyecto, no una dependencia directa) — todo el contrato se prueba
 * por coincidencia de texto sobre el archivo real, nunca una copia. */
function jobSource(jobName: string): string {
  const re = new RegExp(`\\n  ${jobName}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z][a-zA-Z0-9_-]*:\\n|$)`);
  const match = re.exec(source);
  if (!match) throw new Error(`No se encontró el job '${jobName}' en el workflow.`);
  return match[1]!;
}

function jobNeeds(jobName: string): string[] {
  const block = jobSource(jobName);
  const singleMatch = /^\s*needs:\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*$/m.exec(block);
  if (singleMatch) return [singleMatch[1]!];
  const listMatch = /^\s*needs:\s*\[([^\]]*)\]/m.exec(block);
  if (listMatch) return listMatch[1]!.split(',').map((s) => s.trim());
  return [];
}

describe('production-db-role-hardener-ephemeral.yml — contrato estructural', () => {
  it('el trigger es únicamente workflow_dispatch — nunca push/pull_request/schedule/workflow_run', () => {
    const onBlock = /\non:\n([\s\S]*?)\npermissions:/.exec(source)?.[1] ?? '';
    expect(onBlock).toMatch(/workflow_dispatch:/);
    for (const forbidden of ['push:', 'pull_request:', 'schedule:', 'workflow_run:']) {
      expect(onBlock).not.toMatch(new RegExp(`^\\s*${forbidden}`, 'm'));
    }
  });

  it('expone exactamente los 4 inputs esperados: mode, operation_id, operation_source_sha, confirmation', () => {
    const inputsBlock = /workflow_dispatch:\n {4}inputs:\n([\s\S]*?)\npermissions:/.exec(source)?.[1] ?? '';
    const inputNames = [...inputsBlock.matchAll(/^ {6}([a-zA-Z_]+):\n/gm)].map((m) => m[1]);
    expect(inputNames.sort()).toEqual(['confirmation', 'mode', 'operation_id', 'operation_source_sha'].sort());
  });

  it('mode es un choice de exactamente 3 opciones: bootstrap_and_preflight, apply, cleanup_only', () => {
    const modeBlock = /^ {6}mode:\n([\s\S]*?)\n {6}operation_id:/m.exec(source)?.[1] ?? '';
    expect(modeBlock).toMatch(/type: choice/);
    const options = [...modeBlock.matchAll(/^ {10}- (\S+)/gm)].map((m) => m[1]);
    expect(options.sort()).toEqual(['apply', 'bootstrap_and_preflight', 'cleanup_only'].sort());
  });

  it('Phase 7/8 — bootstrap_and_preflight y apply exigen tokens de confirmación DISTINTOS entre sí', () => {
    const preflightToken = /bootstrap_and_preflight\) EXPECTED_CONFIRMATION="([A-Z_]+)"/.exec(source)?.[1];
    const applyToken = /apply\)\s+EXPECTED_CONFIRMATION="([A-Z_]+)"/.exec(source)?.[1];
    expect(preflightToken).toBeDefined();
    expect(applyToken).toBeDefined();
    expect(preflightToken).not.toBe(applyToken);
  });

  it('Phase 8 — el guard exige operation_source_sha == github.sha EXCLUSIVAMENTE para mode=apply (drift check)', () => {
    expect(source).toMatch(/if \[ "\$MODE" = "apply" \][\s\S]{0,400}OPERATION_SOURCE_SHA.*=.*SHA/);
    expect(source).toMatch(/HOLD_OPERATION_CONTEXT_DRIFT/);
  });

  it('Phase 8 — apply requiere verify-operation-context como needs antes de mutar nada', () => {
    const applyBlock = jobSource('apply');
    expect(jobNeeds('apply')).toContain('verify-operation-context');
    expect(applyBlock).toMatch(/needs\.verify-operation-context\.outputs\.context_verified == 'YES'/);
  });

  it('Phase 7 — bootstrap_and_preflight nunca tiene una arista needs hacia apply/remove-target-cloudsqlsuperuser', () => {
    for (const job of ['bootstrap-ephemeral-admin', 'preflight']) {
      const needs = jobNeeds(job);
      expect(needs).not.toContain('apply');
      expect(needs).not.toContain('remove-target-cloudsqlsuperuser');
    }
  });

  it('Phase 7 — stage1-summary nunca ejecuta el Job de apply ni limpia recursos (solo lee outputs, no gcloud sql/secrets mutation)', () => {
    const stage1Source = source.split('stage1-summary:')[1]!.split('verify-operation-context:')[0]!;
    expect(stage1Source).not.toMatch(/gcloud sql users (create|delete|assign-roles)/);
    expect(stage1Source).not.toMatch(/gcloud secrets (create|delete)/);
  });

  it('Phase 9 — la remoción de cloudsqlsuperuser del target usa assign-roles --revoke-existing-roles, NUNCA "REVOKE cloudsqlsuperuser"', () => {
    const removalSource = source.split('remove-target-cloudsqlsuperuser:')[1]!.split('# ===')[0]!;
    expect(removalSource).toMatch(/assign-roles.*--revoke-existing-roles/s);
    expect(removalSource).not.toMatch(/REVOKE\s+cloudsqlsuperuser/i);
  });

  it('Phase 11 — cleanup-after-apply tiene if: always() — se intenta sin importar el resultado de apply/remove/verify', () => {
    const block = jobSource('cleanup-after-apply');
    expect(block).toMatch(/if: always\(\) &&/);
  });

  it('Phase 11 — cleanup-after-apply revoca ADMIN OPTION ANTES de eliminar el admin efímero (orden textual: revoke-admin-option precede a delete-admin)', () => {
    const cleanupSource = source.split('cleanup-after-apply:')[1]!.split('cleanup-only:')[0]!;
    const revokeIdx = cleanupSource.indexOf('id: revoke-admin-option');
    const deleteIdx = cleanupSource.indexOf('id: delete-admin');
    expect(revokeIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(revokeIdx).toBeLessThan(deleteIdx);
  });

  it('Phase 11 — la clasificación final distingue explícitamente HOLD_OPERATION_FAILED_AND_PRIVILEGED_CLEANUP_INCOMPLETE de un simple fallo de operación', () => {
    expect(source).toMatch(/HOLD_OPERATION_FAILED_AND_PRIVILEGED_CLEANUP_INCOMPLETE/);
    expect(source).toMatch(/HOLD_CLEANUP_INCOMPLETE/);
  });

  it('Phase 12 — cleanup_only nunca contiene un verbo "create" de gcloud sql/secrets en su job', () => {
    const cleanupOnlySource = source.split('cleanup-only:')[1]!;
    expect(cleanupOnlySource).not.toMatch(/gcloud sql users create/);
    expect(cleanupOnlySource).not.toMatch(/gcloud secrets create/);
  });

  it('Phase 12 — cleanup_only es idempotente: cada recurso se comprueba (describe) antes de intentar borrarlo, y "ya ausente" se trata como éxito', () => {
    const cleanupOnlySource = jobSource('cleanup-only');
    expect(cleanupOnlySource).toMatch(/gcloud sql users describe/);
    expect(cleanupOnlySource).toMatch(/gcloud secrets describe/);
    expect(cleanupOnlySource).toMatch(/ALREADY_ABSENT/);
  });

  it('Phase 12 — cleanup_only no exige coincidencia de operation_source_sha (permite recuperación con código más nuevo)', () => {
    const guardSource = source.split('guard:')[1]!.split('prepare-inputs:')[0]!;
    // El único bloque que compara OPERATION_SOURCE_SHA contra SHA está
    // adentro del `if [ "$MODE" = "apply" ]` — nunca en una rama genérica
    // que también cubra cleanup_only.
    expect(guardSource).toMatch(/if \[ "\$MODE" = "apply" \][\s\S]*OPERATION_SOURCE_SHA/);
  });

  it('Phase 14 — cleanup_only registra ORIGINAL_OPERATION_SHA y CLEANUP_IMPLEMENTATION_SHA por separado, nunca los mezcla silenciosamente', () => {
    const cleanupOnlySource = jobSource('cleanup-only');
    expect(cleanupOnlySource).toMatch(/ORIGINAL_OPERATION_SHA/);
    expect(cleanupOnlySource).toMatch(/CLEANUP_IMPLEMENTATION_SHA/);
    expect(cleanupOnlySource).toMatch(/github\.sha/);
  });

  it('Phase 15 — el job de bootstrap otorga IAM a nivel de secreto (add-iam-policy-binding sobre el secret específico), nunca a nivel de proyecto', () => {
    expect(source).toMatch(/gcloud secrets add-iam-policy-binding "\$EPHEMERAL_SECRET"/);
    expect(source).not.toMatch(/gcloud projects add-iam-policy-binding/);
  });

  it('Phase 15 — el único accesor otorgado es MIGRATION_EXECUTOR_SA, nunca DEPLOYER_SA ni un principal más amplio', () => {
    const bootstrapSource = source.split('bootstrap-ephemeral-admin:')[1]!.split('# ===')[0]!;
    expect(bootstrapSource).toMatch(/--member="serviceAccount:\$\{\{ env\.MIGRATION_EXECUTOR_SA \}\}"/);
    expect(bootstrapSource).not.toMatch(/--member="serviceAccount:\$\{\{ env\.DEPLOYER_SA \}\}"[\s\S]*secretmanager/);
  });

  it('Phase 5 — el secret efímero es REGIONAL (--locations=), no global, tal como exige gcloud sql instances execute-sql --password-secret-version', () => {
    expect(source).toMatch(/gcloud secrets create "\$EPHEMERAL_SECRET"[\s\S]*?--locations="\$\{\{ env\.PRODUCTION_REGION \}\}"/);
  });

  it('Phase 6 — el ADMIN OPTION se auto-otorga usando la credencial del propio admin efímero, nunca la de "postgres"', () => {
    const bootstrapSource = source.split('bootstrap-ephemeral-admin:')[1]!.split('# ===')[0]!;
    expect(bootstrapSource).toMatch(/--user="\$EPHEMERAL_ADMIN"/);
    expect(bootstrapSource).not.toMatch(/--user=postgres/);
    expect(bootstrapSource).not.toMatch(/--user="postgres"/);
  });

  it('Phase 3 — el Cloud Run Job efímero nunca se despliega/ejecuta bajo el nombre del Job persistente legado (solo se lo menciona en prosa, para explicar la distinción)', () => {
    expect(source).not.toMatch(/gcloud run jobs (deploy|execute) "korixa-production-db-role-hardener"/);
    expect(source).not.toMatch(/HARDENER_JOB: korixa-production-db-role-hardener/);
  });

  it('Phase 15 — este workflow NUNCA ejecuta migraciones: ningún paso invoca node-pg-migrate, npm run migrate, ni referencia el directorio migrations/', () => {
    expect(source).not.toMatch(/node-pg-migrate/);
    expect(source).not.toMatch(/npm run migrate/);
    expect(source).not.toMatch(/\bmigrations\//);
  });

  it('el hardener Cloud Run Job SIEMPRE corre exactamente `node dist/ops/db-role-hardener.js` — nunca un shell ni un comando arbitrario', () => {
    const commandMatches = [...source.matchAll(/--command=(\S+)/g)];
    const argsMatches = [...source.matchAll(/--args=(\S+)/g)];
    expect(commandMatches.length).toBeGreaterThan(0);
    for (const m of commandMatches) expect(m[1]).toBe('node');
    for (const m of argsMatches) expect(m[1]).toBe('dist/ops/db-role-hardener.js');
  });

  it('todo job que ejecuta gcloud contra Production declara environment: production (gate adicional de GitHub Environments)', () => {
    const jobsWithGcloudCalls = [
      'bootstrap-ephemeral-admin',
      'verify-prerequisites-instance',
      'preflight',
      'verify-operation-context',
      'apply',
      'remove-target-cloudsqlsuperuser',
      'verify',
      'cleanup-after-apply',
      'cleanup-only',
    ];
    for (const jobName of jobsWithGcloudCalls) {
      const jobSource = source.split(`\n  ${jobName}:`)[1]?.split(/\n {2}[a-zA-Z-]+:\n/)[0] ?? '';
      expect(jobSource).toMatch(/environment: production/);
    }
  });
});
