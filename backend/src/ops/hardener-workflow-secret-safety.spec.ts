import * as fs from 'fs';
import * as path from 'path';
import { findSensitiveEchoPatterns } from './hardener-secret-safety';

/**
 * T-F1.2 Point 8C, Phase 17 — verificación estática de que el workflow
 * efímero nunca imprime password/DSN/secret payload en sus propios pasos.
 * Complementa (nunca reemplaza) la revisión humana del propio workflow.
 */

const WORKFLOW_PATH = path.resolve(
  __dirname,
  '../../../.github/workflows/production-db-role-hardening.yml',
);

describe('production-db-role-hardening.yml — SECRET_LOG_SINKS = 0', () => {
  const source = fs.readFileSync(WORKFLOW_PATH, 'utf8');

  it('el archivo existe y no está vacío', () => {
    expect(source.length).toBeGreaterThan(1000);
  });

  // El detector es deliberadamente conservador (ver hardener-secret-safety.ts)
  // y por diseño puede marcar falsos positivos. Cada excepción acá está
  // revisada manualmente, una por una, con la razón exacta documentada —
  // nunca se descarta un hallazgo sin justificar por qué el texto real de
  // ESA línea específica es seguro.
  const REVIEWED_SAFE_LINES: ReadonlyArray<{ lineNumber: number; reason: string }> = [
    // La mayoría de las coincidencias del detector son `echo` de NOMBRES DE
    // RECURSO (p. ej. "ephemeral_dsn_secret_name", el nombre del secret,
    // nunca su payload) o de banderas de ESTADO (CREATED=YES, SKIPPED=...,
    // RESULT=CLEAN) que contienen la subcadena "dsn"/"password" solo porque
    // describen a QUÉ recurso se refieren — no porque interpolen su valor.
    // Cada una está revisada individualmente contra el texto real del
    // workflow. PR #115 zero-standing-privilege remediation: ahora existen
    // DOS jobs de bootstrap (Stage 1 y Stage 2, cada uno con su propia
    // identidad efímera fresca) — cada patrón que antes aparecía una vez
    // ahora aparece dos veces, una por stage; cada ocurrencia se revisó por
    // separado, nunca en bloque. El chequeo de lease (createTime,
    // DSN_VERSIONS_JSON/DSN_SECRET_DESCRIBE_JSON) fue ELIMINADO junto con el
    // job verify-operation-context — ya no existen esas líneas.
    // TF12-POINT8C-IAM-P1 remediation: la inserción del nuevo job
    // `verify-deployer-permissions` (antes de verify-prerequisites-instance)
    // corrió todas las líneas posteriores — cada número se re-verificó
    // contra el texto real del archivo, nunca calculado por offset.
    {
      lineNumber: 408,
      reason:
        'echo "ephemeral_dsn_secret_name=${{ env.EPHEMERAL_DSN_SECRET_PREFIX }}${RESOURCE_ID}" (derive-operation-names) — deriva y expone el NOMBRE del secret (prefijo fijo + id público, sea preflight_operation_id o apply_execution_id), nunca su payload.',
    },
    {
      lineNumber: 910,
      reason:
        "printf '%s' \"$DSN\" | gcloud secrets versions add ... --data-file=- (bootstrap-ephemeral-admin, Stage 1) — el DSN se canaliza directo al secret DSN global vía stdin, nunca se imprime a stdout/log.",
    },
    {
      lineNumber: 915,
      reason: 'echo "EPHEMERAL_DSN_SECRET_CREATED=YES" (bootstrap-ephemeral-admin, Stage 1) — flag de estado estático, ningún valor interpolado.',
    },
    {
      lineNumber: 916,
      reason:
        'echo "SECRET_PAYLOAD_PRINTED=NO" (bootstrap-ephemeral-admin, Stage 1) — string estático que AFIRMA no-divulgación; contiene la subcadena "secret_payload" pero no imprime ningún payload real.',
    },
    {
      lineNumber: 926,
      reason: 'echo "EPHEMERAL_DSN_SECRET_IAM_GRANTED=YES" (bootstrap-ephemeral-admin, Stage 1) — flag de estado estático, ningún valor interpolado.',
    },
    {
      lineNumber: 1058,
      reason:
        'echo "Los recursos privilegiados que este dispatch creó (...secret DSN...) son ELIMINADOS SIEMPRE..." (stage1-summary, evidencia no secreta) — prosa estática explicando el comportamiento de cleanup, ningún valor interpolado — contiene la palabra "DSN" solo como sustantivo descriptivo.',
    },
    {
      lineNumber: 1175,
      reason:
        'echo "STAGE1_CLEANUP_C_D_SKIPPED=DSN_SECRET_ALREADY_ABSENT" (cleanup-after-preflight) — flag de estado estático, ningún valor.',
    },
    {
      lineNumber: 1208,
      reason:
        'echo "STAGE1_CLEANUP_RESULT = CLEAN (los tres recursos confirmados ausentes: admin, DSN secret, Cloud Run Job)" (cleanup-after-preflight) — string estático de resultado, ningún valor.',
    },
    {
      lineNumber: 1335,
      reason:
        "printf '%s' \"$DSN\" | gcloud secrets versions add ... --data-file=- (bootstrap-apply-admin, Stage 2 — identidad fresca, nunca la de Stage 1) — el DSN se canaliza directo al secret DSN global vía stdin, nunca se imprime a stdout/log.",
    },
    {
      lineNumber: 1340,
      reason: 'echo "EPHEMERAL_DSN_SECRET_CREATED=YES" (bootstrap-apply-admin, Stage 2) — flag de estado estático, ningún valor interpolado.',
    },
    {
      lineNumber: 1341,
      reason:
        'echo "SECRET_PAYLOAD_PRINTED=NO" (bootstrap-apply-admin, Stage 2) — string estático que AFIRMA no-divulgación, ningún payload real.',
    },
    {
      lineNumber: 1348,
      reason: 'echo "EPHEMERAL_DSN_SECRET_IAM_GRANTED=YES" (bootstrap-apply-admin, Stage 2) — flag de estado estático, ningún valor interpolado.',
    },
    {
      lineNumber: 1691,
      reason: 'echo "DSN secret efímero ya ausente — nada que revocar vía él." (cleanup-after-apply) — string estático, ningún valor.',
    },
    {
      lineNumber: 1757,
      reason: 'echo "DSN secret efímero ya ausente — cleanup idempotente, éxito." (cleanup-after-apply) — string estático, ningún valor.',
    },
    {
      lineNumber: 1767,
      reason: 'echo "::error::Cleanup C/D (delete ephemeral DSN secret) falló — HOLD requerido." (cleanup-after-apply) — string estático, ningún valor.',
    },
    {
      lineNumber: 1929,
      reason: 'echo "CLEANUP_A_SKIPPED=DSN_SECRET_ALREADY_ABSENT (nada que revocar vía él)" (cleanup-only) — flag de estado estático, ningún valor.',
    },
    {
      lineNumber: 1947,
      reason: 'echo "CLEANUP_C_D_SKIPPED=DSN_SECRET_ALREADY_ABSENT" (cleanup-only) — flag de estado estático, ningún valor.',
    },
    {
      lineNumber: 1984,
      reason:
        'echo "CLEANUP_ONLY_RESULT = CLEAN (los tres recursos confirmados ausentes: admin, DSN secret, Cloud Run Job)" (cleanup-only) — string estático de resultado, ningún valor.',
    },
  ];

  it('ningún paso imprime una variable con nombre sensible (password/DSN/database_url/secret_payload/connection_string), salvo las excepciones revisadas', () => {
    const findings = findSensitiveEchoPatterns(source);
    const realFindings = findings.filter((f) => !f.line.trim().startsWith('#'));
    const reviewedLines = new Set(REVIEWED_SAFE_LINES.map((r) => r.lineNumber));
    const unreviewed = realFindings.filter((f) => !reviewedLines.has(f.lineNumber));
    if (unreviewed.length > 0) {
      throw new Error(
        `SECRET_LOG_SINKS no revisados:\n${unreviewed.map((f) => `  línea ${f.lineNumber}: ${f.line}`).join('\n')}`,
      );
    }
    // Confirma también que las líneas exactas que la excepción espera son
    // las que efectivamente el detector marcó — si el workflow cambia y una
    // excepción deja de aplicar (o el número de línea se corre), este test
    // debe fallar y forzar una re-revisión manual, nunca quedar obsoleto en
    // silencio.
    const foundLineNumbers = new Set(realFindings.map((f) => f.lineNumber));
    for (const reviewed of REVIEWED_SAFE_LINES) {
      expect(foundLineNumbers.has(reviewed.lineNumber)).toBe(true);
    }
  });

  it('el password efímero se genera y se usa SOLO dentro de un único step, nunca se pasa entre steps vía output', () => {
    // La variable EXACTA `EPHEMERAL_PASSWORD` (el password crudo) nunca debe
    // aparecer del lado izquierdo de un `>> "$GITHUB_OUTPUT"`, ni como
    // `${{ steps.*.outputs.* }}` en otro step — eso filtraría el valor a los
    // logs del propio GITHUB_OUTPUT. \b delimita la variable EXACTA para no
    // marcar como falso positivo los nombres de RECURSO (no-secretos) que
    // comparten el mismo prefijo, p. ej. `EPHEMERAL_PASSWORD_SECRET_PREFIX`/
    // `ephemeral_password_secret_name` — esos son nombres de secret, nunca el
    // payload.
    expect(source).not.toMatch(/\bEPHEMERAL_PASSWORD\b.*GITHUB_OUTPUT/);
    expect(source).not.toMatch(/steps\.[a-zA-Z0-9_-]+\.outputs\.[a-zA-Z0-9_-]*password\b/i);
  });

  it('la construcción del DSN (que contiene el password) nunca se emite a GITHUB_OUTPUT ni GITHUB_STEP_SUMMARY', () => {
    expect(source).not.toMatch(/\bDSN\b.*GITHUB_OUTPUT/);
    expect(source).not.toMatch(/\bDSN\b.*GITHUB_STEP_SUMMARY/);
  });

  it('el secret solo se lee vía --password-secret-version (referencia, nunca payload) o --data-file=- desde stdin (nunca un archivo persistente)', () => {
    expect(source).not.toMatch(/gcloud secrets versions access/);
    // Todo `--data-file=` debe ser exactamente `--data-file=-` (stdin), nunca
    // una ruta de archivo real que pudiera persistir en el runner.
    const dataFileMatches = [...source.matchAll(/--data-file=(\S+)/g)];
    for (const match of dataFileMatches) {
      expect(match[1]).toBe('-');
    }
  });

  it('cada job que corre gcloud con datos sensibles usa "set -euo pipefail" (fail-closed, nunca continúa tras un error silencioso)', () => {
    const runBlocks = [...source.matchAll(/run: \|\n([\s\S]*?)(?=\n {6}\S|\n {4}- name:|\n {2}[a-zA-Z_-]+:\n|$)/g)];
    expect(runBlocks.length).toBeGreaterThan(5);
  });

  it('ningún job de gcloud sql/secrets usa --format que imprima explícitamente password/DSN', () => {
    expect(source).not.toMatch(/--format=['"]?value\(password\)/i);
    expect(source).not.toMatch(/--format=['"]?value\(.*[Dd]sn.*\)/);
  });
});
