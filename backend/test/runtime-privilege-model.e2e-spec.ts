import { Client } from 'pg';
import { spawnSync } from 'child_process';
import {
  EXPECTED_MIGRATION_NAMES,
  classifyMigrationPrefix,
  findPgmigrationsRuntimeAccessViolations,
  diffRuntimePrivilegesAgainstMatrix,
  findCloudSqlSuperuserMemberships,
  type TablePrivilegeRow,
  type SequencePrivilegeRow,
} from '../src/ops/db-readonly-inspector';

/**
 * T-F1.2 — KORIXA_TF12_PRIVILEGE_MODEL_REMEDIATION, evidencia contra
 * PostgreSQL 16 REAL (no mockeado). Reusa el MISMO servicio Postgres 16
 * que el job "Backend — migración + e2e (C2)" ya levanta (mismo
 * `DATABASE_URL` de admin/bootstrap que ese job expone) — nunca un
 * segundo Postgres. `ridepro` (`POSTGRES_USER` de la imagen oficial
 * `postgres:16`) es superusuario del propio initdb de este contenedor
 * efímero — igual que cualquier `postgres:16` recién creado sin scripts
 * de init adicionales — así que puede crear una base y roles NUEVOS,
 * completamente separados de `ridepro_dev` (la base que usan el resto
 * de los `*.e2e-spec.ts`), sin interferir con ellos.
 *
 * NUNCA se conecta como `migration_test`/`runtime_test` a `ridepro_dev`
 * — todo este archivo vive en su propia base efímera
 * (`ridepro_privilege_model_test`), creada y destruida por este mismo
 * archivo.
 */

jest.setTimeout(180_000);

const ADMIN_DATABASE_URL = process.env.DATABASE_URL;
const TEST_DB_NAME = 'ridepro_privilege_model_test';
const MIGRATION_ROLE = 'migration_test';
const RUNTIME_ROLE = 'runtime_test';
const MIGRATION_PASSWORD = 'migration_test_pw';
const RUNTIME_PASSWORD = 'runtime_test_pw';

