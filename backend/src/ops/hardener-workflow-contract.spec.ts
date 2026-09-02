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

  it('Phase 15 — el job de bootstrap otorga IAM a nivel de secreto (add-iam-policy-binding sobre el DSN SECRET específico), nunca a nivel de proyecto', () => {
    expect(source).toMatch(/gcloud secrets add-iam-policy-binding "\$EPHEMERAL_DSN_SECRET"/);
    expect(source).not.toMatch(/gcloud projects add-iam-policy-binding/);
  });

  // ===========================================================================
  // PR #115 P1-B remediation (TF12-POINT8C-PR115-FINAL-INTEGRATION) —
  // arquitectura enteramente VPC privada: sin ExecuteSql API, sin
  // dataApiAccess, sin secret regional de password. El GRANT/REVOKE del
  // ADMIN OPTION corre por el mismo Cloud Run Job efímero que preflight/
  // apply/verify, invocando `db-hardener-bootstrap.js`. Fase 8 de la misión
  // de remediación exige explícitamente: EXECUTE_SQL_REFERENCES=0,
  // DATA_API_ENABLE_REFERENCES=0, REGIONAL_SECRET_OPERATION_REFERENCES=0.
  // ===========================================================================
  describe('PR #115 P1-B remediation — arquitectura VPC privada, un solo secret DSN', () => {
    const bootstrapSource = source.split('bootstrap-ephemeral-admin:')[1]!.split('# ===')[0]!;
    const cleanupAfterApplySource = source.split('cleanup-after-apply:')[1]!.split('cleanup-only:')[0]!;
    const cleanupOnlySource = jobSource('cleanup-only');

    function operationalLines(text: string): string[] {
      return text.split('\n').filter((line) => !line.trim().startsWith('#'));
    }

    it('1. EXECUTE_SQL_REFERENCES = 0 — ninguna línea operativa invoca gcloud sql instances execute-sql (solo prosa histórica en comentarios)', () => {
      const hits = operationalLines(source).filter((line) => /execute-sql/.test(line));
      expect(hits).toEqual([]);
    });

    it('2. DATA_API_ENABLE_REFERENCES = 0 — ninguna línea operativa referencia dataApiAccess/ALLOW_DATA_API/--data-api-access= (solo prosa histórica)', () => {
      const hits = operationalLines(source).filter((line) => /dataApiAccess|ALLOW_DATA_API|--data-api-access=/.test(line));
      expect(hits).toEqual([]);
    });

    it('3. REGIONAL_SECRET_OPERATION_REFERENCES = 0 — ningún --location= operativo, ningún REGIONAL_SM_BASE, ningún curl a secretmanager.*.rep.googleapis.com', () => {
      const hits = operationalLines(source).filter(
        (line) => /--location=/.test(line) || /REGIONAL_SM_BASE/.test(line) || /secretmanager\.[^"]*\.rep\.googleapis\.com/.test(line),
      );
      expect(hits).toEqual([]);
      expect(source).not.toMatch(/curl /);
    });

    it('4. un único secret efímero (DSN global) existe en todo el archivo — ninguna referencia a EPHEMERAL_PASSWORD_SECRET/password secret regional', () => {
      expect(source).not.toMatch(/EPHEMERAL_PASSWORD_SECRET/);
      expect(source).toMatch(/EPHEMERAL_DSN_SECRET_PREFIX:/);
      const dsnUses = [...source.matchAll(/EPHEMERAL_DSN_SECRET\b/g)];
      expect(dsnUses.length).toBeGreaterThan(5);
    });

    it('5. bootstrap-ephemeral-admin otorga el ADMIN OPTION vía el Cloud Run Job efímero con BOOTSTRAP_MODE=grant-admin-option, por el camino VPC privado exacto (mismo network/subnet/vpc-egress que preflight/apply/verify)', () => {
      expect(bootstrapSource).toMatch(/--args=dist\/ops\/db-hardener-bootstrap\.js/);
      expect(bootstrapSource).toMatch(/BOOTSTRAP_MODE=grant-admin-option/);
      expect(bootstrapSource).toMatch(/--service-account="\$\{\{ env\.MIGRATION_EXECUTOR_SA \}\}"/);
      expect(bootstrapSource).toMatch(/--network=korixa-production-vpc/);
      expect(bootstrapSource).toMatch(/--subnet=korixa-production-sa-east1/);
      expect(bootstrapSource).toMatch(/--vpc-egress=private-ranges-only/);
      expect(bootstrapSource).toMatch(/--set-secrets="MIGRATION_DATABASE_URL=\$\{EPHEMERAL_DSN_SECRET\}:latest"/);
    });

    it('6. cleanup-after-apply revoca el ADMIN OPTION vía el mismo Cloud Run Job con BOOTSTRAP_MODE=revoke-admin-option, por el mismo camino VPC privado — nunca execute-sql', () => {
      expect(cleanupAfterApplySource).toMatch(/--args=dist\/ops\/db-hardener-bootstrap\.js/);
      expect(cleanupAfterApplySource).toMatch(/BOOTSTRAP_MODE=revoke-admin-option/);
      expect(cleanupAfterApplySource).toMatch(/--vpc-egress=private-ranges-only/);
      expect(cleanupAfterApplySource).not.toMatch(/execute-sql/);
    });

    it('7. cleanup_only también revoca vía el Cloud Run Job privado — solo si el admin y el secret DSN todavía existen — nunca execute-sql', () => {
      expect(cleanupOnlySource).toMatch(/--args=dist\/ops\/db-hardener-bootstrap\.js/);
      expect(cleanupOnlySource).toMatch(/BOOTSTRAP_MODE=revoke-admin-option/);
      expect(cleanupOnlySource).not.toMatch(/execute-sql/);
      // Orden: describe del admin ANTES del deploy del Job de revoke.
      const adminCheckIdx = cleanupOnlySource.indexOf('gcloud sql users describe "$EPHEMERAL_ADMIN"');
      const revokeJobIdx = cleanupOnlySource.indexOf('BOOTSTRAP_MODE=revoke-admin-option');
      expect(adminCheckIdx).toBeGreaterThan(-1);
      expect(revokeJobIdx).toBeGreaterThan(-1);
      expect(adminCheckIdx).toBeLessThan(revokeJobIdx);
    });

    it('8. BOOTSTRAP_MODE nunca recibe un valor fuera de {grant-admin-option, revoke-admin-option} en ningún job — nunca SQL arbitrario inyectado vía env var', () => {
      const modeValues = [...source.matchAll(/BOOTSTRAP_MODE=([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
      expect(modeValues.length).toBeGreaterThan(0);
      for (const value of modeValues) {
        expect(['grant-admin-option', 'revoke-admin-option']).toContain(value);
      }
    });

    it('9. el DSN SECRET es el único secret cuyo IAM se otorga en todo el archivo, y su único accesor es MIGRATION_EXECUTOR_SA (nunca DEPLOYER_SA)', () => {
      const iamGrants = [...source.matchAll(/gcloud secrets add-iam-policy-binding "\$([A-Z_]+)"/g)].map((m) => m[1]);
      expect(iamGrants.length).toBeGreaterThan(0);
      for (const secretVar of iamGrants) expect(secretVar).toBe('EPHEMERAL_DSN_SECRET');
      const dsnIamBlock = /gcloud secrets add-iam-policy-binding "\$EPHEMERAL_DSN_SECRET"[\s\S]*?--quiet/.exec(bootstrapSource)?.[0] ?? '';
      expect(dsnIamBlock).toMatch(/--member="serviceAccount:\$\{\{ env\.MIGRATION_EXECUTOR_SA \}\}"/);
      expect(dsnIamBlock).not.toMatch(/DEPLOYER_SA/);
    });

    it('10. el secret legado korixa-production-migration-database-url (identidad de korixa_app) nunca se referencia operacionalmente (solo se lo menciona en prosa, en el comentario de cabecera)', () => {
      expect(operationalLines(source).some((line) => line.includes('korixa-production-migration-database-url'))).toBe(false);
      const allMentions = [...source.matchAll(/korixa-production-migration-database-url/g)];
      expect(allMentions).toHaveLength(1);
    });

    it('11. el Cloud Run Job efímero se elimina Y se re-verifica ausente EN AMBOS jobs de cleanup (Phase 7 remediación — antes nunca se eliminaba)', () => {
      expect(cleanupAfterApplySource).toMatch(/gcloud run jobs delete "\$EPHEMERAL_JOB"/);
      expect(cleanupAfterApplySource).toMatch(/gcloud run jobs describe "\$EPHEMERAL_JOB"/);
      expect(cleanupAfterApplySource).toMatch(/JOB_STILL_EXISTS/);
      expect(cleanupOnlySource).toMatch(/gcloud run jobs delete "\$EPHEMERAL_JOB"/);
      expect(cleanupOnlySource).toMatch(/gcloud run jobs describe "\$EPHEMERAL_JOB"/);
      expect(cleanupOnlySource).toMatch(/JOB_STILL_EXISTS/);
    });

    it('12. resolve-artifact y verify-prerequisites-instance ahora también corren para cleanup_only (necesario para poder ejecutar el Cloud Run Job de revoke)', () => {
      const resolveArtifactSource = jobSource('resolve-artifact');
      const verifyPrereqSource = jobSource('verify-prerequisites-instance');
      expect(resolveArtifactSource).toMatch(/cleanup_only/);
      expect(verifyPrereqSource).toMatch(/cleanup_only/);
      expect(jobNeeds('cleanup-only')).toEqual(
        expect.arrayContaining(['resolve-artifact', 'verify-prerequisites-instance']),
      );
    });

    it('13. la política de drift de SOURCE_SHA documentada coincide con la semántica real soportada por gh/GitHub Actions (--ref solo acepta branch/tag, nunca un SHA)', () => {
      // La frase `gh workflow run ... --ref <the exact source SHA>` SIGUE
      // apareciendo, pero únicamente citada como ejemplo de la instrucción
      // FALSA que este comentario corrige — nunca como una instrucción
      // accionable real. Se prueba explícitamente que está enmarcada como
      // falsa/no soportada, no que la frase esté ausente.
      expect(source).toMatch(/`--ref` as accepting only a "Branch or tag name," never a commit SHA/);
      expect(source).toMatch(/gh workflow run[^\n]*--ref[^\n]*<the exact source SHA>`\. That is FALSE and[\s\S]{0,40}UNSUPPORTED/);
      expect(source).toMatch(/HOLD_OPERATION_CONTEXT_DRIFT[\s\S]{0,400}NO existe forma soportada de re-dispatchear apply contra el SHA original/);
    });

    it('14. WIF readiness — el comentario de cabecera documenta explícitamente que este workflow NO está autorizado hoy por el WIF provider/binding de Producción, y nunca afirma falsamente lo contrario', () => {
      expect(source).toMatch(/WIF READINESS — NOT YET AUTHORIZED/);
      expect(source).toMatch(/\(THIS file\) is not present in either clause/);
      expect(source).not.toMatch(/WIF_INTEGRATION_READY\s*=\s*YES/);
    });

    it('15. el ADMIN OPTION se auto-otorga/revoca usando la credencial del propio admin efímero (EPHEMERAL_ADMIN_USERNAME=$EPHEMERAL_ADMIN), nunca la de "postgres"', () => {
      const usernameAssignments = [...source.matchAll(/EPHEMERAL_ADMIN_USERNAME=\$\{?([A-Za-z_]+)\}?/g)].map((m) => m[1]);
      expect(usernameAssignments.length).toBeGreaterThan(0);
      for (const value of usernameAssignments) expect(value).toBe('EPHEMERAL_ADMIN');
      expect(source).not.toMatch(/EPHEMERAL_ADMIN_USERNAME=postgres/);
    });
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

  it('cada Cloud Run Job SIEMPRE corre exactamente `node dist/ops/db-role-hardener.js` (preflight/apply/verify) o `node dist/ops/db-hardener-bootstrap.js` (grant/revoke ADMIN OPTION) — nunca un shell ni un comando arbitrario', () => {
    const commandMatches = [...source.matchAll(/--command=(\S+)/g)];
    const argsMatches = [...source.matchAll(/--args=(\S+)/g)];
    expect(commandMatches.length).toBeGreaterThan(0);
    for (const m of commandMatches) expect(m[1]).toBe('node');
    const ALLOWED_ARGS = new Set(['dist/ops/db-role-hardener.js', 'dist/ops/db-hardener-bootstrap.js']);
    expect(argsMatches.length).toBeGreaterThan(0);
    for (const m of argsMatches) expect(ALLOWED_ARGS.has(m[1]!)).toBe(true);
    // Ambos entrypoints deben aparecer — ninguno quedó sin usar.
    const usedArgs = new Set(argsMatches.map((m) => m[1]));
    expect(usedArgs.has('dist/ops/db-role-hardener.js')).toBe(true);
    expect(usedArgs.has('dist/ops/db-hardener-bootstrap.js')).toBe(true);
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
