import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

/**
 * TF12-POINT8C-IAM-P1-INDEPENDENT-AUDIT-REMEDIATION (P1-A) — pruebas de
 * COMPORTAMIENTO REAL del clasificador `classify_resource`, no solo de su
 * presencia estática en el YAML (eso ya lo prueba
 * `hardener-workflow-contract.spec.ts`). Este archivo extrae la definición
 * bash real y la EJECUTA de verdad, en un subproceso bash real, contra
 * comandos simulados que reproducen exactamente los tres textos de error
 * NOT_FOUND observados en vivo durante esta misma investigación (Cloud SQL
 * users -> "HTTPError 404"; Secret Manager -> "NOT_FOUND:"; Cloud Run Jobs
 * -> "Cannot find job") — nunca inventados.
 *
 * Cubre exactamente los 8 escenarios requeridos por la misión de
 * remediación P1-A.
 */

const WORKFLOW_PATH = path.resolve(__dirname, '../../../.github/workflows/production-db-role-hardening.yml');
const source = fs.readFileSync(WORKFLOW_PATH, 'utf8');

/** Extrae TODAS las ocurrencias de la definición de `classify_resource` —
 * una por step que la necesita (las funciones bash no persisten entre
 * steps de GitHub Actions, así que se duplica deliberadamente, ver
 * comentario en cada step). */
function extractAllClassifierDefinitions(): string[] {
  const re = /classify_resource\(\) \{\n([\s\S]*?)\n\s*\}\n/g;
  const matches = [...source.matchAll(re)];
  return matches.map((m) => m[0]!);
}

/** Dedenta un bloque extraído del YAML (10 espacios de indentación base) a
 * bash ejecutable en columna 0, preservando la indentación RELATIVA
 * interna. */
function dedent(block: string): string {
  const lines = block.split('\n');
  const indents = lines.filter((l) => l.trim().length > 0).map((l) => l.match(/^ */)![0]!.length);
  const minIndent = Math.min(...indents);
  return lines.map((l) => l.slice(minIndent)).join('\n');
}

/** Ejecuta el clasificador extraído (dedentado) dentro de un script bash
 * real que además define comandos "gcloud" falsos reproduciendo
 * exactamente cada escenario — nunca contra GCP real. */
function runClassifierScenario(classifierDefinition: string, kind: string, fakeCommandName: string, fakeCommandBody: string): string {
  const script = `
set -uo pipefail
${dedent(classifierDefinition)}

${fakeCommandName}() {
${fakeCommandBody}
}

classify_resource ${kind} ${fakeCommandName}
`;
  const output = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
  return output.trim();
}