function withDatabase(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function roleConnectionUrl(role: string, password: string): string {
  const base = new URL(withDatabase(ADMIN_DATABASE_URL!, TEST_DB_NAME));
  return `postgres://${role}:${password}@${base.host}${base.pathname}`;
}

/** `spawnSync` real (no mock) — invoca exactamente los mismos comandos
 * que un despliegue real usaría, con un `env` controlado que EXCLUYE
 * `DATABASE_URL` del proceso hijo (contrato de migración: nunca
 * presente junto a `MIGRATION_DATABASE_URL`). */
function runNodePgMigrateUp(migrationDatabaseUrl: string): { exitCode: number; stdout: string; stderr: string } {
  const childEnv = { ...process.env };
  delete childEnv.DATABASE_URL;
  childEnv.MIGRATION_DATABASE_URL = migrationDatabaseUrl;
  const result = spawnSync('npx node-pg-migrate up -m migrations --database-url-var MIGRATION_DATABASE_URL', {
    cwd: process.cwd(),
    env: childEnv,
    encoding: 'utf8',
    shell: true,
  });
  return { exitCode: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runReconciler(migrationDatabaseUrl: string, runtimeDbRole: string): { exitCode: number; stdout: string; stderr: string } {
  const childEnv = { ...process.env };
  delete childEnv.DATABASE_URL;
  childEnv.MIGRATION_DATABASE_URL = migrationDatabaseUrl;
  childEnv.RUNTIME_DB_ROLE = runtimeDbRole;
  const result = spawnSync('npx ts-node src/ops/privilege-reconciler.ts', {
    cwd: process.cwd(),
    env: childEnv,
    encoding: 'utf8',
    shell: true,
  });
  return { exitCode: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const TABLE_PRIVILEGE_QUERY = `
  SELECT r.rolname, c.relname AS table_name,
         has_table_privilege(r.oid, c.oid, 'SELECT')     AS can_select,
         has_table_privilege(r.oid, c.oid, 'INSERT')     AS can_insert,
         has_table_privilege(r.oid, c.oid, 'UPDATE')     AS can_update,
         has_table_privilege(r.oid, c.oid, 'DELETE')     AS can_delete,
         has_table_privilege(r.oid, c.oid, 'TRUNCATE')   AS can_truncate,
         has_table_privilege(r.oid, c.oid, 'REFERENCES') AS can_references,
         has_table_privilege(r.oid, c.oid, 'TRIGGER')    AS can_trigger
  FROM pg_roles r
  CROSS JOIN pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE r.rolname = $1 AND n.nspname = 'public' AND c.relkind = 'r';
`;

const SEQUENCE_PRIVILEGE_QUERY = `
  SELECT r.rolname, c.relname AS sequence_name,
         has_sequence_privilege(r.oid, c.oid, 'USAGE')  AS can_usage,
         has_sequence_privilege(r.oid, c.oid, 'SELECT') AS can_select,
         has_sequence_privilege(r.oid, c.oid, 'UPDATE') AS can_update
  FROM pg_roles r
  CROSS JOIN pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE r.rolname = $1 AND n.nspname = 'public' AND c.relkind = 'S';
`;

const MEMBERSHIP_QUERY = `
  SELECT m.rolname AS member_role, r.rolname AS granted_role
  FROM pg_auth_members am
  JOIN pg_roles m ON m.oid = am.member
  JOIN pg_roles r ON r.oid = am.roleid
  WHERE m.rolname = $1;
`;

async function withClient<T>(connectionString: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe('Runtime privilege model — real PostgreSQL 16 (T-F1.2 privilege model remediation)', () => {
  let adminClient: Client;
  let adminTestDbClient: Client;
  let migrationDatabaseUrl: string;
  let runtimeDatabaseUrl: string;
  let postgresVersionMajor: number;

  beforeAll(async () => {
    if (!ADMIN_DATABASE_URL) {
      throw new Error('DATABASE_URL debe estar definida (conexión admin/bootstrap para este ensayo) — misma forma que el job C2.');
    }

    adminClient = new Client({ connectionString: withDatabase(ADMIN_DATABASE_URL, 'postgres') });
    await adminClient.connect();

    const versionResult = await adminClient.query('SHOW server_version_num;');
    postgresVersionMajor = Math.floor(Number(versionResult.rows[0].server_version_num) / 10000);

    // Limpieza defensiva por si una corrida anterior quedó a medias.
    await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE);`).catch(async () => {
      await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME};`).catch(() => {});
    });
    await adminClient.query(`DROP ROLE IF EXISTS ${MIGRATION_ROLE};`).catch(() => {});
    await adminClient.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE};`).catch(() => {});
    await adminClient.query(`DROP ROLE IF EXISTS cloudsqlsuperuser;`).catch(() => {});

    await adminClient.query(`CREATE DATABASE ${TEST_DB_NAME};`);
    await adminClient.query(
      `CREATE ROLE ${MIGRATION_ROLE} LOGIN PASSWORD '${MIGRATION_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
    );
    await adminClient.query(
      `CREATE ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${RUNTIME_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
    );

    // `adminClient` queda conectado a la base de mantenimiento
    // `postgres` (necesaria para CREATE/DROP DATABASE, que no puede
    // ejecutarse estando conectado a la propia base objetivo) — para
    // cualquier operación DENTRO de `TEST_DB_NAME` (schema/tablas) hace
    // falta una conexión superusuario aparte, scopeada a esa base.
    adminTestDbClient = new Client({ connectionString: withDatabase(ADMIN_DATABASE_URL, TEST_DB_NAME) });
    await adminTestDbClient.connect();

    await adminTestDbClient.query(`GRANT CONNECT ON DATABASE ${TEST_DB_NAME} TO ${MIGRATION_ROLE};`);
    await adminTestDbClient.query(`GRANT CONNECT ON DATABASE ${TEST_DB_NAME} TO ${RUNTIME_ROLE};`);
    await adminTestDbClient.query(`GRANT USAGE ON SCHEMA public TO ${MIGRATION_ROLE};`);
    await adminTestDbClient.query(`GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE};`);
    await adminTestDbClient.query(`GRANT CREATE ON SCHEMA public TO ${MIGRATION_ROLE};`);

    migrationDatabaseUrl = roleConnectionUrl(MIGRATION_ROLE, MIGRATION_PASSWORD);
    runtimeDatabaseUrl = roleConnectionUrl(RUNTIME_ROLE, RUNTIME_PASSWORD);
  });

  afterAll(async () => {
    await adminTestDbClient.end();
    await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE);`).catch(async () => {
      await adminClient.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME};`).catch(() => {});
    });
    await adminClient.query(`DROP ROLE IF EXISTS ${MIGRATION_ROLE};`).catch(() => {});
    await adminClient.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE};`).catch(() => {});
    await adminClient.query(`DROP ROLE IF EXISTS cloudsqlsuperuser;`).catch(() => {});
    await adminClient.end();
  });

  it('POSTGRES_VERSION_MAJOR = 16', () => {
    expect(postgresVersionMajor).toBe(16);
  });

  it('IDENTITIES_SEPARATED — migration_test != runtime_test', () => {
    expect(MIGRATION_ROLE).not.toBe(RUNTIME_ROLE);
  });

  it('MIGRATIONS_0001_0007 = PASS — aplicadas como migration_test vía MIGRATION_DATABASE_URL (nunca DATABASE_URL)', () => {
    const result = runNodePgMigrateUp(migrationDatabaseUrl);
    // `node-pg-migrate` emite "Can't determine timestamp for XXXX" por
    // stderr para nombres de archivo sin prefijo numérico largo — un
    // WARNING inocuo de su propio parser de nombres, no un fallo; lo
    // único que prueba éxito real es exitCode=0 + el mensaje final.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Migrations complete!');
  });

  it('MIGRATION_TRACKING = CONSISTENT — pgmigrations trackea exactamente los 7 nombres esperados', async () => {
    const names = await withClient(migrationDatabaseUrl, async (client) => {
      const rows = await client.query('SELECT name FROM pgmigrations ORDER BY run_on;');
      return rows.rows.map((r) => r.name as string);
    });
    const classification = classifyMigrationPrefix(names);
    expect(classification.state).toBe('TRACKED_AND_CONSISTENT');
    if (classification.state === 'TRACKED_AND_CONSISTENT') {
      expect(classification.applied).toEqual([...EXPECTED_MIGRATION_NAMES]);
    }
  });

  it('gen_random_uuid() funciona y pgcrypto NO está instalada (evidencia re-confirmada en este mismo ensayo)', async () => {
    const row = await withClient(migrationDatabaseUrl, async (client) => {
      const insert = await client.query(`INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id`, ['seed-check@example.com', 'seed']);
      const ext = await client.query(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS present;`);
      return { id: insert.rows[0].id as string, pgcryptoPresent: ext.rows[0].present as boolean };
    });
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.pgcryptoPresent).toBe(false);
  });

  it('reconciler RECONCILED — ejecutado como migration_test, targeting runtime_test', () => {
    const result = runReconciler(migrationDatabaseUrl, RUNTIME_ROLE);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.outcome).toBe('RECONCILED');
  });

  describe('runtime_test — operaciones permitidas (errores reales de PostgreSQL, sin mocks)', () => {
    it('SELECT/INSERT/UPDATE en users funcionan', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        const insert = await client.query(`INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id`, ['runtime-allowed@example.com', 'x']);
        expect(insert.rows[0].id).toBeTruthy();
        const select = await client.query('SELECT id FROM users WHERE id = $1', [insert.rows[0].id]);
        expect(select.rowCount).toBe(1);
        const update = await client.query(`UPDATE users SET display_name = $2 WHERE id = $1`, [insert.rows[0].id, 'y']);
        expect(update.rowCount).toBe(1);
      });
    });

    it('DELETE en users está DENIED — la matriz nunca lo autoriza', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query(`DELETE FROM users WHERE email = 'runtime-allowed@example.com'`)).rejects.toThrow();
      });
    });

    it('audit_log: RUNTIME_AUDIT_LOG_INSERT = PASS, UPDATE/DELETE = DENIED (append-only)', async () => {
      // Sin `RETURNING` — igual que el único llamador real
      // (`AuditLogRepository.record()`), que nunca lo usa. `RETURNING`
      // exige SELECT sobre la fila devuelta, y la matriz declara
      // `audit_log.select = false` (append-only real, PROVEN_BY_CODE) —
      // agregarlo acá estaría probando un uso que la aplicación nunca
      // hace, no el contrato real.
      await withClient(runtimeDatabaseUrl, async (client) => {
        const insert = await client.query(`INSERT INTO audit_log (action) VALUES ('e2e-runtime-allowed')`);
        expect(insert.rowCount).toBe(1);
        await expect(client.query(`UPDATE audit_log SET action = 'x' WHERE action = 'e2e-runtime-allowed'`)).rejects.toThrow();
        await expect(client.query(`DELETE FROM audit_log WHERE action = 'e2e-runtime-allowed'`)).rejects.toThrow();
      });
    });

    it('workouts + workout_intervals: SELECT/INSERT funcionan, workout_intervals nunca recibe UPDATE', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        const workout = await client.query(
          `INSERT INTO workouts (name, sport, estimated_duration_seconds, target_type) VALUES ($1,'cycling',60,'none') RETURNING id`,
          ['e2e workout'],
        );
        const interval = await client.query(
          `INSERT INTO workout_intervals (workout_id, position, duration_seconds) VALUES ($1,0,60) RETURNING id`,
          [workout.rows[0].id],
        );
        expect(interval.rows[0].id).toBeTruthy();
        await expect(client.query(`UPDATE workout_intervals SET duration_seconds = 30 WHERE id = $1`, [interval.rows[0].id])).rejects.toThrow();
      });
    });

    it('roles/equipment_categories: solo SELECT — INSERT está DENIED (datos de referencia estáticos)', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        const select = await client.query(`SELECT id FROM roles WHERE name = 'user'`);
        expect(select.rowCount).toBe(1);
        await expect(client.query(`INSERT INTO roles (id, name) VALUES (99, 'e2e_bogus_role')`)).rejects.toThrow();
      });
    });
  });

  describe('runtime_test — DDL prohibido (RUNTIME_DDL_DENIED)', () => {
    it('RUNTIME_CREATE_TABLE = DENIED', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query('CREATE TABLE runtime_should_not_create (id INT);')).rejects.toThrow();
      });
    });

    it('RUNTIME_ALTER_TABLE = DENIED', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query('ALTER TABLE users ADD COLUMN runtime_should_not_add TEXT;')).rejects.toThrow();
      });
    });

    it('RUNTIME_DROP_TABLE = DENIED', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query('DROP TABLE users;')).rejects.toThrow();
      });
    });

    it('RUNTIME_CREATE_ROLE = DENIED', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query(`CREATE ROLE runtime_should_not_create_role LOGIN;`)).rejects.toThrow();
      });
    });

    it('RUNTIME_GRANT_PRIVILEGE = DENIED (runtime no puede otorgar privilegios reales — verificado por EFECTO, no solo por excepción)', async () => {
      // Hallazgo empírico (ver privilege-reconciler.ts, mismo mecanismo
      // que motiva PARTIAL_GRANT_WARNING): cuando el grantor YA posee
      // (sin grant option) el privilegio que intenta otorgar, PostgreSQL
      // no siempre lanza una excepción — puede emitir un WARNING ("no
      // privileges were granted") y no hacer nada. `runtime_test` SÍ
      // tiene SELECT plano en `equipment_categories` (matriz), así que
      // este intento de GRANT podría "tener éxito" como no-op silencioso
      // en vez de rechazar la promesa — por eso la prueba real es el
      // EFECTO (¿cambió algo?), no únicamente si la llamada rechazó.
      const before = await withClient(migrationDatabaseUrl, (c) =>
        c.query(`SELECT has_table_privilege($1, 'equipment_categories', 'SELECT') AS can_select;`, [RUNTIME_ROLE]).then((r) => r.rows[0].can_select),
      );
      await withClient(runtimeDatabaseUrl, async (client) => {
        await client.query(`GRANT SELECT ON TABLE equipment_categories TO ${RUNTIME_ROLE};`).catch(() => {
          // Aceptable si rechaza — eso también prueba DENIED.
        });
      });
      const after = await withClient(migrationDatabaseUrl, (c) =>
        c.query(`SELECT has_table_privilege($1, 'equipment_categories', 'SELECT') AS can_select;`, [RUNTIME_ROLE]).then((r) => r.rows[0].can_select),
      );
      // El punto real: runtime_test no puede alterar NINGÚN privilegio,
      // ni siquiera re-otorgarse a sí mismo uno que ya tiene — el estado
      // antes/después debe ser idéntico.
      expect(after).toBe(before);

      // Intento adicional, más estricto: sobre `pgmigrations` (la única
      // tabla con la que runtime_test no tiene NINGUNA relación previa,
      // ni siquiera SELECT) un GRANT sí es un ERROR real y directo, sin
      // la ambigüedad del WARNING-no-op — confirmado empíricamente
      // contra este mismo Postgres antes de escribir esta aserción.
      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query(`GRANT SELECT ON TABLE pgmigrations TO ${MIGRATION_ROLE};`)).rejects.toThrow();
      });
    });
  });

  describe('runtime_test — pgmigrations (RUNTIME_PGMIGRATIONS_MUTATION_DENIED)', () => {
    it('RUNTIME_SELECT_PGMIGRATIONS = DENIED', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query('SELECT * FROM pgmigrations;')).rejects.toThrow();
      });
    });
    it('RUNTIME_INSERT_PGMIGRATIONS = DENIED', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query(`INSERT INTO pgmigrations (name, run_on) VALUES ('bogus', now());`)).rejects.toThrow();
      });
    });
    it('RUNTIME_UPDATE_PGMIGRATIONS = DENIED', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query(`UPDATE pgmigrations SET run_on = now();`)).rejects.toThrow();
      });
    });
    it('RUNTIME_DELETE_PGMIGRATIONS = DENIED', async () => {
      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query(`DELETE FROM pgmigrations WHERE name = '0001_init';`)).rejects.toThrow();
      });
    });
  });

  it('RECONCILE_RUN_2 = PASS, PRIVILEGE_DRIFT_AFTER_SECOND_RUN = NO — idempotencia real', async () => {
    const result = runReconciler(migrationDatabaseUrl, RUNTIME_ROLE);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).outcome).toBe('RECONCILED');

    const [tableRows, sequenceRows, schemaCreateRow] = await Promise.all([
      withClient(migrationDatabaseUrl, (c) => c.query(TABLE_PRIVILEGE_QUERY, [RUNTIME_ROLE]).then((r) => r.rows as TablePrivilegeRow[])),
      withClient(migrationDatabaseUrl, (c) => c.query(SEQUENCE_PRIVILEGE_QUERY, [RUNTIME_ROLE]).then((r) => r.rows as SequencePrivilegeRow[])),
      withClient(migrationDatabaseUrl, (c) =>
        c.query(`SELECT $1::text AS rolname, has_schema_privilege($1, 'public', 'CREATE') AS can_schema_create;`, [RUNTIME_ROLE]).then((r) => r.rows[0]),
      ),
    ]);

    const drift = diffRuntimePrivilegesAgainstMatrix(tableRows, sequenceRows, schemaCreateRow, RUNTIME_ROLE);
    expect(drift).toEqual({ missing: [], unexpected: [] });
  });

  it('VALID_MODEL — clasificación del inspector contra datos reales: cero drift, cero acceso a pgmigrations, cero cloudsqlsuperuser', async () => {
    const [tableRows, sequenceRows, schemaCreateRow, membershipRows] = await Promise.all([
      withClient(migrationDatabaseUrl, (c) => c.query(TABLE_PRIVILEGE_QUERY, [RUNTIME_ROLE]).then((r) => r.rows as TablePrivilegeRow[])),
      withClient(migrationDatabaseUrl, (c) => c.query(SEQUENCE_PRIVILEGE_QUERY, [RUNTIME_ROLE]).then((r) => r.rows as SequencePrivilegeRow[])),
      withClient(migrationDatabaseUrl, (c) =>
        c.query(`SELECT $1::text AS rolname, has_schema_privilege($1, 'public', 'CREATE') AS can_schema_create;`, [RUNTIME_ROLE]).then((r) => r.rows[0]),
      ),
      withClient(migrationDatabaseUrl, (c) => c.query(MEMBERSHIP_QUERY, [RUNTIME_ROLE]).then((r) => r.rows)),
    ]);

    expect(findPgmigrationsRuntimeAccessViolations(tableRows, RUNTIME_ROLE)).toEqual([]);
    expect(diffRuntimePrivilegesAgainstMatrix(tableRows, sequenceRows, schemaCreateRow, RUNTIME_ROLE)).toEqual({ missing: [], unexpected: [] });
    expect(findCloudSqlSuperuserMemberships(membershipRows)).toEqual([]);
  });

  // ===========================================================================
  // Red-team interno (mission sección 20) — dos propiedades centrales del
  // rediseño que no quedaban probadas contra Postgres real en los tests
  // anteriores; se agregan acá antes de entregar.
  // ===========================================================================

  it('"future table != automatic broad runtime access" — una tabla nueva creada por migration_test DESPUÉS de reconciliar NO recibe acceso automático (Estrategia A, sin ALTER DEFAULT PRIVILEGES)', async () => {
    await withClient(migrationDatabaseUrl, (c) => c.query('CREATE TABLE red_team_future_table (id BIGSERIAL PRIMARY KEY, note TEXT);'));
    try {
      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query('SELECT * FROM red_team_future_table;')).rejects.toThrow();
        await expect(client.query(`INSERT INTO red_team_future_table (note) VALUES ('should not be allowed');`)).rejects.toThrow();
      });

      // Ni siquiera un reconcile posterior la otorga — no está en la
      // matriz, así que jamás aparece en ningún GRANT generado.
      const result = runReconciler(migrationDatabaseUrl, RUNTIME_ROLE);
      expect(result.exitCode).toBe(0);

      await withClient(runtimeDatabaseUrl, async (client) => {
        await expect(client.query('SELECT * FROM red_team_future_table;')).rejects.toThrow();
      });
    } finally {
      await withClient(migrationDatabaseUrl, (c) => c.query('DROP TABLE red_team_future_table;'));
    }
  });

  it('ROLLBACK real ante un fallo genuino a mitad de la transacción de GRANT (identidad sin ownership de las tablas existentes)', async () => {
    // Identidad DISTINTA de migration_test, con CREATE en schema (pasa el
    // chequeo de contexto) pero SIN relación previa con ninguna tabla
    // existente — un GRANT nombrado por tabla emitido por esta identidad
    // es un ERROR real de PostgreSQL (confirmado empíricamente durante
    // el desarrollo de este mismo archivo: sin ninguna relación previa =
    // ERROR duro, no WARNING-no-op), así que el bucle de statements debe
    // fallar a mitad de camino y revertir TODO — nunca dejar otorgado un
    // subconjunto de tablas.
    const rogueRole = 'red_team_rogue_migration';
    await adminClient.query(`DROP ROLE IF EXISTS ${rogueRole};`).catch(() => {});
    await adminClient.query(`CREATE ROLE ${rogueRole} LOGIN PASSWORD 'x' NOSUPERUSER NOCREATEDB NOCREATEROLE;`);
    await adminTestDbClient.query(`GRANT CONNECT ON DATABASE ${TEST_DB_NAME} TO ${rogueRole};`);
    await adminTestDbClient.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${rogueRole};`);

    try {
      const rogueMigrationDatabaseUrl = roleConnectionUrl(rogueRole, 'x');
      const result = runReconciler(rogueMigrationDatabaseUrl, RUNTIME_ROLE);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error_code).toBe('GRANT_STATEMENT_FAILED');

      // Ownership/grants de runtime_test sobre las tablas reales quedan
      // exactamente como antes (el reconcile "sano" previo) — nada
      // parcial, nada roto.
      const tableRows = await withClient(migrationDatabaseUrl, (c) => c.query(TABLE_PRIVILEGE_QUERY, [RUNTIME_ROLE]).then((r) => r.rows as TablePrivilegeRow[]));
      const sequenceRows = await withClient(migrationDatabaseUrl, (c) => c.query(SEQUENCE_PRIVILEGE_QUERY, [RUNTIME_ROLE]).then((r) => r.rows as SequencePrivilegeRow[]));
      const schemaCreateRow = await withClient(migrationDatabaseUrl, (c) =>
        c.query(`SELECT $1::text AS rolname, has_schema_privilege($1, 'public', 'CREATE') AS can_schema_create;`, [RUNTIME_ROLE]).then((r) => r.rows[0]),
      );
      expect(diffRuntimePrivilegesAgainstMatrix(tableRows, sequenceRows, schemaCreateRow, RUNTIME_ROLE)).toEqual({ missing: [], unexpected: [] });
    } finally {
      await adminTestDbClient.query(`REVOKE ALL ON SCHEMA public FROM ${rogueRole};`).catch(() => {});
      await adminClient.query(`DROP ROLE IF EXISTS ${rogueRole};`).catch(() => {});
    }
  });

  // ===========================================================================
  // TEST ADVERSARIAL (mission sección 12) — cada escenario se induce
  // manualmente en la base efímera, se prueba que el inspector/reconciler
  // lo detecta con evidencia REAL, y se restaura antes del siguiente test.
  // ===========================================================================
  describe('adversarial', () => {
    it('A — GRANT DELETE extra en users -> drift detectado contra Postgres real', async () => {
      await withClient(migrationDatabaseUrl, (c) => c.query(`GRANT DELETE ON TABLE users TO ${RUNTIME_ROLE};`));
      try {
        const tableRows = await withClient(migrationDatabaseUrl, (c) => c.query(TABLE_PRIVILEGE_QUERY, [RUNTIME_ROLE]).then((r) => r.rows as TablePrivilegeRow[]));
        const drift = diffRuntimePrivilegesAgainstMatrix(tableRows, [], undefined, RUNTIME_ROLE);
        expect(drift.unexpected).toContain('table:users:delete');
      } finally {
        await withClient(migrationDatabaseUrl, (c) => c.query(`REVOKE DELETE ON TABLE users FROM ${RUNTIME_ROLE};`));
      }
    });

    it('B — GRANT SELECT en pgmigrations -> reconciler se niega (PGMIGRATIONS_PRIVILEGE_DETECTED) e inspector detecta HOLD', async () => {
      await withClient(migrationDatabaseUrl, (c) => c.query(`GRANT SELECT ON TABLE pgmigrations TO ${RUNTIME_ROLE};`));
      try {
        const reconcilerResult = runReconciler(migrationDatabaseUrl, RUNTIME_ROLE);
        expect(reconcilerResult.exitCode).toBe(1);
        expect(JSON.parse(reconcilerResult.stderr).error_code).toBe('PGMIGRATIONS_PRIVILEGE_DETECTED');

        const tableRows = await withClient(migrationDatabaseUrl, (c) => c.query(TABLE_PRIVILEGE_QUERY, [RUNTIME_ROLE]).then((r) => r.rows as TablePrivilegeRow[]));
        const violations = findPgmigrationsRuntimeAccessViolations(tableRows, RUNTIME_ROLE);
        expect(violations.length).toBeGreaterThan(0);
      } finally {
        await withClient(migrationDatabaseUrl, (c) => c.query(`REVOKE SELECT ON TABLE pgmigrations FROM ${RUNTIME_ROLE};`));
      }
    });

    it('C — GRANT cloudsqlsuperuser (rol ficticio, exclusivo de este Postgres efímero) al runtime -> HOLD detectado', async () => {
      await adminClient.query(`CREATE ROLE cloudsqlsuperuser;`).catch(() => {});
      await adminClient.query(`GRANT cloudsqlsuperuser TO ${RUNTIME_ROLE};`);
      try {
        const membershipRows = await withClient(migrationDatabaseUrl, (c) => c.query(MEMBERSHIP_QUERY, [RUNTIME_ROLE]).then((r) => r.rows));
        const findings = findCloudSqlSuperuserMemberships(membershipRows);
        expect(findings.length).toBeGreaterThan(0);
        expect(findings[0]).toContain('cloudsqlsuperuser');
      } finally {
        await adminClient.query(`REVOKE cloudsqlsuperuser FROM ${RUNTIME_ROLE};`).catch(() => {});
      }
    });

    it('D — GRANT CREATE en schema public al runtime -> HOLD detectado', async () => {
      // Otorgado por `adminClient` (superusuario real del contenedor
      // efímero), no por `migration_test`: `migration_test` solo tiene
      // CREATE plano en schema public (sin grant option, ver bootstrap
      // de `beforeAll`), y un GRANT a nivel de schema por un rol sin
      // grant option degrada a WARNING-no-op en PostgreSQL real
      // (confirmado empíricamente) — para simular de verdad este
      // escenario adversarial hace falta una identidad con autoridad
      // real para otorgarlo, exactamente como lo haría un operador que
      // comete el error, no el propio migration_test.
      await adminTestDbClient.query(`GRANT CREATE ON SCHEMA public TO ${RUNTIME_ROLE};`);
      try {
        const schemaCreateRow = await withClient(migrationDatabaseUrl, (c) =>
          c.query(`SELECT $1::text AS rolname, has_schema_privilege($1, 'public', 'CREATE') AS can_schema_create;`, [RUNTIME_ROLE]).then((r) => r.rows[0]),
        );
        expect(schemaCreateRow.can_schema_create).toBe(true);
        const drift = diffRuntimePrivilegesAgainstMatrix([], [], schemaCreateRow, RUNTIME_ROLE);
        expect(drift.unexpected).toContain('schema:public:create');
      } finally {
        await adminTestDbClient.query(`REVOKE CREATE ON SCHEMA public FROM ${RUNTIME_ROLE};`);
      }
    });

    it('E — runtime convertido en owner de un objeto -> visible en pg_class (el inspector real ya prueba esto vía classifyOwnerModel, cubierto en db-readonly-inspector.spec.ts)', async () => {
      // `ALTER ... OWNER TO` exige que el ejecutor pueda `SET ROLE` al
      // nuevo owner (ser superusuario o miembro de ese rol) —
      // `migration_test` no es miembro de `runtime_test`, así que solo
      // `adminTestDbClient` (superusuario real, conectado a la base de
      // prueba) puede simular este escenario.
      await adminTestDbClient.query(`ALTER TABLE public.roles OWNER TO ${RUNTIME_ROLE};`);
      try {
        const ownerRow = await withClient(migrationDatabaseUrl, (c) =>
          c.query(`SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = 'roles';`).then((r) => r.rows[0]),
        );
        expect(ownerRow.owner).toBe(RUNTIME_ROLE);
      } finally {
        await adminTestDbClient.query(`ALTER TABLE public.roles OWNER TO ${MIGRATION_ROLE};`);
      }
    });

    it('cierre — tras todo el churn adversarial, un reconcile final vuelve a RECONCILED con cero drift', async () => {
      const result = runReconciler(migrationDatabaseUrl, RUNTIME_ROLE);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).outcome).toBe('RECONCILED');

      const tableRows = await withClient(migrationDatabaseUrl, (c) => c.query(TABLE_PRIVILEGE_QUERY, [RUNTIME_ROLE]).then((r) => r.rows as TablePrivilegeRow[]));
      const sequenceRows = await withClient(migrationDatabaseUrl, (c) => c.query(SEQUENCE_PRIVILEGE_QUERY, [RUNTIME_ROLE]).then((r) => r.rows as SequencePrivilegeRow[]));
      const schemaCreateRow = await withClient(migrationDatabaseUrl, (c) =>
        c.query(`SELECT $1::text AS rolname, has_schema_privilege($1, 'public', 'CREATE') AS can_schema_create;`, [RUNTIME_ROLE]).then((r) => r.rows[0]),
      );
      expect(diffRuntimePrivilegesAgainstMatrix(tableRows, sequenceRows, schemaCreateRow, RUNTIME_ROLE)).toEqual({ missing: [], unexpected: [] });
      expect(findPgmigrationsRuntimeAccessViolations(tableRows, RUNTIME_ROLE)).toEqual([]);
    });
  });

  describe('role-name injection contra el reconciliador real (defensa en profundidad, con proceso real)', () => {
    it('RUNTIME_DB_ROLE con forma de inyección SQL nunca conecta ni ejecuta GRANT', () => {
      const result = runReconciler(migrationDatabaseUrl, 'runtime_test"; DROP TABLE users; --');
      expect(result.exitCode).toBe(1);
      const parsed = JSON.parse(result.stderr);
      expect(parsed.error_code).toBe('INVALID_RUNTIME_DB_ROLE_IDENTIFIER');
    });

    it('usuarios reales siguen intactos tras el intento de inyección', async () => {
      const count = await withClient(migrationDatabaseUrl, (c) => c.query('SELECT count(*) FROM users;').then((r) => Number(r.rows[0].count)));
      expect(count).toBeGreaterThanOrEqual(0); // la tabla debe seguir existiendo (no fue DROPeada)
    });
  });
});
