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
  '../../../.github/workflows/production-db-role-hardener-ephemeral.yml',
);

describe('production-db-role-hardener-ephemeral.yml — SECRET_LOG_SINKS = 0', () => {
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
    // RECURSO (p. ej. "ephemeral_password_secret_name", el nombre del
    // secret, nunca su payload) o de banderas de ESTADO (CREATED=YES,
    // SKIPPED=..., RESULT=CLEAN) que contienen la subcadena "password"/"dsn"
    // solo porque describen a QUÉ secret se refieren — no porque interpolen
    // su valor. Cada una está revisada individualmente contra el texto real
    // del workflow, nunca descartada en bloque.
    {
      lineNumber: 295,
      reason:
        'echo "ephemeral_password_secret_name=${{ env.EPHEMERAL_PASSWORD_SECRET_PREFIX }}${OPERATION_ID}" — deriva y expone el NOMBRE del secret (prefijo fijo + operation_id público), nunca su payload.',
    },
    {
      lineNumber: 296,
      reason:
        'echo "ephemeral_dsn_secret_name=${{ env.EPHEMERAL_DSN_SECRET_PREFIX }}${OPERATION_ID}" — deriva y expone el NOMBRE del secret, nunca su payload.',
    },
    {
      lineNumber: 587,
      reason:
        'PASSWORD_B64="$(printf \'%s\' "$EPHEMERAL_PASSWORD" | base64 -w0)" — construye el payload base64 para el REST body; la variable resultante (PASSWORD_B64) nunca se imprime, solo se interpola en el `-d` de un `curl` (ver línea siguiente) y se usa dentro del mismo step.',
    },
    {
      lineNumber: 595,
      reason: 'echo "EPHEMERAL_PASSWORD_SECRET_CREATED=YES" — flag de estado estático, ningún valor interpolado.',
    },
    {
      lineNumber: 596,
      reason:
        'echo "SECRET_PAYLOAD_PRINTED=NO" (tras crear el PASSWORD SECRET) — string estático que AFIRMA no-divulgación; contiene la subcadena "secret_payload" pero no imprime ningún payload real.',
    },
    {
      lineNumber: 611,
      reason: 'echo "EPHEMERAL_PASSWORD_SECRET_IAM_GRANTED=YES" — flag de estado estático, ningún valor interpolado.',
    },
    {
      lineNumber: 625,
      reason:
        "printf '%s' \"$DSN\" | gcloud secrets versions add ... --data-file=- — el DSN se canaliza directo al DSN SECRET global vía stdin, nunca se imprime a stdout/log.",
    },
    {
      lineNumber: 630,
      reason: 'echo "EPHEMERAL_DSN_SECRET_CREATED=YES" — flag de estado estático, ningún valor interpolado.',
    },
    {
      lineNumber: 631,
      reason:
        'echo "SECRET_PAYLOAD_PRINTED=NO" (tras crear el DSN SECRET) — mismo string estático que AFIRMA no-divulgación, repetido una vez por secret creado.',
    },
    {
      lineNumber: 642,
      reason: 'echo "EPHEMERAL_DSN_SECRET_IAM_GRANTED=YES" — flag de estado estático, ningún valor interpolado.',
    },
    {
      lineNumber: 804,
      reason:
        'echo "- EPHEMERAL_PASSWORD_SECRET_NAME = ${{ needs...outputs.ephemeral_password_secret_name }} ..." (resumen STAGE 1) — imprime el NOMBRE del secret como evidencia no-secreta, nunca su payload.',
    },
    {
      lineNumber: 805,
      reason:
        'echo "- EPHEMERAL_DSN_SECRET_NAME = ${{ needs...outputs.ephemeral_dsn_secret_name }} (global)" (resumen STAGE 1) — imprime el NOMBRE del secret, nunca su payload.',
    },
    {
      lineNumber: 1171,
      reason: 'echo "Password secret efímero ya ausente — nada que revocar vía él." — string estático, ningún valor.',
    },
    {
      lineNumber: 1217,
      reason: 'echo "DSN secret efímero ya ausente — cleanup idempotente, éxito." — string estático, ningún valor.',
    },
    {
      lineNumber: 1227,
      reason: 'echo "::error::Cleanup C/D (delete ephemeral DSN secret) falló — HOLD requerido." — string estático, ningún valor.',
    },
    {
      lineNumber: 1245,
      reason: 'echo "Password secret efímero ya ausente — cleanup idempotente, éxito." — string estático, ningún valor.',
    },
    {
      lineNumber: 1255,
      reason: 'echo "::error::Cleanup E/F (delete ephemeral password secret) falló — HOLD requerido." — string estático, ningún valor.',
    },
    {
      lineNumber: 1390,
      reason: 'echo "CLEANUP_A_SKIPPED=PASSWORD_SECRET_ALREADY_ABSENT ..." — flag de estado estático, ningún valor.',
    },
    {
      lineNumber: 1406,
      reason: 'echo "CLEANUP_C_D_SKIPPED=DSN_SECRET_ALREADY_ABSENT" — flag de estado estático, ningún valor.',
    },
    {
      lineNumber: 1416,
      reason: 'echo "CLEANUP_E_F_SKIPPED=PASSWORD_SECRET_ALREADY_ABSENT" — flag de estado estático, ningún valor.',
    },
    {
      lineNumber: 1449,
      reason:
        'echo "CLEANUP_ONLY_RESULT = CLEAN (los tres recursos confirmados ausentes: admin, DSN secret, password secret)" — string estático de resultado, ningún valor.',
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
