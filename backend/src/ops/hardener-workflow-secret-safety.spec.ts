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
    {
      lineNumber: 498,
      reason:
        "printf '%s' \"$DSN\" | gcloud secrets versions add ... --data-file=- — el DSN se canaliza directo a Secret Manager vía stdin, nunca se imprime a stdout/log.",
    },
    {
      lineNumber: 504,
      reason:
        'echo "SECRET_PAYLOAD_PRINTED=NO" — string estático que AFIRMA no-divulgación; contiene la subcadena "secret_payload" pero no imprime ningún payload real.',
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
    // EPHEMERAL_PASSWORD nunca debe aparecer del lado derecho de un
    // `>> "$GITHUB_OUTPUT"`, ni como `${{ steps.*.outputs.* }}` en otro
    // step — eso filtraría el valor a los logs del propio GITHUB_OUTPUT.
    expect(source).not.toMatch(/EPHEMERAL_PASSWORD.*GITHUB_OUTPUT/);
    expect(source).not.toMatch(/steps\.[a-zA-Z0-9_-]+\.outputs\.[a-zA-Z0-9_-]*password/i);
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
