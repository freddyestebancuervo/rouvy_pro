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

  it('Phase 15 — el job de bootstrap otorga IAM a nivel de secreto (setIamPolicy REST sobre el PASSWORD SECRET, add-iam-policy-binding sobre el DSN SECRET), nunca a nivel de proyecto', () => {
    // PASSWORD SECRET: gcloud secrets add-iam-policy-binding --location= está
    // roto (ver comentario de cabecera) — el binding se otorga vía REST
    // directo (:setIamPolicy) sobre el mismo recurso regional específico.
    expect(source).toMatch(/\$\{REGIONAL_SM_BASE\}\/\$\{EPHEMERAL_PASSWORD_SECRET\}:setIamPolicy/);
    // DSN SECRET: el flag global funciona normalmente, sin necesidad de REST.
    expect(source).toMatch(/gcloud secrets add-iam-policy-binding "\$EPHEMERAL_DSN_SECRET"/);
    expect(source).not.toMatch(/gcloud projects add-iam-policy-binding/);
  });

  // ===========================================================================
  // PR #115 P1 remediation — contrato de DOS secrets independientes
  // (password-only REGIONAL vs. DSN-completo GLOBAL). Los 16 tests de la
  // Phase 10 de la misión de remediación viven en este bloque.
  // ===========================================================================
  describe('PR #115 P1 remediation — contrato de dos secrets independientes', () => {
    const bootstrapSource = source.split('bootstrap-ephemeral-admin:')[1]!.split('# ===')[0]!;

    it('1. los dos secrets tienen prefijos/nombres de recurso completamente distintos entre sí', () => {
      const passwordPrefixMatch = /EPHEMERAL_PASSWORD_SECRET_PREFIX:\s*(\S+)/.exec(source);
      const dsnPrefixMatch = /EPHEMERAL_DSN_SECRET_PREFIX:\s*(\S+)/.exec(source);
      expect(passwordPrefixMatch?.[1]).toBeDefined();
      expect(dsnPrefixMatch?.[1]).toBeDefined();
      expect(passwordPrefixMatch![1]).not.toBe(dsnPrefixMatch![1]);
      expect(source).toMatch(/ephemeral_password_secret_name=\$\{\{ env\.EPHEMERAL_PASSWORD_SECRET_PREFIX \}\}/);
      expect(source).toMatch(/ephemeral_dsn_secret_name=\$\{\{ env\.EPHEMERAL_DSN_SECRET_PREFIX \}\}/);
    });

    it('2. el PASSWORD SECRET recibe EXCLUSIVAMENTE el password como payload — nunca el DSN completo (vía REST :addVersion, ya que gcloud secrets versions add --location= está roto)', () => {
      expect(bootstrapSource).toMatch(/PASSWORD_B64="\$\(printf '%s' "\$EPHEMERAL_PASSWORD" \| base64 -w0\)"/);
      expect(bootstrapSource).toMatch(/\$\{REGIONAL_SM_BASE\}\/\$\{EPHEMERAL_PASSWORD_SECRET\}:addVersion/);
      expect(bootstrapSource).toMatch(/\\"payload\\":\{\\"data\\":\\"\$\{PASSWORD_B64\}\\"\}/);
      expect(bootstrapSource).not.toMatch(/printf '%s' "\$DSN" \| gcloud secrets versions add "\$EPHEMERAL_PASSWORD_SECRET"/);
      expect(bootstrapSource).not.toMatch(/EPHEMERAL_PASSWORD_SECRET:addVersion[\s\S]{0,120}DSN/);
    });

    it('3. el DSN SECRET recibe EXCLUSIVAMENTE el DSN completo como payload — nunca el password solo', () => {
      expect(bootstrapSource).toMatch(/printf '%s' "\$DSN" \| gcloud secrets versions add "\$EPHEMERAL_DSN_SECRET"/);
      expect(bootstrapSource).not.toMatch(/printf '%s' "\$EPHEMERAL_PASSWORD" \| gcloud secrets versions add "\$EPHEMERAL_DSN_SECRET"/);
    });

    it('4. el PASSWORD SECRET se crea como REGIONAL verdadero, vía REST directo a la API regional de Secret Manager (gcloud secrets create --location= está confirmado roto en el SDK instalado — nunca vía --replication-policy=user-managed --locations=)', () => {
      expect(bootstrapSource).toMatch(/REGIONAL_SM_BASE="https:\/\/secretmanager\.\$\{\{ env\.PRODUCTION_REGION \}\}\.rep\.googleapis\.com\/v1\/projects\/\$\{\{ env\.PRODUCTION_PROJECT \}\}\/locations\/\$\{\{ env\.PRODUCTION_REGION \}\}\/secrets"/);
      expect(bootstrapSource).toMatch(/\$\{REGIONAL_SM_BASE\}\?secretId=\$\{EPHEMERAL_PASSWORD_SECRET\}/);
      expect(bootstrapSource).not.toMatch(/gcloud secrets create "\$EPHEMERAL_PASSWORD_SECRET"/);
      expect(bootstrapSource).not.toMatch(/--replication-policy=user-managed/);
      expect(bootstrapSource).not.toMatch(/EPHEMERAL_PASSWORD_SECRET"[\s\S]{0,80}--locations=/);
    });

    it('5. el DSN SECRET se crea GLOBAL (compatible con Cloud Run) — sin --location ni --locations', () => {
      const dsnCreateBlock = /gcloud secrets create "\$EPHEMERAL_DSN_SECRET"[\s\S]*?--quiet/.exec(bootstrapSource)?.[0] ?? '';
      expect(dsnCreateBlock.length).toBeGreaterThan(0);
      expect(dsnCreateBlock).not.toMatch(/--location=/);
      expect(dsnCreateBlock).not.toMatch(/--locations=/);
    });

    it('6. execute-sql (--password-secret-version) referencia EXCLUSIVAMENTE el PASSWORD SECRET, en cada uso, en todo el workflow', () => {
      // --password-secret-version siempre recibe la variable ya resuelta
      // $SECRET_RESOURCE (nunca el nombre del secret inline) — se prueba en
      // su lugar que cada construcción de SECRET_RESOURCE que precede a un
      // uso de execute-sql interpola EXCLUSIVAMENTE EPHEMERAL_PASSWORD_SECRET.
      expect(source).toMatch(/--password-secret-version="\$SECRET_RESOURCE"/);
      const secretResourceAssignments = [
        ...source.matchAll(/SECRET_RESOURCE="projects\/[^"]*\/secrets\/\$\{([A-Z_]+)\}\/versions\/[^"]*"/g),
      ].map((m) => m[1]);
      expect(secretResourceAssignments.length).toBeGreaterThan(0);
      for (const varName of secretResourceAssignments) {
        expect(varName).toBe('EPHEMERAL_PASSWORD_SECRET');
      }
    });

    it('7. Cloud Run (--set-secrets) monta EXCLUSIVAMENTE el DSN SECRET, en cada uso, en todo el workflow', () => {
      const setSecretsCalls = [...source.matchAll(/--set-secrets="MIGRATION_DATABASE_URL=\$\{([A-Z_]+)\}:latest"/g)].map((m) => m[1]);
      expect(setSecretsCalls.length).toBeGreaterThan(0);
      for (const varName of setSecretsCalls) {
        expect(varName).toBe('EPHEMERAL_DSN_SECRET');
      }
    });

    it('8. el secret legado korixa-production-migration-database-url (identidad de korixa_app) nunca se referencia operacionalmente (solo se lo menciona en prosa, en el comentario de cabecera, para explicar por qué este archivo es separado)', () => {
      const operationalLines = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
      expect(operationalLines).not.toMatch(/korixa-production-migration-database-url/);
      // Confirma que la única mención real está en el comentario de cabecera
      // esperado — si aparece en más de un lugar, algo cambió y este test
      // debe fallar en vez de quedar obsoleto en silencio.
      const allMentions = [...source.matchAll(/korixa-production-migration-database-url/g)];
      expect(allMentions).toHaveLength(1);
    });

    it('9. el PASSWORD SECRET nunca se monta en Cloud Run vía --set-secrets', () => {
      expect(source).not.toMatch(/--set-secrets="[^"]*EPHEMERAL_PASSWORD_SECRET/);
    });

    it('10. el DSN SECRET nunca se pasa a --password-secret-version', () => {
      expect(source).not.toMatch(/--password-secret-version="[^"]*DSN_SECRET/);
    });

    it('11. cleanup-after-apply elimina Y verifica AMBOS secrets de forma independiente (DSN vía gcloud CLI, PASSWORD vía REST — describe/delete --location= está roto)', () => {
      const cleanupSource = source.split('cleanup-after-apply:')[1]!.split('cleanup-only:')[0]!;
      expect(cleanupSource).toMatch(/gcloud secrets delete "\$EPHEMERAL_DSN_SECRET"/);
      expect(cleanupSource).toMatch(/gcloud secrets describe "\$EPHEMERAL_DSN_SECRET"/);
      expect(cleanupSource).toMatch(/curl -sf -X DELETE "\$\{REGIONAL_SM_BASE\}\/\$\{EPHEMERAL_PASSWORD_SECRET\}"/);
      expect(cleanupSource).toMatch(/curl -sf -o \/dev\/null "\$\{REGIONAL_SM_BASE\}\/\$\{EPHEMERAL_PASSWORD_SECRET\}"/);
      expect(cleanupSource).not.toMatch(/gcloud secrets (describe|delete) "\$EPHEMERAL_PASSWORD_SECRET"/);
      expect(cleanupSource).toMatch(/DSN_SECRET_STILL_EXISTS/);
      expect(cleanupSource).toMatch(/PASSWORD_SECRET_STILL_EXISTS/);
    });

    it('12. cleanup_only descubre, elimina y verifica AMBOS secrets de forma independiente e idempotente (DSN vía gcloud CLI, PASSWORD vía REST)', () => {
      const cleanupOnlySource = jobSource('cleanup-only');
      expect(cleanupOnlySource).toMatch(/gcloud secrets describe "\$EPHEMERAL_DSN_SECRET"/);
      expect(cleanupOnlySource).toMatch(/gcloud secrets delete "\$EPHEMERAL_DSN_SECRET"/);
      expect(cleanupOnlySource).toMatch(/curl -sf -o \/dev\/null "\$\{REGIONAL_SM_BASE\}\/\$\{EPHEMERAL_PASSWORD_SECRET\}"/);
      expect(cleanupOnlySource).toMatch(/curl -sf -X DELETE "\$\{REGIONAL_SM_BASE\}\/\$\{EPHEMERAL_PASSWORD_SECRET\}"/);
      expect(cleanupOnlySource).not.toMatch(/gcloud secrets (describe|delete) "\$EPHEMERAL_PASSWORD_SECRET"/);
      expect(cleanupOnlySource).toMatch(/DSN_SECRET_ALREADY_ABSENT/);
      expect(cleanupOnlySource).toMatch(/PASSWORD_SECRET_ALREADY_ABSENT/);
    });

    it('13a. el PASSWORD SECRET otorga acceso EXCLUSIVAMENTE a DEPLOYER_SA (la identidad que invoca execute-sql), nunca a MIGRATION_EXECUTOR_SA — vía REST :setIamPolicy (add-iam-policy-binding --location= está roto)', () => {
      const passwordIamBlock = /\$\{REGIONAL_SM_BASE\}\/\$\{EPHEMERAL_PASSWORD_SECRET\}:setIamPolicy[\s\S]*?\|\| fail/.exec(bootstrapSource)?.[0] ?? '';
      expect(passwordIamBlock.length).toBeGreaterThan(0);
      expect(passwordIamBlock).toMatch(/serviceAccount:\$\{\{ env\.DEPLOYER_SA \}\}/);
      expect(passwordIamBlock).not.toMatch(/MIGRATION_EXECUTOR_SA/);
    });

    it('13b. el DSN SECRET otorga acceso EXCLUSIVAMENTE a MIGRATION_EXECUTOR_SA (la identidad que corre los Jobs de Cloud Run), nunca a DEPLOYER_SA', () => {
      const dsnIamBlock = /gcloud secrets add-iam-policy-binding "\$EPHEMERAL_DSN_SECRET"[\s\S]*?--quiet/.exec(bootstrapSource)?.[0] ?? '';
      expect(dsnIamBlock).toMatch(/--member="serviceAccount:\$\{\{ env\.MIGRATION_EXECUTOR_SA \}\}"/);
      expect(dsnIamBlock).not.toMatch(/DEPLOYER_SA/);
    });

    it('14. verify-operation-context re-verifica AMBOS secrets (ENABLED + accesor IAM exacto) antes de cualquier mutación de apply', () => {
      const verifyContextSource = jobSource('verify-operation-context');
      expect(verifyContextSource).toMatch(/EPHEMERAL_PASSWORD_SECRET/);
      expect(verifyContextSource).toMatch(/EPHEMERAL_DSN_SECRET/);
      expect(verifyContextSource).toMatch(/PASSWORD_ACCESSOR/);
      expect(verifyContextSource).toMatch(/DSN_ACCESSOR/);
      expect(verifyContextSource).toMatch(/serviceAccount:\$\{\{ env\.DEPLOYER_SA \}\}/);
      expect(verifyContextSource).toMatch(/serviceAccount:\$\{\{ env\.MIGRATION_EXECUTOR_SA \}\}/);
    });

    it('15. ningún --set-env-vars de ningún Cloud Run Job interpola EPHEMERAL_PASSWORD/DSN crudos (solo referencias a secrets, nunca payloads)', () => {
      const envVarsCalls = [...source.matchAll(/--set-env-vars="([^"]*)"/g)].map((m) => m[1]);
      expect(envVarsCalls.length).toBeGreaterThan(0);
      for (const envVars of envVarsCalls) {
        expect(envVars).not.toMatch(/\$EPHEMERAL_PASSWORD\b/);
        expect(envVars).not.toMatch(/\$DSN\b/);
      }
    });

    it('16. la política de drift de SOURCE_SHA documentada coincide con la semántica real soportada por gh/GitHub Actions (--ref solo acepta branch/tag, nunca un SHA)', () => {
      // La frase `gh workflow run ... --ref <the exact source SHA>` SIGUE
      // apareciendo, pero únicamente citada como ejemplo de la instrucción
      // FALSA que este comentario corrige — nunca como una instrucción
      // accionable real. Se prueba explícitamente que está enmarcada como
      // falsa/no soportada, no que la frase esté ausente.
      expect(source).toMatch(/`--ref` as accepting only a "Branch or tag name," never a commit SHA/);
      expect(source).toMatch(/gh workflow run[^\n]*--ref[^\n]*<the exact source SHA>`\. That is FALSE and[\s\S]{0,40}UNSUPPORTED/);
      expect(source).toMatch(/HOLD_OPERATION_CONTEXT_DRIFT[\s\S]{0,400}NO existe forma soportada de re-dispatchear apply contra el SHA original/);
    });

    it('17. ninguna operación real sobre el PASSWORD SECRET regional usa el flag `gcloud secrets ... --location=` (confirmado roto por prueba en vivo — Phase 11); toda operación real pasa por curl', () => {
      // Solo prosa (comentarios) puede mencionar `--location=` — ninguna
      // línea de código real (gcloud/curl) lo usa como argumento operativo.
      const operationalLines = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'));
      const linesUsingLocationFlag = operationalLines.filter((line) => /--location=/.test(line));
      expect(linesUsingLocationFlag).toEqual([]);
      // Cada operación sobre el password secret pasa por REGIONAL_SM_BASE.
      expect(source).toMatch(/REGIONAL_SM_BASE="https:\/\/secretmanager\./);
      const regionalSmBaseUses = [...source.matchAll(/\$\{REGIONAL_SM_BASE\}/g)];
      expect(regionalSmBaseUses.length).toBeGreaterThanOrEqual(8); // create, addVersion, setIamPolicy, y las re-lecturas en verify-operation-context/cleanup-after-apply/cleanup-only
    });

    it('18. verify-prerequisites-instance verifica (solo lectura) dataApiAccess=ALLOW_DATA_API antes de cualquier bootstrap/apply, y NUNCA lo habilita él mismo', () => {
      const prereqSource = jobSource('verify-prerequisites-instance');
      expect(prereqSource).toMatch(/settings\.dataApiAccess/);
      expect(prereqSource).toMatch(/ALLOW_DATA_API/);
      expect(prereqSource).toMatch(/HOLD_DATA_API_ACCESS_NOT_ENABLED/);
      // Nunca debe existir un `gcloud sql instances patch ... --data-api-access=`
      // en este archivo — habilitarlo es una decisión de postura de
      // seguridad de Producción que requiere su propio Human Gate explícito,
      // nunca implícito dentro de este workflow.
      expect(source).not.toMatch(/--data-api-access=/);
    });
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
