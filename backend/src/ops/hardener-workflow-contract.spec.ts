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
  '../../../.github/workflows/production-db-role-hardening.yml',
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

describe('production-db-role-hardening.yml — contrato estructural', () => {
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

  it('Phase 8 (zero-standing-privilege remediation) — apply requiere verify-target-role-preconditions Y fresh-preflight como needs antes de mutar nada — nunca el antiguo verify-operation-context (que verificaba la identidad de Stage 1, ya eliminada para cuando apply corre)', () => {
    const applyBlock = jobSource('apply');
    expect(jobNeeds('apply')).toEqual(
      expect.arrayContaining(['verify-target-role-preconditions', 'bootstrap-apply-admin', 'fresh-preflight']),
    );
    expect(jobNeeds('apply')).not.toContain('verify-operation-context');
    expect(applyBlock).toMatch(/needs\.verify-target-role-preconditions\.outputs\.target_role_verified == 'YES'/);
    expect(applyBlock).toMatch(/needs\.fresh-preflight\.outputs\.fresh_preflight_result == 'PASS'/);
    expect(source).not.toMatch(/\n  verify-operation-context:\n/);
  });

  it('Phase 7 — bootstrap_and_preflight nunca tiene una arista needs hacia apply/remove-target-cloudsqlsuperuser', () => {
    for (const job of ['bootstrap-ephemeral-admin', 'preflight']) {
      const needs = jobNeeds(job);
      expect(needs).not.toContain('apply');
      expect(needs).not.toContain('remove-target-cloudsqlsuperuser');
    }
  });

  it('Phase 7 — stage1-summary nunca ejecuta el Job de apply ni limpia recursos (solo lee outputs, no gcloud sql/secrets mutation)', () => {
    const stage1Source = jobSource('stage1-summary');
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

  it('Phase 12/6 remediation — cleanup_only nunca puede crear/elevar una identidad PostgreSQL, un secret, ni un privilegio IAM (puede SOLO redesplegar el Cloud Run Job efímero exacto de la operación, cuando es necesario para revocar)', () => {
    const cleanupOnlySource = source.split('cleanup-only:')[1]!;
    expect(cleanupOnlySource).not.toMatch(/gcloud sql users create/);
    expect(cleanupOnlySource).not.toMatch(/gcloud secrets create/);
    expect(cleanupOnlySource).not.toMatch(/gcloud secrets add-iam-policy-binding/);
    expect(cleanupOnlySource).not.toMatch(/WITH ADMIN OPTION/);
    expect(cleanupOnlySource).not.toMatch(/cloudsqlsuperuser/);
    // La única excepción explícita y probada: redesplegar (nunca crear un
    // recurso nuevo/distinto) el Cloud Run Job efímero exacto de esta
    // operación, solo para poder ejecutar revoke-admin-option.
    expect(cleanupOnlySource).toMatch(/gcloud run jobs deploy "\$EPHEMERAL_JOB"/);
    expect(cleanupOnlySource).toMatch(/BOOTSTRAP_MODE=revoke-admin-option/);
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
      expect(bootstrapSource).toMatch(/--set-secrets="MIGRATION_DATABASE_URL=\$\{EPHEMERAL_DSN_SECRET\}:1"/);
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

    it('14. WIF readiness (Option W1) — el comentario de cabecera documenta que este workflow vive en el filename ya autorizado por WIF (consolidación, no una segunda arista de política), y nunca reintroduce un filename efímero separado', () => {
      expect(source).toMatch(/WHY WIF OPTION W1/);
      expect(source).toMatch(/this exact filename/);
      expect(source).not.toMatch(/WIF READINESS — NOT YET AUTHORIZED/);
      // El filename efímero de desarrollo se menciona una única vez, en
      // prosa histórica, explicando por qué fue eliminado — nunca como un
      // segundo workflow real presente en el árbol.
      const ephemeralFilenameMentions = [...source.matchAll(/production-db-role-hardener-ephemeral\.yml/g)];
      expect(ephemeralFilenameMentions.length).toBeLessThanOrEqual(1);
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
      'cleanup-after-preflight',
      'verify-target-role-preconditions',
      'bootstrap-apply-admin',
      'fresh-preflight',
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

  // ===========================================================================
  // TF12-POINT8C-PR115-SEMANTIC-FAIL-CLOSED-FINAL-REMEDIATION — P1-1..P1-7
  // y P2. La arquitectura ephemeral-admin en sí NO se rediseña; estos tests
  // prueban que la orquestación de seguridad (verify estricto, cleanup
  // automático, precondiciones exactas, versión de secret fijada, cleanup
  // no bloqueado por artefacto, postura de red exacta) está realmente
  // presente en el YAML real, nunca solo documentada en prosa.
  // ===========================================================================
  describe('P1-1..P1-7 / P2 — remediación semántica fail-closed final', () => {
    it('P1-1: el job verify depende del gate estricto machine-enforced — verify_disposition_ok=YES solo si el proceso Node salió 0 (nunca CHECK_CLOUD_LOGGING)', () => {
      const verifySource = jobSource('verify');
      expect(verifySource).not.toMatch(/CHECK_CLOUD_LOGGING/);
      expect(verifySource).toMatch(/verify_disposition_ok=YES/);
      expect(verifySource).toMatch(/EXECUTE_EXIT.*-eq 0.*fail/s);
    });

    it('P1-2 (zero-standing-privilege remediation): existe cleanup-after-preflight, corre SIEMPRE (incondicionalmente — ni éxito ni falla de preflight lo condicionan) para todo dispatch bootstrap_and_preflight, y elimina admin/secret/Job con verificación independiente', () => {
      const stage1CleanupSource = jobSource('cleanup-after-preflight');
      expect(stage1CleanupSource).toMatch(/if: \|\s*\n\s*always\(\) &&\s*\n\s*needs\.guard\.outputs\.guard_pass == 'YES' &&\s*\n\s*needs\.guard\.outputs\.mode == 'bootstrap_and_preflight'/);
      // Ya NO existe ninguna condición que dependa de preflight.result o
      // bootstrap-ephemeral-admin.result — el cleanup no es condicional al
      // éxito/falla, es incondicional dado el modo.
      expect(stage1CleanupSource).not.toMatch(/needs\.preflight\.result/);
      expect(stage1CleanupSource).not.toMatch(/needs\.bootstrap-ephemeral-admin\.result/);
      expect(stage1CleanupSource).toMatch(/gcloud sql users delete "\$EPHEMERAL_ADMIN"/);
      expect(stage1CleanupSource).toMatch(/gcloud secrets delete "\$EPHEMERAL_DSN_SECRET"/);
      expect(stage1CleanupSource).toMatch(/gcloud run jobs delete "\$EPHEMERAL_JOB"/);
      expect(stage1CleanupSource).toMatch(/ADMIN_STILL_EXISTS/);
      expect(jobNeeds('cleanup-after-preflight')).toEqual(
        expect.arrayContaining(['bootstrap-ephemeral-admin', 'preflight', 'stage1-summary']),
      );
      // No queda ningún job con el nombre antiguo (condicional a la falla).
      expect(source).not.toMatch(/\n  cleanup-after-stage1-failure:\n/);
    });

    it('P1-3 (SUPERSEDED por la remediación zero-standing-privilege — ver el describe block dedicado más abajo): el lease reactivo cross-dispatch fue ELIMINADO, no acortado — no queda ninguna referencia operativa a EPHEMERAL_ADMIN_MAX_LIFETIME_SECONDS/HOLD_OPERATION_LEASE_EXPIRED/createTime como mecanismo de expiración', () => {
      expect(source).not.toMatch(/EPHEMERAL_ADMIN_MAX_LIFETIME_SECONDS:\s*"?\d+"?/);
      expect(source).not.toMatch(/HOLD_OPERATION_LEASE_EXPIRED/);
      expect(source).not.toMatch(/LEASE_CHECK/);
      // Ningún trigger schedule: existe ni existió — el fix nunca introduce
      // un cron para compensar la eliminación del lease reactivo.
      const onBlock = /\non:\n([\s\S]*?)\npermissions:/.exec(source)?.[1] ?? '';
      expect(onBlock).not.toMatch(/^\s*schedule:/m);
    });

    it('P1-4a: guard expone sha_drift_detected (escrito ANTES del exit del chequeo de drift) y deriva mode/operation_id antes de ese chequeo, para que el cleanup automático pueda derivar nombres de recurso', () => {
      const guardSource = jobSource('guard');
      expect(guardSource).toMatch(/sha_drift_detected: \$\{\{ steps\.checks\.outputs\.sha_drift_detected \}\}/);
      const echoModeIdx = guardSource.indexOf('echo "mode=$MODE" >> "$GITHUB_OUTPUT"');
      const driftCheckIdx = guardSource.indexOf('sha_drift_detected=YES');
      expect(echoModeIdx).toBeGreaterThan(-1);
      expect(driftCheckIdx).toBeGreaterThan(-1);
      expect(echoModeIdx).toBeLessThan(driftCheckIdx);
    });

    it('P1-4b: cleanup-after-apply corre para CUALQUIER dispatch mode=apply con guard_pass=YES — no exige que verify-target-role-preconditions/bootstrap-apply-admin/fresh-preflight/apply/remove/verify hayan tenido éxito', () => {
      const cleanupAfterApplySource = jobSource('cleanup-after-apply');
      expect(cleanupAfterApplySource).not.toMatch(/needs\.verify-operation-context/);
      expect(cleanupAfterApplySource).not.toMatch(/needs\.verify-target-role-preconditions\.result == 'success'/);
      expect(cleanupAfterApplySource).not.toMatch(/needs\.fresh-preflight\.result == 'success'/);
      expect(cleanupAfterApplySource).not.toMatch(/needs\.bootstrap-apply-admin\.result == 'success'/);
      expect(cleanupAfterApplySource).toMatch(/always\(\) && needs\.guard\.outputs\.guard_pass == 'YES' && needs\.guard\.outputs\.mode == 'apply'/);
      expect(jobNeeds('cleanup-after-apply')).toEqual(
        expect.arrayContaining(['verify-target-role-preconditions', 'bootstrap-apply-admin', 'fresh-preflight', 'apply', 'remove-target-cloudsqlsuperuser', 'verify']),
      );
    });

    it('P1-4a/P1-4b: cleanup-only también se dispara automáticamente cuando guard rechazó apply por drift de SHA (sha_drift_detected==YES), no solo por dispatch manual mode=cleanup_only', () => {
      const cleanupOnlySource = jobSource('cleanup-only');
      expect(cleanupOnlySource).toMatch(/needs\.guard\.outputs\.sha_drift_detected == 'YES'/);
    });

    it('P1-5 (preservado — reubicado en verify-target-role-preconditions): databaseRoles de korixa_app se prueba EXACTO vía JSON estructurado (nunca grep/substring), con HOLD_TARGET_DATABASE_ROLES_DRIFT si difiere. El admin efímero de Stage 2 nunca necesita este chequeo de drift porque se crea recién, en este mismo dispatch, con --database-roles=cloudsqlsuperuser explícito — no existe ventana temporal en la que su rol pueda haber cambiado.', () => {
      const targetRolePreconditionsSource = jobSource('verify-target-role-preconditions');
      expect(targetRolePreconditionsSource).not.toMatch(/grep -qi cloudsqlsuperuser/);
      expect(targetRolePreconditionsSource).toMatch(/HOLD_TARGET_DATABASE_ROLES_DRIFT/);
      const exactChecks = [...targetRolePreconditionsSource.matchAll(/roles == \['cloudsqlsuperuser'\]/g)];
      expect(exactChecks.length).toBe(1); // solo korixa_app — el admin efímero se crea fresco, sin ventana de drift
      expect(source).not.toMatch(/\n  verify-operation-context:\n/);
      // Ambos jobs de bootstrap crean el admin con el rol exacto explícito.
      for (const jobName of ['bootstrap-ephemeral-admin', 'bootstrap-apply-admin']) {
        expect(jobSource(jobName)).toMatch(/--database-roles=cloudsqlsuperuser/);
      }
    });

    it('P1-6: SECRET_LATEST_REFERENCES = 0 — el DSN secret siempre se referencia con versión fijada ":1", nunca ":latest"; ahora en NUEVE sitios (dos bootstraps, dos preflights, apply, verify, y tres revokes)', () => {
      const latestReferences = [...source.matchAll(/EPHEMERAL_DSN_SECRET\}?:latest/g)];
      expect(latestReferences).toHaveLength(0);
      const pinnedReferences = [...source.matchAll(/EPHEMERAL_DSN_SECRET\}:1"/g)];
      expect(pinnedReferences.length).toBeGreaterThanOrEqual(9);
    });

    it('P1-7: ni cleanup-only ni cleanup-after-apply ni cleanup-after-preflight exigen needs.resolve-artifact.result == "success" — la eliminación de admin/secret/Job nunca se bloquea por artefacto', () => {
      for (const jobName of ['cleanup-only', 'cleanup-after-apply', 'cleanup-after-preflight']) {
        expect(jobSource(jobName)).not.toMatch(/needs\.resolve-artifact\.result == 'success'/);
      }
      expect(source).not.toMatch(/\n  cleanup-after-stage1-failure:\n/);
      // Cada revoke best-effort chequea IMMUTABLE_REF antes de intentar el
      // deploy — nunca asume que la resolución de artefacto tuvo éxito.
      const immutableRefGuards = [...source.matchAll(/-n "\$IMMUTABLE_REF"|-z "\$IMMUTABLE_REF"/g)];
      expect(immutableRefGuards.length).toBeGreaterThanOrEqual(3); // cleanup-after-apply, cleanup-only, cleanup-after-preflight
    });

    it('P2: verify-prerequisites-instance prueba la postura de red EXACTA estructuradamente (JSON) — nunca ipAddresses[0] por índice — con HOLD_PRODUCTION_DB_NETWORK_POSTURE_DRIFT si algo no coincide', () => {
      const prereqSource = jobSource('verify-prerequisites-instance');
      // Solo prosa (comentarios) puede mencionar el patrón viejo, explicando
      // por qué se corrigió — ninguna línea OPERATIVA (gcloud/--format) lo
      // usa como argumento real.
      const operationalPrereqLines = prereqSource
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
      expect(operationalPrereqLines).not.toMatch(/ipAddresses\[0\]/);
      expect(prereqSource).toMatch(/HOLD_PRODUCTION_DB_NETWORK_POSTURE_DRIFT/);
      expect(prereqSource).toMatch(/ipv4Enabled/);
      expect(prereqSource).toMatch(/type'\) == 'PRIMARY'/);
      expect(prereqSource).toMatch(/databaseVersion/);
      expect(prereqSource).toMatch(/privateNetwork/);
      expect(prereqSource).toMatch(/len\(private_ips\) != 1/);
    });
  });

  // ===========================================================================
  // TF12-POINT8C-PR115-ZERO-STANDING-PRIVILEGE-FINAL-REMEDIATION — el único
  // P1 restante: bajo el diseño anterior, un preflight EXITOSO dejaba el
  // admin/secret/Job efímeros vivos INDEFINIDAMENTE en espera de que un
  // humano dispatcheara apply, protegidos solo por un timer reactivo que
  // nunca corría si apply jamás se dispatcheaba. Esta remediación NO
  // rediseña la arquitectura ephemeral-admin en sí (sigue habiendo un admin
  // cloudsqlsuperuser intencional, un secret DSN, un Cloud Run Job) — cambia
  // su CICLO DE VIDA: Stage 1 se auto-limpia siempre, y Stage 2 bootstrapea
  // una identidad completamente nueva y vuelve a preflightear antes de
  // aplicar. Los 15 tests de esta sección prueban, uno por uno, contra el
  // YAML real, cada propiedad exigida por la Phase 9 de la misión.
  // ===========================================================================
  describe('PR #115 zero-standing-privilege final remediation — Stage 1 siempre limpia, Stage 2 mintea una identidad fresca, fresh preflight obligatorio', () => {
    it('1/2. un preflight de Stage 1 EXITOSO y uno FALLIDO ambos disparan cleanup-after-preflight — su condición no distingue el resultado de preflight/bootstrap en absoluto (unconditional dado el modo)', () => {
      const cleanupSource = jobSource('cleanup-after-preflight');
      expect(cleanupSource).toMatch(/always\(\)/);
      expect(cleanupSource).not.toMatch(/preflight\.result == 'success'/);
      expect(cleanupSource).not.toMatch(/bootstrap-ephemeral-admin\.result == 'success'/);
      // Ambas ramas (admin+secret idempotentemente ausentes o presentes) se
      // manejan con el mismo código describe-antes-de-borrar — no hay una
      // rama de código separada para "preflight falló" vs "preflight pasó".
      expect(cleanupSource).toMatch(/ADMIN_ALREADY_ABSENT|STAGE1_CLEANUP_B_SKIPPED=ADMIN_ALREADY_ABSENT/);
    });

    it('3. READY_FOR_APPLY_HUMAN_GATE_WITH_ZERO_PRIVILEGED_RESOURCES_REMAINING solo se emite en stage1-summary, y cleanup-after-preflight declara needs: stage1-summary — la evidencia se publica ANTES de que el job de cleanup pueda empezar (orden explícito por needs, no solo casual)', () => {
      const summarySource = jobSource('stage1-summary');
      expect(summarySource).toMatch(/READY_FOR_APPLY_HUMAN_GATE_WITH_ZERO_PRIVILEGED_RESOURCES_REMAINING/);
      expect(jobNeeds('cleanup-after-preflight')).toContain('stage1-summary');
      // stage1-summary en sí no hace ninguna mutación — solo lee outputs ya
      // fijados y escribe al step summary.
      expect(summarySource).not.toMatch(/gcloud sql users (create|delete)/);
      expect(summarySource).not.toMatch(/gcloud secrets (create|delete)/);
    });

    it('4/5. Stage 2 (bootstrap-apply-admin) no depende en absoluto de que el admin o el secret de Stage 1 existan — crea un usuario y un secret NUEVOS incondicionalmente, nunca los "reutiliza"', () => {
      const bootstrapApplySource = jobSource('bootstrap-apply-admin');
      expect(bootstrapApplySource).toMatch(/gcloud sql users create "\$EPHEMERAL_ADMIN"/);
      expect(bootstrapApplySource).toMatch(/gcloud secrets create "\$EPHEMERAL_DSN_SECRET"/);
      // Nunca condicionado a un describe/lookup previo de un recurso
      // "existente" de stage 1 — a diferencia de los jobs de cleanup, que sí
      // hacen describe-antes-de-actuar, bootstrap-apply-admin siempre crea.
      expect(bootstrapApplySource).not.toMatch(/gcloud sql users describe "\$EPHEMERAL_ADMIN"/);
      // No depende de bootstrap-ephemeral-admin/preflight/cleanup-after-preflight de Stage 1.
      const needs = jobNeeds('bootstrap-apply-admin');
      for (const stage1Job of ['bootstrap-ephemeral-admin', 'preflight', 'cleanup-after-preflight', 'stage1-summary']) {
        expect(needs).not.toContain(stage1Job);
      }
    });

    it('6. derive-operation-names mintea un apply_execution_id FRESCO e independiente para mode=apply — nunca deriva los nombres de recurso de Stage 2 del preflight_operation_id de entrada', () => {
      const deriveSource = jobSource('derive-operation-names');
      expect(deriveSource).toMatch(/APPLY_EXECUTION_ID="\$\(openssl rand -hex 6\)"/);
      expect(deriveSource).toMatch(/apply_execution_id=\$APPLY_EXECUTION_ID/);
      // La colisión accidental (mismo valor que el preflight_operation_id de
      // entrada) se rechaza explícitamente, nunca se ignora en silencio.
      expect(deriveSource).toMatch(/APPLY_EXECUTION_ID.*!=.*OPERATION_ID.*INVARIANT_VIOLATION/s);
      // Para mode=apply, RESOURCE_ID (lo que realmente nombra los recursos)
      // se deriva de APPLY_EXECUTION_ID, no de OPERATION_ID.
      expect(deriveSource).toMatch(/elif \[ "\$MODE" = "apply" \][\s\S]*?RESOURCE_ID="\$APPLY_EXECUTION_ID"/);
    });

    it('7/8. fresh-preflight es OBLIGATORIO antes de apply — su ausencia/falla implica APPLY_EXECUTED=NO, y cleanup-after-apply corre de todos modos', () => {
      expect(jobNeeds('apply')).toContain('fresh-preflight');
      const applySource = jobSource('apply');
      expect(applySource).toMatch(/needs\.fresh-preflight\.outputs\.fresh_preflight_result == 'PASS'/);
      const freshPreflightSource = jobSource('fresh-preflight');
      expect(freshPreflightSource).toMatch(/HOLD_FRESH_PREFLIGHT_FAILED/);
      expect(freshPreflightSource).toMatch(/dist\/ops\/db-role-hardener\.js/);
      expect(freshPreflightSource).toMatch(/HARDENER_MODE=preflight/);
      // cleanup-after-apply corre para CUALQUIER dispatch mode=apply,
      // incluyendo cuando fresh-preflight falló (ya probado en P1-4b, pero
      // se re-afirma acá con el nombre explícito del job nuevo).
      expect(jobNeeds('cleanup-after-apply')).toContain('fresh-preflight');
      expect(jobSource('cleanup-after-apply')).not.toMatch(/needs\.fresh-preflight\.result == 'success'/);
    });

    it('9. ningún recurso privilegiado existe mientras se espera el Human Gate de apply — PRIVILEGED_RESOURCES_WHILE_WAITING_HUMAN_GATE = 0 se emite solo tras confirmar los tres recursos ausentes', () => {
      const cleanupSource = jobSource('cleanup-after-preflight');
      const idx = cleanupSource.indexOf('PRIVILEGED_RESOURCES_WHILE_WAITING_HUMAN_GATE = 0');
      expect(idx).toBeGreaterThan(-1);
      const precedingText = cleanupSource.slice(0, idx);
      // Solo se llega a esa línea dentro de la rama que confirmó las tres
      // ausencias (ADMIN/DSN/JOB) — nunca incondicionalmente.
      expect(precedingText).toMatch(/ADMIN_STILL_EXISTS" -ne 0 \] && \[ "\$DSN_SECRET_STILL_EXISTS" -ne 0 \] && \[ "\$JOB_STILL_EXISTS" -ne 0 \]/);
    });

    it('10. ningún comentario/texto afirma que un timer/lease reactivo elimina recursos por sí solo — el único concepto de tiempo restante es timeout-minutes (MAX_EXECUTION_WINDOW real, de plataforma, nunca un mecanismo de borrado)', () => {
      expect(source).not.toMatch(/expira.*\d+s.*después de este bootstrap/);
      expect(source).not.toMatch(/quedan activos indefinidamente/);
      expect(source).toMatch(/NO REACTIVE LEASE/);
      expect(source).toMatch(/MAX_EXECUTION_WINDOW/);
      expect(source).toMatch(/never described as something that deletes a resource on\s+#? ?its own/);
      // timeout-minutes: sigue presente en todo job que corre gcloud contra
      // Production — eso es lo real que acota la ventana de ejecución.
      const timeoutCount = [...source.matchAll(/timeout-minutes:\s*\d+/g)].length;
      expect(timeoutCount).toBeGreaterThanOrEqual(10);
    });

    it('11. el strict verify gate (P1-1) sigue enforced tras esta remediación — verify_disposition_ok=YES solo si el proceso Node salió 0', () => {
      const verifySource = jobSource('verify');
      expect(verifySource).toMatch(/verify_disposition_ok=YES/);
      expect(verifySource).toMatch(/HOLD_VERIFY_NOT_FULLY_HARDENED/);
      expect(jobNeeds('verify')).toContain('remove-target-cloudsqlsuperuser');
    });

    it('12. el pin de versión de secret ":1" sigue enforced tras esta remediación (ver también el test P1-6 dedicado)', () => {
      expect(source).not.toMatch(/EPHEMERAL_DSN_SECRET\}?:latest/);
      expect([...source.matchAll(/EPHEMERAL_DSN_SECRET\}:1"/g)].length).toBeGreaterThanOrEqual(9);
    });

    it('13. las precondiciones exactas de databaseRoles siguen enforced tras esta remediación (ver también el test P1-5 dedicado)', () => {
      expect(jobSource('verify-target-role-preconditions')).toMatch(/HOLD_TARGET_DATABASE_ROLES_DRIFT/);
      expect(jobNeeds('apply')).toContain('verify-target-role-preconditions');
    });

    it('14. private-VPC-only sigue enforced tras esta remediación — ambos bootstraps y ambos preflights (stage 1 y stage 2) usan la misma red/subnet/vpc-egress privados, cero ExecuteSql/dataApiAccess', () => {
      for (const jobName of ['bootstrap-ephemeral-admin', 'bootstrap-apply-admin', 'preflight', 'fresh-preflight', 'apply', 'verify']) {
        const jobText = jobSource(jobName);
        expect(jobText).toMatch(/--network=korixa-production-vpc/);
        expect(jobText).toMatch(/--subnet=korixa-production-sa-east1/);
        expect(jobText).toMatch(/--vpc-egress=private-ranges-only/);
      }
      const operationalLinesAllJobs = source.split('\n').filter((line) => !line.trim().startsWith('#'));
      expect(operationalLinesAllJobs.some((line) => /dataApiAccess|ALLOW_DATA_API|execute-sql/.test(line))).toBe(false);
    });

    it('15. no existe ninguna arista automática Stage1 -> apply — bootstrap-apply-admin y fresh-preflight se gatean SOLO por mode==apply (nunca por el resultado de preflight/bootstrap-ephemeral-admin/cleanup-after-preflight de Stage 1)', () => {
      const bootstrapApplyIf = jobSource('bootstrap-apply-admin').match(/if: \|[\s\S]*?\n\n/)?.[0] ?? jobSource('bootstrap-apply-admin');
      expect(bootstrapApplyIf).toMatch(/mode == 'apply'/);
      expect(bootstrapApplyIf).not.toMatch(/preflight\.result/);
      expect(bootstrapApplyIf).not.toMatch(/bootstrap-ephemeral-admin\.result/);
      const freshPreflightIf = jobSource('fresh-preflight');
      expect(freshPreflightIf).not.toMatch(/needs\.preflight\.result/);
      expect(freshPreflightIf).not.toMatch(/needs\.stage1-summary/);
      // El único puente entre Stage 1 y Stage 2 es un dispatch manual
      // separado (operation_id + operation_source_sha copiados a mano) —
      // nunca un job del mismo run que encadene automáticamente.
      expect(jobNeeds('bootstrap-apply-admin')).not.toContain('preflight');
    });
  });
});
