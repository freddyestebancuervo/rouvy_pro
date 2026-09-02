import { findSecretLeaks, assertNoSecretLeak, findSensitiveEchoPatterns } from './hardener-secret-safety';

describe('findSecretLeaks / assertNoSecretLeak', () => {
  const PASSWORD = 'Sup3r$ecretPW_qa-test-only';
  const DSN = `postgres://korixa_db_hardener_once_abc123def456:${PASSWORD}@10.10.16.3:5432/korixa_production`;

  it('detecta el valor literal presente en el texto', () => {
    const findings = findSecretLeaks(`Ejecutando... ${PASSWORD} ...listo`, [{ label: 'password', value: PASSWORD }]);
    expect(findings).toEqual([{ label: 'password' }]);
  });

  it('no reporta nada cuando el valor no aparece', () => {
    const findings = findSecretLeaks('Ejecutando... [REDACTED] ...listo', [{ label: 'password', value: PASSWORD }]);
    expect(findings).toEqual([]);
  });

  it('detecta el DSN completo embebido en un log de error hipotético', () => {
    const findings = findSecretLeaks(`connection failed: ${DSN}`, [{ label: 'dsn', value: DSN }]);
    expect(findings).toEqual([{ label: 'dsn' }]);
  });

  it('detecta la variante URL-encoded del valor', () => {
    const withSpecialChars = 'p@ss/word?with&special=chars';
    const encoded = encodeURIComponent(withSpecialChars);
    const findings = findSecretLeaks(`texto con ${encoded} adentro`, [{ label: 'password', value: withSpecialChars }]);
    expect(findings).toEqual([{ label: 'password' }]);
  });

  it('detecta la variante base64 del valor', () => {
    const value = 'another-secret-value-1234';
    const b64 = Buffer.from(value, 'utf8').toString('base64');
    const findings = findSecretLeaks(`payload=${b64}`, [{ label: 'secret', value }]);
    expect(findings).toEqual([{ label: 'secret' }]);
  });

  it('ignora valores ausentes/vacíos sin falso positivo', () => {
    const findings = findSecretLeaks('cualquier texto', [
      { label: 'a', value: undefined },
      { label: 'b', value: '' },
    ]);
    expect(findings).toEqual([]);
  });

  it('reporta múltiples fugas distintas en el mismo texto', () => {
    const findings = findSecretLeaks(`${PASSWORD} y también ${DSN}`, [
      { label: 'password', value: PASSWORD },
      { label: 'dsn', value: DSN },
    ]);
    expect(findings.map((f) => f.label).sort()).toEqual(['dsn', 'password']);
  });

  it('assertNoSecretLeak no lanza si no hay fuga', () => {
    expect(() => assertNoSecretLeak('texto limpio', [{ label: 'password', value: PASSWORD }])).not.toThrow();
  });

  it('assertNoSecretLeak lanza, y el mensaje de error nunca incluye el valor real', () => {
    let thrown: Error | undefined;
    try {
      assertNoSecretLeak(`oops: ${PASSWORD}`, [{ label: 'password', value: PASSWORD }]);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toContain('password');
    expect(thrown?.message).not.toContain(PASSWORD);
  });
});

describe('findSensitiveEchoPatterns — lint estático sobre texto fuente', () => {
  it('detecta un echo que interpola una variable con nombre sensible', () => {
    const source = 'echo "DSN=$MIGRATION_DATABASE_URL"';
    const findings = findSensitiveEchoPatterns(source);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.lineNumber).toBe(1);
  });

  it('detecta console.log de una variable llamada password', () => {
    const source = 'console.log("password:", ephemeralPassword);';
    expect(findSensitiveEchoPatterns(source)).toHaveLength(1);
  });

  it('no marca un echo inocuo sin ningún término sensible', () => {
    const source = 'echo "SOURCE_SHA=$SOURCE_SHA"\necho "MODE=$MODE"';
    expect(findSensitiveEchoPatterns(source)).toEqual([]);
  });

  it('es deliberadamente conservador: un comentario que menciona echo+password igual se marca (falso positivo aceptable — mejor sobre-reportar que dejar pasar una fuga real)', () => {
    const source = '# nunca hacer echo del password acá';
    expect(findSensitiveEchoPatterns(source)).toHaveLength(1);
  });

  it('no marca una línea sin ningún comando de impresión, aunque mencione un término sensible', () => {
    const source = 'const password = readSecretFromVault();';
    expect(findSensitiveEchoPatterns(source)).toEqual([]);
  });

  it('reporta el número de línea correcto en un archivo multilinea', () => {
    const source = ['line one', 'line two', 'echo "$DATABASE_URL"', 'line four'].join('\n');
    const findings = findSensitiveEchoPatterns(source);
    expect(findings).toEqual([{ lineNumber: 3, line: 'echo "$DATABASE_URL"' }]);
  });
});