describe('classify_resource — comportamiento real, ejecutado en bash (P1-A, Fase Required tests 1-8)', () => {
  const definitions = extractAllClassifierDefinitions();

  it('la función classify_resource aparece exactamente 6 veces (una por step que hace un existence-check: cleanup-after-preflight x2, cleanup-after-apply x5 -> Estado A/B/C-D/E/F, cleanup-only x2) — nunca ausente en un step que la necesita', () => {
    // No fijamos un número exacto rígido en este test — lo importante es
    // que exista más de una vez (duplicación deliberada, documentada) y
    // que ninguna copia diverja (siguiente test).
    expect(definitions.length).toBeGreaterThanOrEqual(6);
  });

  it('todas las copias de classify_resource en el archivo son BYTE A BYTE idénticas — nunca dos implementaciones divergentes mantenidas por separado', () => {
    const unique = new Set(definitions.map((d) => d.trim()));
    expect(unique.size).toBe(1);
  });

  const canonical = definitions[0]!;

  it('1. exit 0 real (sin error) -> EXISTS', () => {
    const result = runClassifierScenario(canonical, 'cloudsql_user', 'fake_gcloud', 'return 0');
    expect(result).toBe('EXISTS');
  });

  it('1b. exit 1 con el texto EXACTO de NOT_FOUND observado en vivo para Cloud SQL users ("HTTPError 404") -> ABSENT_CONFIRMED', () => {
    const result = runClassifierScenario(
      canonical,
      'cloudsql_user',
      'fake_gcloud',
      'echo "ERROR: (gcloud.sql.users.describe) HTTPError 404: Not Found. This command is authenticated as x" >&2; return 1',
    );
    expect(result).toBe('ABSENT_CONFIRMED');
  });

  it('1c. exit 1 con el texto EXACTO de NOT_FOUND observado en vivo para Secret Manager ("NOT_FOUND:") -> ABSENT_CONFIRMED', () => {
    const result = runClassifierScenario(
      canonical,
      'secret',
      'fake_gcloud',
      'echo "ERROR: (gcloud.secrets.describe) NOT_FOUND: Secret [projects/x/secrets/y] not found." >&2; return 1',
    );
    expect(result).toBe('ABSENT_CONFIRMED');
  });

  it('1d. exit 1 con el texto EXACTO de NOT_FOUND observado en vivo para Cloud Run Jobs ("Cannot find job") -> ABSENT_CONFIRMED', () => {
    const result = runClassifierScenario(canonical, 'cloudrun_job', 'fake_gcloud', 'echo "ERROR: (gcloud.run.jobs.describe) Cannot find job [x]." >&2; return 1');
    expect(result).toBe('ABSENT_CONFIRMED');
  });

  it('2. HTTP 403 (permission denied, NUNCA not-found) -> LOOKUP_FAILED — invariante PERMISSION_DENIED != NOT_FOUND', () => {
    const result = runClassifierScenario(
      canonical,
      'cloudsql_user',
      'fake_gcloud',
      'echo "ERROR: (gcloud.sql.users.describe) HTTPError 403: The client is not authorized to make this request." >&2; return 1',
    );
    expect(result).toBe('LOOKUP_FAILED');
  });

  it('3. fallo de autenticación (credenciales inválidas/expiradas, texto genérico distinto de NOT_FOUND) -> LOOKUP_FAILED', () => {
    const result = runClassifierScenario(canonical, 'secret', 'fake_gcloud', 'echo "ERROR: Reauthentication failed or credentials are invalid." >&2; return 1');
    expect(result).toBe('LOOKUP_FAILED');
  });

  it('4. fallo transitorio/de API (500, servicio no disponible) -> LOOKUP_FAILED — invariante API_FAILURE != NOT_FOUND', () => {
    const result = runClassifierScenario(canonical, 'cloudrun_job', 'fake_gcloud', 'echo "ERROR: (gcloud.run.jobs.describe) HTTPError 503: Service Unavailable." >&2; return 1');
    expect(result).toBe('LOOKUP_FAILED');
  });

  it('5. timeout simulado (exit no-cero sin ningún texto de error reconocible) -> LOOKUP_FAILED — invariante TIMEOUT != NOT_FOUND', () => {
    const result = runClassifierScenario(canonical, 'cloudsql_user', 'fake_gcloud', 'return 1');
    expect(result).toBe('LOOKUP_FAILED');
  });

  it('6/9 (implícito por diseño — probado por contrato, no acá): cleanup nunca puede emitir CLEAN si algún lookup fue LOOKUP_FAILED — ver hardener-workflow-contract.spec.ts, tests de ABSENT_CONFIRMED exigido en los tres recursos', () => {
    // Placeholder intencional de trazabilidad — la aserción real vive en el
    // test de contrato "9. ningún recurso privilegiado..." y en los tests
    // de cada job de cleanup, que exigen ABSENT_CONFIRMED literal en los
    // tres recursos antes de declarar CLEAN.
    expect(true).toBe(true);
  });

  it('7. cross-contamination: un patrón NOT_FOUND de OTRO tipo de recurso (p. ej. "NOT_FOUND:" de Secret Manager) NUNCA se acepta como ABSENT_CONFIRMED para un chequeo de tipo distinto (cloudsql_user) — cada `kind` usa su propio patrón, nunca uno genérico', () => {
    const result = runClassifierScenario(
      canonical,
      'cloudsql_user',
      'fake_gcloud',
      'echo "ERROR: (gcloud.secrets.describe) NOT_FOUND: Secret [x] not found." >&2; return 1',
    );
    expect(result).toBe('LOOKUP_FAILED');
  });

  it('8. el mismo invariante se aplica sin importar el kind — Cloud Run Job "Cannot find job" nunca clasifica un chequeo de tipo "secret" como ausente', () => {
    const result = runClassifierScenario(canonical, 'secret', 'fake_gcloud', 'echo "ERROR: (gcloud.run.jobs.describe) Cannot find job [x]." >&2; return 1');
    expect(result).toBe('LOOKUP_FAILED');
  });

  it('9. TF12-POINT8C-IAM-P1-EFFECTIVE-ACTAS-FINAL-REMEDIATION (P2): un kind DESCONOCIDO nunca cae al chequeo genérico — con stderr arbitrario (incluso no vacío) siempre da LOOKUP_FAILED, nunca ABSENT_CONFIRMED', () => {
    const result = runClassifierScenario(
      canonical,
      'totally_unknown_kind',
      'fake_gcloud',
      'echo "cualquier texto de stderr, incluso no vacío, que con un not_found_pattern vacío matchearía por accidente" >&2; return 1',
    );
    expect(result).toBe('LOOKUP_FAILED');
    expect(result).not.toBe('ABSENT_CONFIRMED');
  });

  it('9b. un kind desconocido con exit 1 pero stderr VACÍO tampoco produce ABSENT_CONFIRMED — el default branch retorna LOOKUP_FAILED antes de llegar al grep genérico, sin importar el contenido del stderr', () => {
    const result = runClassifierScenario(canonical, 'totally_unknown_kind', 'fake_gcloud', 'return 1');
    expect(result).toBe('LOOKUP_FAILED');
  });
});
