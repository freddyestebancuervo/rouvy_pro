/**
 * T-F1.2 Point 8C — utilidades puras de detección de fuga de secretos, para
 * la orquestación efímera del hardener.
 *
 * =============================================================================
 * QUÉ ES Y QUÉ NO ES
 * =============================================================================
 * Estas funciones NO son la defensa principal contra fugas — esa es, como
 * siempre en este repo, NUNCA construir el secreto en una variable que
 * pueda terminar en un `echo`/log en primer lugar (ver `db-role-hardener.ts`,
 * `sanitizeUnexpectedError`). Son una CAPA ADICIONAL, de solo-lectura: dado
 * un texto candidato a imprimirse (p. ej. la salida capturada de un comando
 * `gcloud`) y el conjunto de valores que nunca deben aparecer en texto plano
 * (password recién generado, DSN completo, payload de un secret), confirman
 * mecánicamente su ausencia — para usarse tanto en tests unitarios como,
 * opcionalmente, como un paso extra de defensa en profundidad dentro del
 * propio workflow antes de escribir a `GITHUB_STEP_SUMMARY`/logs.
 *
 * Reachability: módulo puro, sin I/O — importarlo nunca conecta a nada.
 * =============================================================================
 */

export interface SecretLeakFinding {
  /** Etiqueta segura del valor detectado (nunca el valor mismo). */
  label: string;
}

/**
 * Confirma que ninguno de `secretValues` (cada uno con una etiqueta segura,
 * nunca el valor en sí, para el reporte) aparece como substring literal de
 * `candidateText`. Vacío/undefined en `secretValues` se ignora (nunca un
 * falso positivo por comparar contra `''`, que sería substring de todo).
 *
 * También detecta variantes base64 y URL-encoded del valor, ya que un DSN
 * con caracteres especiales en el password a menudo aparece percent-encoded
 * dentro de una connection string.
 */
export function findSecretLeaks(
  candidateText: string,
  secretValues: ReadonlyArray<{ label: string; value: string | undefined }>,
): SecretLeakFinding[] {
  const findings: SecretLeakFinding[] = [];
  for (const { label, value } of secretValues) {
    if (!value) continue; // valor ausente/vacío nunca es una fuga real a buscar
    const variants = new Set<string>([value]);
    try {
      variants.add(encodeURIComponent(value));
    } catch {
      // valor no codificable — se ignora esa variante, la literal ya se probó
    }
    try {
      variants.add(Buffer.from(value, 'utf8').toString('base64'));
    } catch {
      // idem
    }
    for (const variant of variants) {
      if (variant.length >= 4 && candidateText.includes(variant)) {
        findings.push({ label });
        break;
      }
    }
  }
  return findings;
}

export function assertNoSecretLeak(
  candidateText: string,
  secretValues: ReadonlyArray<{ label: string; value: string | undefined }>,
): void {
  const findings = findSecretLeaks(candidateText, secretValues);
  if (findings.length > 0) {
    const labels = findings.map((f) => f.label).join(', ');
    throw new Error(`SECRET_LEAK_DETECTED en texto candidato a log/salida — etiquetas: ${labels}. Nunca se imprime el texto ni el valor real.`);
  }
}

// =============================================================================
// Patrones estructurales — para escanear TEXTO DE WORKFLOW/CÓDIGO FUENTE (no
// datos en runtime) en busca de la FORMA de una fuga potencial: una línea
// `run:`/`echo`/`console.log` que referencia una variable cuyo NOMBRE sugiere
// que contiene un secreto. Esto es un lint estático, no una prueba en
// runtime — complementa, nunca reemplaza, `findSecretLeaks`.
// =============================================================================

const SENSITIVE_NAME_FRAGMENT = /(password|passwd|dsn|database_url|db_url|secret_payload|connection_string)/i;

export interface SensitiveEchoFinding {
  lineNumber: number;
  line: string;
}

/**
 * Escanea texto fuente línea por línea buscando un `echo`/`console.log`/
 * `print` que interpola una variable con un nombre sensible. Deliberadamente
 * simple (sin parseo de shell real) — pensado para correr sobre el YAML del
 * workflow como una red de seguridad adicional, no como sustituto de la
 * revisión humana del propio workflow.
 */
export function findSensitiveEchoPatterns(sourceText: string): SensitiveEchoFinding[] {
  const findings: SensitiveEchoFinding[] = [];
  const lines = sourceText.split('\n');
  const printCommand = /\b(echo|console\.log|print|Write-Output|printf)\b/i;
  lines.forEach((line, index) => {
    if (printCommand.test(line) && SENSITIVE_NAME_FRAGMENT.test(line)) {
      findings.push({ lineNumber: index + 1, line: line.trim() });
    }
  });
  return findings;
}
