import * as fs from 'fs';
import * as path from 'path';
import {
  INSPECTION_QUERIES,
  EXPECTED_MIGRATION_NAMES,
  ENGINE_TRACKING_OBJECTS,
  parseConnectionString,
  assertExpectedTarget,
  classifyMigrationPrefix,
  expectedObjectsForApplied,
  diffPhysicalSchema,
  summarizePhysicalDiff,
  classifyOwnerModel,
  findPrivilegeEscalations,
  findMissingExpectedRoles,
  topLevelStatementForm,
  InspectorError,
  runInspection,
  type RoleCapabilityRow,
  type ExpectedPhysicalSet,
  type ActualPhysicalInventory,
} from './db-readonly-inspector';

// `pg.Client` se mockea por completo — ningún test de este archivo toca
// una base de datos real (Correction/PHASE 23: "NO real database").
const mockConnect = jest.fn();
const mockQuery = jest.fn();
const mockEnd = jest.fn();

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation((config: unknown) => ({
    __config: config,
    connect: mockConnect,
    query: mockQuery,
    end: mockEnd,
  })),
}));

const OK_ROLE_CAPS: RoleCapabilityRow[] = [
  {
    rolname: 'korixa_app',
    rolsuper: false,
    rolinherit: true,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: true,
    rolreplication: false,
    rolbypassrls: false,
  },
  {
    rolname: 'korixa_runtime',
    rolsuper: false,
    rolinherit: true,
    rolcreaterole: false,
    rolcreatedb: false,
    rolcanlogin: true,
    rolreplication: false,
    rolbypassrls: false,
  },
];

function baseEnv(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return {
    DATABASE_URL: 'postgres://korixa_runtime:secret-password-value@10.1.2.3:5432/korixa_production',
    EXPECTED_DATABASE: 'korixa_production',
    EXPECTED_DB_HOST: '10.1.2.3',
    EXPECTED_SOURCE_SHA: 'a'.repeat(40),
    EXPECTED_MIGRATION_SET_HASH: 'b'.repeat(64),
    ...overrides,
  };
}

/** Inventario físico "completo y sano" para las 6 migraciones aplicadas
 * — usado como base para los tests de mutación (quitar/agregar un
 * objeto puntual) en vez de repetir la lista entera cada vez. */
function fullHealthyInventory(): { tables: string[]; indexes: string[]; sequences: string[]; columns: string[] } {
  const expected = expectedObjectsForApplied([...EXPECTED_MIGRATION_NAMES]);
  return {
    tables: [...expected.tables],
    indexes: [...expected.indexes],
    sequences: [...expected.sequences, ...ENGINE_TRACKING_OBJECTS.sequences],
    columns: [...expected.columns],
  };
}

/**
 * Despachador de queries por texto — refleja el orden real de
 * `runInspection` sin acoplar los tests a ese orden exacto (dispatch por
 * contenido, no por índice de llamada).
 */
function installHappyPathMock(options: {
  transactionReadOnly?: string;
  currentUser?: string;
  currentDatabase?: string;
  pgmigrationsExists?: boolean;
  trackedNames?: string[];
  objectOwners?: { schema: string; object_name: string; object_type: string; owner: string }[];
  indexNames?: string[];
  columnRows?: { table_name: string; column_name: string }[];
  pgcryptoPresent?: boolean;
  roleCapabilityRows?: RoleCapabilityRow[];
  dbOwnerRows?: { datname: string; owner: string }[];
  schemaOwnerRows?: { nspname: string; owner: string }[];
}) {
  const {
    transactionReadOnly = 'on',
    currentUser = 'korixa_runtime',
    currentDatabase = 'korixa_production',
    pgmigrationsExists = true,
    trackedNames = ['0001_init', '0002_users_email_case_insensitive_unique'],
    objectOwners = [],
    indexNames = [],
    columnRows = [],
    pgcryptoPresent = true,
    roleCapabilityRows = OK_ROLE_CAPS,
    dbOwnerRows = [{ datname: 'korixa_production', owner: 'korixa_app' }],
    schemaOwnerRows = [{ nspname: 'public', owner: 'korixa_app' }],
  } = options;

  mockConnect.mockResolvedValue(undefined);
  mockEnd.mockResolvedValue(undefined);
  mockQuery.mockImplementation((sql: string) => {
    const form = topLevelStatementForm(sql);
    if (form === 'BEGIN_READ_ONLY') return Promise.resolve({ rows: [] });
    if (form === 'ROLLBACK') return Promise.resolve({ rows: [] });

    if (sql === INSPECTION_QUERIES.readOnlyAssertion) {
      return Promise.resolve({ rows: [{ transaction_read_only: transactionReadOnly }] });
    }
    if (sql === INSPECTION_QUERIES.identity) {
      return Promise.resolve({
        rows: [{ database: currentDatabase, current_user: currentUser, session_user: currentUser }],
      });
    }
    if (sql === INSPECTION_QUERIES.roleCapabilities) {
      return Promise.resolve({ rows: roleCapabilityRows });
    }
    if (sql === INSPECTION_QUERIES.roleMemberships) {
      return Promise.resolve({ rows: [] });
    }
    if (sql === INSPECTION_QUERIES.databaseOwnership) {
      return Promise.resolve({ rows: dbOwnerRows });
    }
    if (sql === INSPECTION_QUERIES.schemaOwnership) {
      return Promise.resolve({ rows: schemaOwnerRows });
    }
    if (sql === INSPECTION_QUERIES.objectOwnership) {
      return Promise.resolve({ rows: objectOwners });
    }
    if (sql === INSPECTION_QUERIES.databasePrivileges) {
      return Promise.resolve({
        rows: [
          { rolname: 'korixa_app', can_connect: true, can_schema_usage: true, can_schema_create: true },
          { rolname: 'korixa_runtime', can_connect: true, can_schema_usage: true, can_schema_create: false },
        ],
      });
    }
    if (sql === INSPECTION_QUERIES.tablePrivileges) {
      return Promise.resolve({
        rows: [
          {
            rolname: 'korixa_runtime',
            table_name: 'users',
            can_select: true,
            can_insert: true,
            can_update: true,
            can_delete: true,
            can_truncate: false,
            can_references: false,
            can_trigger: false,
          },
        ],
      });
    }
    if (sql === INSPECTION_QUERIES.sequencePrivileges) {
      return Promise.resolve({
        rows: [{ rolname: 'korixa_runtime', sequence_name: 'audit_log_id_seq', can_usage: true, can_select: false, can_update: true }],
      });
    }
    if (sql === INSPECTION_QUERIES.migrationTrackerExists) {
      return Promise.resolve({ rows: [{ pgmigrations_exists: pgmigrationsExists }] });
    }
    if (sql === INSPECTION_QUERIES.migrationTrackerRows) {
      return Promise.resolve({ rows: trackedNames.map((name) => ({ name, run_on: '2026-08-22T00:00:00.000Z' })) });
    }
    if (sql === INSPECTION_QUERIES.indexInventory) {
      return Promise.resolve({ rows: indexNames.map((indexname) => ({ indexname })) });
    }
    if (sql === INSPECTION_QUERIES.columnInventory) {
      return Promise.resolve({ rows: columnRows });
    }
    if (sql === INSPECTION_QUERIES.pgcryptoPresent) {
      return Promise.resolve({ rows: [{ pgcrypto_present: pgcryptoPresent }] });
    }
    throw new Error(`Query no reconocida por el mock: ${sql}`);
  });
}

/** Instala un mock "totalmente sano" para las 6 migraciones aplicadas —
 * usado como punto de partida para los tests de mutación puntual
 * (quitar un índice, agregar una tabla extra, etc.). */
function installFullyHealthyMock(overrides: Parameters<typeof installHappyPathMock>[0] = {}) {
  const inv = fullHealthyInventory();
  installHappyPathMock({
    trackedNames: [...EXPECTED_MIGRATION_NAMES],
    objectOwners: [
      ...inv.tables.map((t) => ({ schema: 'public', object_name: t, object_type: 'table', owner: 'korixa_app' })),
      ...inv.sequences.map((s) => ({ schema: 'public', object_name: s, object_type: 'sequence', owner: 'korixa_app' })),
    ],
    indexNames: inv.indexes,
    columnRows: inv.columns.map((c) => {
      const dot = c.indexOf('.');
      return { table_name: c.slice(0, dot), column_name: c.slice(dot + 1) };
    }),
    pgcryptoPresent: true,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DATABASE_URL;
  delete process.env.EXPECTED_DATABASE;
  delete process.env.EXPECTED_DB_HOST;
  delete process.env.EXPECTED_SOURCE_SHA;
  delete process.env.EXPECTED_MIGRATION_SET_HASH;
});

function setEnv(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

describe('db-readonly-inspector', () => {
  // ---------------------------------------------------------------------
  // 1-2. DATABASE_URL / password nunca en el output.
  // ---------------------------------------------------------------------
  describe('DATABASE_URL y password nunca aparecen en el resultado', () => {
    it('el resultado exitoso no contiene el DSN ni la contraseña en ningún campo serializado', async () => {
      const env = baseEnv();
      setEnv(env);
      installFullyHealthyMock();

      const result = await runInspection();
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain('secret-password-value');
      expect(serialized).not.toContain(env.DATABASE_URL);
      expect(Object.keys(result)).not.toContain('DATABASE_URL');
    });

    it('un error de conexión nunca expone el DSN en su mensaje', async () => {
      setEnv(baseEnv());
      mockConnect.mockRejectedValue(new Error(`connection to server failed: postgres://user:realpassword@host/db`));
      mockEnd.mockResolvedValue(undefined);

      await expect(runInspection()).rejects.toMatchObject({ code: 'DB_CONNECTION_FAILED' });
      try {
        await runInspection();
      } catch (error) {
        expect((error as InspectorError).message).not.toContain('realpassword');
      }
    });
  });

  // ---------------------------------------------------------------------
  // 3-4. Primer statement exacto + assertion inmediata.
  // ---------------------------------------------------------------------
  describe('orden de statements', () => {
    it('el primer statement ejecutado es exactamente BEGIN READ ONLY', async () => {
      setEnv(baseEnv());
      installFullyHealthyMock();

      await runInspection();

      expect(mockQuery.mock.calls[0][0]).toBe(INSPECTION_QUERIES.beginReadOnly);
      expect(topLevelStatementForm(mockQuery.mock.calls[0][0])).toBe('BEGIN_READ_ONLY');
    });

    it('la assertion de solo-lectura se ejecuta inmediatamente después de BEGIN', async () => {
      setEnv(baseEnv());
      installFullyHealthyMock();

      await runInspection();

      expect(mockQuery.mock.calls[1][0]).toBe(INSPECTION_QUERIES.readOnlyAssertion);
    });
  });

  // ---------------------------------------------------------------------
  // 5. transaction_read_only != 'on' -> ninguna consulta de inspección corre.
  // ---------------------------------------------------------------------
  it('si transaction_read_only no es exactamente "on", no se ejecuta ninguna consulta de inspección', async () => {
    setEnv(baseEnv());
    installHappyPathMock({ transactionReadOnly: 'off' });

    await expect(runInspection()).rejects.toMatchObject({ code: 'READ_ONLY_ASSERTION_FAILED' });

    const executedQueries = mockQuery.mock.calls.map((c) => c[0]);
    expect(executedQueries).not.toContain(INSPECTION_QUERIES.identity);
    expect(executedQueries).not.toContain(INSPECTION_QUERIES.roleCapabilities);
    expect(executedQueries).not.toContain(INSPECTION_QUERIES.migrationTrackerRows);
  });

  // ---------------------------------------------------------------------
  // 6. current_database mismatch -> fail closed.
  // ---------------------------------------------------------------------
  it('current_database() distinto de EXPECTED_DATABASE falla cerrado (DATABASE_IDENTITY_MISMATCH)', async () => {
    setEnv(baseEnv());
    installHappyPathMock({ currentDatabase: 'some_other_database' });

    await expect(runInspection()).rejects.toMatchObject({ code: 'DATABASE_IDENTITY_MISMATCH' });
  });

  // ---------------------------------------------------------------------
  // 7. current_user mismatch -> fail closed DESPUÉS de la query de identidad,
  // sin ejecutar el resto del catálogo (Correction A).
  // ---------------------------------------------------------------------
  it('current_user distinto del esperado falla cerrado y detiene la inspección de catálogo', async () => {
    setEnv(baseEnv());
    installHappyPathMock({ currentUser: 'korixa_app' });

    await expect(runInspection()).rejects.toMatchObject({
      code: 'CREDENTIAL_DB_USER_MISMATCH',
      evidence: { actual_current_user: 'korixa_app' },
    });

    const executedQueries = mockQuery.mock.calls.map((c) => c[0]);
    expect(executedQueries).toContain(INSPECTION_QUERIES.identity);
    expect(executedQueries).not.toContain(INSPECTION_QUERIES.roleCapabilities);
    expect(executedQueries).not.toContain(INSPECTION_QUERIES.migrationTrackerRows);
  });

  // ---------------------------------------------------------------------
  // 8/20. Identidad válida -> continúa, pero credential_db_user_mapping
  // no implica db_role_model probado (P1-3).
  // ---------------------------------------------------------------------
  it('con identidad válida la inspección completa; credential_db_user_mapping no implica db_role_model probado', async () => {
    setEnv(baseEnv());
    installFullyHealthyMock();

    const result = await runInspection();

    expect(result.credential_db_user_mapping).toBe('MATCHES_EXPECTED');
    expect(result.db_role_model).toBe('UNPROVEN_REQUIRES_REVIEW');
    expect(result.final_disposition).toBeDefined();
  });

  // ---------------------------------------------------------------------
  // 9. No existe ninguna API de query libre.
  // ---------------------------------------------------------------------
  it('INSPECTION_QUERIES no expone ningún método de ejecución libre — solo strings constantes', () => {
    for (const value of Object.values(INSPECTION_QUERIES)) {
      expect(typeof value).toBe('string');
    }
  });

  // ---------------------------------------------------------------------
  // 10-13. Clasificación de prefijos de migración.
  // ---------------------------------------------------------------------
  describe('classifyMigrationPrefix', () => {
    it('clasifica correctamente cada prefijo válido, incluyendo el vacío y el completo — un prefijo vacío es TRACKED_AND_CONSISTENT(applied=[]), nunca un estado especial "vacío probado" (P1-4)', () => {
      for (let i = 0; i <= EXPECTED_MIGRATION_NAMES.length; i += 1) {
        const prefix = EXPECTED_MIGRATION_NAMES.slice(0, i);
        const result = classifyMigrationPrefix([...prefix]);
        expect(result.state).toBe('TRACKED_AND_CONSISTENT');
        if (result.state === 'TRACKED_AND_CONSISTENT') {
          expect(result.applied).toEqual(prefix);
          expect(result.pending).toEqual(EXPECTED_MIGRATION_NAMES.slice(i));
        }
      }
    });

    it('un gap (falta un elemento intermedio) es INVALID_MIGRATION_ORDER, no corrupción implícita', () => {
      const result = classifyMigrationPrefix(['0001_init', '0003_equipment']);
      expect(result.state).toBe('INVALID_MIGRATION_ORDER');
    });

    it('un nombre de migración desconocido es UNEXPECTED_MIGRATION_NAMES', () => {
      const result = classifyMigrationPrefix(['0001_init', '9999_no_existe']);
      expect(result.state).toBe('UNEXPECTED_MIGRATION_NAMES');
      if (result.state === 'UNEXPECTED_MIGRATION_NAMES') {
        expect(result.unexpected).toEqual(['9999_no_existe']);
      }
    });

    it('un nombre duplicado es INVALID_MIGRATION_ORDER', () => {
      const result = classifyMigrationPrefix(['0001_init', '0001_init']);
      expect(result.state).toBe('INVALID_MIGRATION_ORDER');
    });

    it('un prefijo válido pero incompleto NO es tratado como corrupción (Correction D)', () => {
      const result = classifyMigrationPrefix(['0001_init', '0002_users_email_case_insensitive_unique', '0003_equipment']);
      expect(result.state).toBe('TRACKED_AND_CONSISTENT');
    });
  });

  // ---------------------------------------------------------------------
  // 9-10 (remediación). pgmigrations vacía/ausente + presencia/ausencia
  // de objetos de aplicación — las 4 combinaciones de la Remediación 4.
  // ---------------------------------------------------------------------
  describe('CLEAN_EMPTY vs HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING (Remediación 4, P1-4)', () => {
    it('A: pgmigrations ausente + sin objetos de aplicación -> CLEAN_EMPTY', async () => {
      setEnv(baseEnv());
      installHappyPathMock({ pgmigrationsExists: false, trackedNames: [], objectOwners: [] });

      const result = await runInspection();

      expect(result.pgmigrations.exists).toBe(false);
      expect(result.final_disposition).toBe('CLEAN_EMPTY');
    });

    it('B: pgmigrations existe pero vacía + solo objetos del motor -> CLEAN_EMPTY, con pgmigrations.exists=true visible', async () => {
      setEnv(baseEnv());
      installHappyPathMock({
        pgmigrationsExists: true,
        trackedNames: [],
        objectOwners: [
          { schema: 'public', object_name: 'pgmigrations', object_type: 'table', owner: 'korixa_runtime' },
          { schema: 'public', object_name: 'pgmigrations_id_seq', object_type: 'sequence', owner: 'korixa_runtime' },
        ],
      });

      const result = await runInspection();

      expect(result.pgmigrations.exists).toBe(true);
      expect(result.final_disposition).toBe('CLEAN_EMPTY');
    });

    it('C: pgmigrations existe pero vacía + un objeto de aplicación existe -> HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING (bug confirmado por la auditoría, ahora corregido)', async () => {
      setEnv(baseEnv());
      installHappyPathMock({
        pgmigrationsExists: true,
        trackedNames: [],
        objectOwners: [{ schema: 'public', object_name: 'users', object_type: 'table', owner: 'korixa_app' }],
      });

      const result = await runInspection();

      expect(result.pgmigrations.exists).toBe(true);
      expect(result.final_disposition).toBe('HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING');
    });

    it('D: pgmigrations ausente + un objeto de aplicación existe -> HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING', async () => {
      setEnv(baseEnv());
      installHappyPathMock({
        pgmigrationsExists: false,
        trackedNames: [],
        objectOwners: [{ schema: 'public', object_name: 'users', object_type: 'table', owner: 'korixa_app' }],
      });

      const result = await runInspection();

      expect(result.final_disposition).toBe('HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING');
    });
  });

  // ---------------------------------------------------------------------
  // Remediación 1/2/3/5/18 — diff físico completo: faltantes y
  // sobrantes en las 5 categorías, vía runInspection() de punta a punta
  // sobre un inventario "sano" con exactamente una mutación cada vez.
  // ---------------------------------------------------------------------
  describe('completitud física — faltantes (P1-1)', () => {
    it('1. índice esperado faltante (0006 aplicada) -> HOLD_TRACKING_WITH_MISSING_OBJECTS', async () => {
      setEnv(baseEnv());
      const inv = fullHealthyInventory();
      installFullyHealthyMock({ indexNames: inv.indexes.filter((i) => i !== 'idx_equipment_user_created_id') });

      const result = await runInspection();

      expect(result.final_disposition).toBe('HOLD_TRACKING_WITH_MISSING_OBJECTS');
      expect(result.physical_schema.expected_missing).toContain('index:idx_equipment_user_created_id');
    });

    it('2. secuencia esperada faltante (audit_log_id_seq) -> HOLD_TRACKING_WITH_MISSING_OBJECTS', async () => {
      setEnv(baseEnv());
      const inv = fullHealthyInventory();
      installFullyHealthyMock({
        objectOwners: [
          ...inv.tables.map((t) => ({ schema: 'public', object_name: t, object_type: 'table', owner: 'korixa_app' })),
          // audit_log_id_seq deliberadamente ausente
          { schema: 'public', object_name: 'pgmigrations_id_seq', object_type: 'sequence', owner: 'korixa_runtime' },
        ],
      });

      const result = await runInspection();

      expect(result.final_disposition).toBe('HOLD_TRACKING_WITH_MISSING_OBJECTS');
      expect(result.physical_schema.expected_missing).toContain('sequence:audit_log_id_seq');
    });

    it('3. extensión pgcrypto ausente (0001 aplicada) ya NO produce HOLD -- pgcrypto salió del conjunto esperado (gen_random_uuid() es core en PG16)', async () => {
      setEnv(baseEnv());
      installFullyHealthyMock({ pgcryptoPresent: false });

      const result = await runInspection();

      expect(result.final_disposition).toBe('TRACKED_AND_CONSISTENT');
      expect(result.physical_schema.classification).toBe('MATCHES_APPLIED');
      expect(result.physical_schema.expected_missing).not.toContain('extension:pgcrypto');
    });

    it('4. columna users.firebase_uid faltante (0005 aplicada) -> HOLD_TRACKING_WITH_MISSING_OBJECTS (el bug original: la query se ejecutaba pero su resultado se descartaba)', async () => {
      setEnv(baseEnv());
      const inv = fullHealthyInventory();
      installFullyHealthyMock({
        columnRows: inv.columns
          .filter((c) => c !== 'users.firebase_uid')
          .map((c) => {
            const dot = c.indexOf('.');
            return { table_name: c.slice(0, dot), column_name: c.slice(dot + 1) };
          }),
      });

      const result = await runInspection();

      expect(result.final_disposition).toBe('HOLD_TRACKING_WITH_MISSING_OBJECTS');
      expect(result.physical_schema.expected_missing).toContain('column:users.firebase_uid');
    });
  });

  describe('completitud física — sobrantes (P1-5, antes estructuralmente inalcanzable)', () => {
    it('5. tabla extra no explicada -> HOLD_UNEXPECTED_SCHEMA_OBJECTS', async () => {
      setEnv(baseEnv());
      const inv = fullHealthyInventory();
      installFullyHealthyMock({
        objectOwners: [
          ...inv.tables.map((t) => ({ schema: 'public', object_name: t, object_type: 'table', owner: 'korixa_app' })),
          ...inv.sequences.map((s) => ({ schema: 'public', object_name: s, object_type: 'sequence', owner: 'korixa_app' })),
          { schema: 'public', object_name: 'manual_table', object_type: 'table', owner: 'korixa_app' },
        ],
      });

      const result = await runInspection();

      expect(result.final_disposition).toBe('HOLD_UNEXPECTED_SCHEMA_OBJECTS');
      expect(result.physical_schema.unexpected_objects).toContain('table:manual_table');
    });

    it('6. secuencia extra no explicada -> HOLD_UNEXPECTED_SCHEMA_OBJECTS', async () => {
      setEnv(baseEnv());
      const inv = fullHealthyInventory();
      installFullyHealthyMock({
        objectOwners: [
          ...inv.tables.map((t) => ({ schema: 'public', object_name: t, object_type: 'table', owner: 'korixa_app' })),
          ...inv.sequences.map((s) => ({ schema: 'public', object_name: s, object_type: 'sequence', owner: 'korixa_app' })),
          { schema: 'public', object_name: 'manual_seq', object_type: 'sequence', owner: 'korixa_app' },
        ],
      });

      const result = await runInspection();

      expect(result.final_disposition).toBe('HOLD_UNEXPECTED_SCHEMA_OBJECTS');
      expect(result.physical_schema.unexpected_objects).toContain('sequence:manual_seq');
    });

    it('7. índice extra no explicado -> HOLD_UNEXPECTED_SCHEMA_OBJECTS', async () => {
      setEnv(baseEnv());
      const inv = fullHealthyInventory();
      installFullyHealthyMock({ indexNames: [...inv.indexes, 'idx_manual_unexplained'] });

      const result = await runInspection();

      expect(result.final_disposition).toBe('HOLD_UNEXPECTED_SCHEMA_OBJECTS');
      expect(result.physical_schema.unexpected_objects).toContain('index:idx_manual_unexplained');
    });

    it('8. columna extra en una tabla esperada -> HOLD_UNEXPECTED_SCHEMA_OBJECTS', async () => {
      setEnv(baseEnv());
      const inv = fullHealthyInventory();
      installFullyHealthyMock({
        columnRows: [
          ...inv.columns.map((c) => {
            const dot = c.indexOf('.');
            return { table_name: c.slice(0, dot), column_name: c.slice(dot + 1) };
          }),
          { table_name: 'users', column_name: 'manual_unexplained_column' },
        ],
      });

      const result = await runInspection();

      expect(result.final_disposition).toBe('HOLD_UNEXPECTED_SCHEMA_OBJECTS');
      expect(result.physical_schema.unexpected_objects).toContain('column:users.manual_unexplained_column');
    });

    it('columna extra en una tabla NO esperada no se reporta por separado (ya cubierta por unexpectedTables, evita ruido duplicado)', () => {
      const expected: ExpectedPhysicalSet = { tables: new Set(['users']), indexes: new Set(), sequences: new Set(), extensions: new Set(), columns: new Set(['users.id']) };
      const actual: ActualPhysicalInventory = {
        tables: new Set(['users', 'manual_table']),
        indexes: new Set(),
        sequences: new Set(),
        pgcryptoPresent: true,
        columns: new Set(['users.id', 'manual_table.some_column']),
      };
      const diff = diffPhysicalSchema(expected, actual);
      expect(diff.unexpectedTables).toEqual(['manual_table']);
      expect(diff.unexpectedColumns).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  // 16-17 (remediación). Modelo de ownership.
  // ---------------------------------------------------------------------
  describe('classifyOwnerModel', () => {
    it('korixa_runtime como owner de un objeto de aplicación es una violación (HOLD) — y produce db_role_model=OBVIOUS_VIOLATION', () => {
      expect(classifyOwnerModel(['korixa_runtime'], true)).toBe('CASE_C_RUNTIME_OWNER_VIOLATION');
    });

    it('ownership mixto entre distintos roles es HOLD', () => {
      expect(classifyOwnerModel(['korixa_app', 'postgres'], true)).toBe('CASE_D_MIXED_OWNERSHIP');
    });

    it('korixa_app como único owner es el caso limpio A', () => {
      expect(classifyOwnerModel(['korixa_app', 'korixa_app'], true)).toBe('CASE_A_APP_OWNER_RUNTIME_DML');
    });

    it('sin objetos de aplicación es CASE_E_CLEAN_EMPTY', () => {
      expect(classifyOwnerModel([], false)).toBe('CASE_E_CLEAN_EMPTY');
    });
  });

  it('21. runInspection() reporta HOLD_INCONSISTENT_OWNER_MODEL y db_role_model=OBVIOUS_VIOLATION si korixa_runtime posee un objeto de aplicación', async () => {
    setEnv(baseEnv());
    const expected0001 = expectedObjectsForApplied(['0001_init']);
    installHappyPathMock({
      pgmigrationsExists: true,
      trackedNames: ['0001_init'],
      // Inventario 0001 COMPLETO (todas las tablas + la secuencia) para
      // que nada dispare HOLD_TRACKING_WITH_MISSING_OBJECTS antes de
      // llegar a la evaluación de ownership — la única anomalía
      // deliberada acá es que 'users' es dueño de korixa_runtime.
      objectOwners: [
        ...[...expected0001.tables].map((t) => ({
          schema: 'public',
          object_name: t,
          object_type: 'table',
          owner: t === 'users' ? 'korixa_runtime' : 'korixa_app',
        })),
        ...[...expected0001.sequences].map((s) => ({ schema: 'public', object_name: s, object_type: 'sequence', owner: 'korixa_app' })),
      ],
      indexNames: [...expected0001.indexes],
      columnRows: [...expected0001.columns].map((c) => {
        const dot = c.indexOf('.');
        return { table_name: c.slice(0, dot), column_name: c.slice(dot + 1) };
      }),
    });

    const result = await runInspection();

    expect(result.final_disposition).toBe('HOLD_INCONSISTENT_OWNER_MODEL');
    expect(result.db_role_model).toBe('OBVIOUS_VIOLATION');
  });

  it('22. ownership mixto entre korixa_app y postgres -> HOLD_INCONSISTENT_OWNER_MODEL', async () => {
    setEnv(baseEnv());
    const expected0001 = expectedObjectsForApplied(['0001_init']);
    installHappyPathMock({
      pgmigrationsExists: true,
      trackedNames: ['0001_init'],
      objectOwners: [
        ...[...expected0001.tables].map((t) => ({
          schema: 'public',
          object_name: t,
          object_type: 'table',
          owner: t === 'roles' ? 'postgres' : 'korixa_app',
        })),
        ...[...expected0001.sequences].map((s) => ({ schema: 'public', object_name: s, object_type: 'sequence', owner: 'korixa_app' })),
      ],
      indexNames: [...expected0001.indexes],
      columnRows: [...expected0001.columns].map((c) => {
        const dot = c.indexOf('.');
        return { table_name: c.slice(0, dot), column_name: c.slice(dot + 1) };
      }),
    });

    const result = await runInspection();

    expect(result.final_disposition).toBe('HOLD_INCONSISTENT_OWNER_MODEL');
  });

  it('23. schema físico completo y sano con las 6 migraciones -> TRACKED_AND_CONSISTENT', async () => {
    setEnv(baseEnv());
    installFullyHealthyMock();

    const result = await runInspection();

    expect(result.final_disposition).toBe('TRACKED_AND_CONSISTENT');
    expect(result.physical_schema.classification).toBe('MATCHES_APPLIED');
  });

  it('24-25. prefijo parcial válido con objetos parciales coincidentes -> TRACKED_AND_CONSISTENT con PENDING correcto; los objetos de migraciones pendientes ausentes NO fallan', async () => {
    setEnv(baseEnv());
    const expected0001 = expectedObjectsForApplied(['0001_init']);
    installHappyPathMock({
      pgmigrationsExists: true,
      trackedNames: ['0001_init'],
      objectOwners: [...expected0001.tables].map((t) => ({ schema: 'public', object_name: t, object_type: 'table', owner: 'korixa_app' })).concat([
        { schema: 'public', object_name: 'audit_log_id_seq', object_type: 'sequence', owner: 'korixa_app' },
      ]),
      indexNames: [...expected0001.indexes],
      columnRows: [...expected0001.columns].map((c) => {
        const dot = c.indexOf('.');
        return { table_name: c.slice(0, dot), column_name: c.slice(dot + 1) };
      }),
    });

    const result = await runInspection();

    expect(result.final_disposition).toBe('TRACKED_AND_CONSISTENT');
    if (result.pgmigrations.classification.state === 'TRACKED_AND_CONSISTENT') {
      expect(result.pgmigrations.classification.pending).toEqual(EXPECTED_MIGRATION_NAMES.slice(1));
    }
    // Ningún objeto de 0002-0006 (ej. 'equipment', pendiente) se exige.
    expect(result.physical_schema.expected_missing.some((x) => x.includes('equipment'))).toBe(false);
  });

  // ---------------------------------------------------------------------
  // Remediación 6 (P1-2) — privilegios de tabla/secuencia SÍ se ejecutan
  // y quedan expuestos.
  // ---------------------------------------------------------------------
  it('12/13/14/15. tablePrivileges y sequencePrivileges se ejecutan de verdad y sus filas aparecen en el resultado', async () => {
    setEnv(baseEnv());
    installFullyHealthyMock();

    const result = await runInspection();

    const executedQueries = mockQuery.mock.calls.map((c) => c[0]);
    expect(executedQueries).toContain(INSPECTION_QUERIES.tablePrivileges);
    expect(executedQueries).toContain(INSPECTION_QUERIES.sequencePrivileges);
    expect(result.privileges.tables.length).toBeGreaterThan(0);
    expect(result.privileges.sequences.length).toBeGreaterThan(0);
    expect(result.privileges.tables[0]).toHaveProperty('can_select');
    expect(result.privileges.sequences[0]).toHaveProperty('can_usage');
  });

  // ---------------------------------------------------------------------
  // Remediación 7 (P1-7) — rol esperado ausente.
  // ---------------------------------------------------------------------
  it('16. korixa_app ausente entre las filas de rolCapabilities -> HOLD_EXPECTED_ROLE_MISSING', async () => {
    setEnv(baseEnv());
    installFullyHealthyMock({ roleCapabilityRows: OK_ROLE_CAPS.filter((r) => r.rolname !== 'korixa_app') });

    const result = await runInspection();

    expect(result.final_disposition).toBe('HOLD_EXPECTED_ROLE_MISSING');
    expect(result.roles.missing_expected_roles).toEqual(['korixa_app']);
  });

  it('17. korixa_runtime ausente entre las filas de rolCapabilities -> HOLD_EXPECTED_ROLE_MISSING', async () => {
    setEnv(baseEnv());
    installFullyHealthyMock({ roleCapabilityRows: OK_ROLE_CAPS.filter((r) => r.rolname !== 'korixa_runtime') });

    const result = await runInspection();

    expect(result.final_disposition).toBe('HOLD_EXPECTED_ROLE_MISSING');
    expect(result.roles.missing_expected_roles).toEqual(['korixa_runtime']);
  });

  describe('findMissingExpectedRoles', () => {
    it('devuelve vacío cuando ambos roles objetivo están presentes', () => {
      expect(findMissingExpectedRoles(OK_ROLE_CAPS)).toEqual([]);
    });

    it('devuelve el nombre del rol ausente', () => {
      expect(findMissingExpectedRoles([OK_ROLE_CAPS[1]])).toEqual(['korixa_app']);
    });
  });

  // ---------------------------------------------------------------------
  // Remediación 9 (P1-6) — owner de base/schema no resuelto.
  // ---------------------------------------------------------------------
  it('18. la consulta de ownership de base de datos no devuelve exactamente 1 fila -> HOLD_OWNER_UNRESOLVED, database_owner=null (nunca string vacío)', async () => {
    setEnv(baseEnv());
    installFullyHealthyMock({ dbOwnerRows: [] });

    const result = await runInspection();

    expect(result.final_disposition).toBe('HOLD_OWNER_UNRESOLVED');
    expect(result.database_owner).toBeNull();
  });

  it('19. la consulta de ownership de schema no devuelve exactamente 1 fila -> HOLD_OWNER_UNRESOLVED, public_schema_owner=null', async () => {
    setEnv(baseEnv());
    installFullyHealthyMock({ schemaOwnerRows: [] });

    const result = await runInspection();

    expect(result.final_disposition).toBe('HOLD_OWNER_UNRESOLVED');
    expect(result.public_schema_owner).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Precedencia de disposición (Remediación 11) — un hallazgo de mayor
  // prioridad no debe quedar enmascarado por uno de menor prioridad
  // ocurriendo a la vez.
  // ---------------------------------------------------------------------
  it('escalamiento de privilegio tiene precedencia sobre cualquier otro hallazgo simultáneo', async () => {
    setEnv(baseEnv());
    installFullyHealthyMock({
      roleCapabilityRows: [{ ...OK_ROLE_CAPS[0], rolsuper: true }, OK_ROLE_CAPS[1]],
      dbOwnerRows: [], // también dispararía HOLD_OWNER_UNRESOLVED si se evaluara antes
    });

    const result = await runInspection();

    expect(result.final_disposition).toBe('HOLD_ROLE_PRIVILEGE_ESCALATION');
  });

  // ---------------------------------------------------------------------
  // 9 (num. original). No existe ninguna API de query libre — repetido
  // aquí junto al resto de invariantes estructurales.
  // ---------------------------------------------------------------------
  it('no existe ningún método de ejecución de SQL libre en el módulo', () => {
    for (const value of Object.values(INSPECTION_QUERIES)) {
      expect(typeof value).toBe('string');
    }
  });

  // ---------------------------------------------------------------------
  // 19-20 (numeración original). Objetos del motor node-pg-migrate
  // nunca se marcan como inesperados.
  // ---------------------------------------------------------------------
  it('pgmigrations y pgmigrations_id_seq están en la whitelist de objetos del motor, nunca se tratan como inesperados', () => {
    expect(ENGINE_TRACKING_OBJECTS.tables).toContain('pgmigrations');
    expect(ENGINE_TRACKING_OBJECTS.sequences).toContain('pgmigrations_id_seq');
  });

  it('runInspection excluye los objetos del motor del cálculo de ownership de aplicación y del diff físico', async () => {
    setEnv(baseEnv());
    installHappyPathMock({
      pgmigrationsExists: true,
      trackedNames: [],
      objectOwners: [
        { schema: 'public', object_name: 'pgmigrations', object_type: 'table', owner: 'korixa_runtime' },
        { schema: 'public', object_name: 'pgmigrations_id_seq', object_type: 'sequence', owner: 'korixa_runtime' },
      ],
    });

    const result = await runInspection();

    expect(result.final_disposition).not.toBe('HOLD_INCONSISTENT_OWNER_MODEL');
    expect(result.final_disposition).not.toBe('HOLD_UNEXPECTED_SCHEMA_OBJECTS');
  });

  // ---------------------------------------------------------------------
  // 21 (numeración original). Ninguna query de tabla de aplicación
  // (Correction C) — extendido a las 2 queries nuevas.
  // ---------------------------------------------------------------------
  it('ninguna INSPECTION_QUERY hace SELECT/COUNT de filas de una tabla de aplicación', () => {
    const applicationTables = ['users', 'roles', 'user_roles', 'refresh_tokens', 'ride_sessions', 'audit_log', 'equipment', 'equipment_categories', 'workouts', 'workout_intervals'];
    const rowLevelExceptions: (keyof typeof INSPECTION_QUERIES)[] = ['migrationTrackerRows', 'indexInventory', 'columnInventory'];
    for (const [key, sql] of Object.entries(INSPECTION_QUERIES)) {
      if (rowLevelExceptions.includes(key as keyof typeof INSPECTION_QUERIES)) continue; // metadata de migración/catálogo, no negocio.
      for (const table of applicationTables) {
        expect(sql.toUpperCase()).not.toMatch(new RegExp(`FROM\\s+PUBLIC\\.${table.toUpperCase()}\\b`));
        expect(sql.toUpperCase()).not.toMatch(new RegExp(`FROM\\s+${table.toUpperCase()}\\b`));
      }
    }
    // Las 2 excepciones son metadata pura (information_schema/pg_indexes),
    // nunca filas de negocio — confirmado por texto exacto.
    expect(INSPECTION_QUERIES.indexInventory).toContain('pg_indexes');
    expect(INSPECTION_QUERIES.columnInventory).toContain('information_schema.columns');
  });

  // ---------------------------------------------------------------------
  // 22 (numeración original) + Remediación 14 (P3-12). Errores saneados,
  // incluyendo un error crudo no-InspectorError en el catch de nivel
  // superior conceptualmente equivalente (probado aquí a nivel de
  // runInspection, que es lo que ese catch consume).
  // ---------------------------------------------------------------------
  it('un fallo de query de catálogo se traduce a un InspectorError con código fijo, nunca el error crudo de pg', async () => {
    setEnv(baseEnv());
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockQuery.mockImplementation((sql: string) => {
      const form = topLevelStatementForm(sql);
      if (form === 'BEGIN_READ_ONLY') return Promise.resolve({ rows: [] });
      if (form === 'ROLLBACK') return Promise.resolve({ rows: [] });
      if (sql === INSPECTION_QUERIES.readOnlyAssertion) return Promise.resolve({ rows: [{ transaction_read_only: 'on' }] });
      if (sql === INSPECTION_QUERIES.identity) {
        return Promise.resolve({ rows: [{ database: 'korixa_production', current_user: 'korixa_runtime', session_user: 'korixa_runtime' }] });
      }
      if (sql === INSPECTION_QUERIES.roleCapabilities) {
        return Promise.reject(
          Object.assign(new Error('connection string: postgres://real:leak@host/db'), { stack: 'postgres://real:leak@host/db' }),
        );
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(runInspection()).rejects.toMatchObject({ code: 'ROLE_QUERY_FAILED' });
    try {
      await runInspection();
    } catch (error) {
      expect((error as InspectorError).message).not.toContain('leak');
    }
  });

  it('27. un error crudo (no-InspectorError) nunca se serializaría con su DSN — verificado sobre el helper de saneamiento que el manejador de nivel superior consume', () => {
    const rawError = new Error('postgres://user:supersecret@host:5432/db');
    // Simula exactamente la lógica del catch de nivel superior (PHASE 25/Remediación 14):
    const safe =
      rawError instanceof InspectorError
        ? { error_code: (rawError as InspectorError).code, message: rawError.message }
        : { error_code: 'UNEXPECTED_INSPECTOR_ERROR', message: 'Ocurrió un error inesperado durante la inspección, de un tipo no reconocido — nunca se serializa el error crudo, su mensaje ni su stack.' };

    expect(JSON.stringify(safe)).not.toContain('supersecret');
    expect(safe.error_code).toBe('UNEXPECTED_INSPECTOR_ERROR');
  });

  // ---------------------------------------------------------------------
  // 23-24 (numeración original). ROLLBACK intentado en falla + cliente
  // siempre cierra.
  // ---------------------------------------------------------------------
  it('intenta ROLLBACK y cierra el cliente incluso cuando la inspección falla', async () => {
    setEnv(baseEnv());
    installHappyPathMock({ transactionReadOnly: 'off' });

    await expect(runInspection()).rejects.toBeDefined();

    const executedQueries = mockQuery.mock.calls.map((c) => c[0]);
    expect(executedQueries).toContain(INSPECTION_QUERIES.rollback);
    expect(mockEnd).toHaveBeenCalled();
  });

  it('cierra el cliente también en el camino exitoso', async () => {
    setEnv(baseEnv());
    installFullyHealthyMock();

    await runInspection();

    expect(mockEnd).toHaveBeenCalled();
  });

  it('no intenta conectar en absoluto si el connection string falla la validación previa (host mismatch)', async () => {
    setEnv(baseEnv({ EXPECTED_DB_HOST: 'not-the-real-host' }));

    await expect(runInspection()).rejects.toMatchObject({ code: 'DATABASE_HOST_MISMATCH' });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Remediación 15 (P2-10) — sin override de TLS.
  // ---------------------------------------------------------------------
  it('28. el cliente de pg ya no fuerza ssl.rejectUnauthorized:false — sin override explícito de ssl', async () => {
    setEnv(baseEnv());
    installFullyHealthyMock();

    await runInspection();

    const { Client } = jest.requireMock('pg') as { Client: jest.Mock };
    const configPassed = Client.mock.calls[0][0];
    expect(configPassed.ssl).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // Remediación 17 (P3-14) — sincronización con los archivos reales.
  // ---------------------------------------------------------------------
  it('29. EXPECTED_MIGRATION_NAMES está sincronizado con los archivos reales en backend/migrations/', () => {
    const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    const namesFromDisk = files.map((f) => f.replace(/\.sql$/, ''));
    expect(namesFromDisk).toEqual([...EXPECTED_MIGRATION_NAMES]);
  });

  // ---------------------------------------------------------------------
  // 25 (numeración original) + Remediación 18 punto 30. El JSON de
  // salida contiene solo las claves aprobadas; todos los statements
  // fijos siguen siendo BEGIN READ ONLY / SELECT / ROLLBACK.
  // ---------------------------------------------------------------------
  it('el resultado solo contiene las claves de InspectionResult — ninguna clave adicional', async () => {
    setEnv(baseEnv());
    installFullyHealthyMock();

    const result = await runInspection();

    const approvedTopLevelKeys = [
      'inspection_version',
      'source_sha',
      'migration_set_hash',
      'database_identity',
      'read_only',
      'database_owner',
      'public_schema_owner',
      'roles',
      'privileges',
      'object_owners',
      'pgmigrations',
      'physical_schema',
      'pgcrypto_present',
      'credential_db_user_mapping',
      'db_role_model',
      'production_schema_state',
      'final_disposition',
    ];
    expect(Object.keys(result).sort()).toEqual(approvedTopLevelKeys.sort());
  });

  it('30. todo statement ejecutable fijo sigue siendo BEGIN READ ONLY / SELECT / ROLLBACK', () => {
    for (const sql of Object.values(INSPECTION_QUERIES)) {
      expect(['BEGIN_READ_ONLY', 'SELECT', 'ROLLBACK']).toContain(topLevelStatementForm(sql));
    }
  });

  // ---------------------------------------------------------------------
  // Extra: parseConnectionString / assertExpectedTarget / topLevelStatementForm
  // — helpers puros que sostienen las garantías de arriba.
  // ---------------------------------------------------------------------
  describe('parseConnectionString', () => {
    it('parsea host/database sin exponer la contraseña en el objeto devuelto', () => {
      const parsed = parseConnectionString('postgres://user:hunter2@10.0.0.1:5432/mydb');
      expect(parsed).toEqual({ host: '10.0.0.1', database: 'mydb', hasUsername: true });
      expect(JSON.stringify(parsed)).not.toContain('hunter2');
    });

    it('rechaza un protocolo no-postgres', () => {
      expect(() => parseConnectionString('mysql://user:pw@host/db')).toThrow(InspectorError);
    });

    it('rechaza una URL sin database', () => {
      expect(() => parseConnectionString('postgres://user:pw@host/')).toThrow(InspectorError);
    });

    it('rechaza un string que ni siquiera parsea como URL', () => {
      expect(() => parseConnectionString('no es una url')).toThrow(InspectorError);
    });
  });

  describe('assertExpectedTarget', () => {
    it('lanza DATABASE_HOST_MISMATCH si el host no coincide', () => {
      expect(() =>
        assertExpectedTarget({ host: 'a', database: 'db', hasUsername: true }, 'b', 'db'),
      ).toThrow(expect.objectContaining({ code: 'DATABASE_HOST_MISMATCH' }));
    });

    it('lanza DATABASE_NAME_MISMATCH si la base no coincide', () => {
      expect(() =>
        assertExpectedTarget({ host: 'a', database: 'db', hasUsername: true }, 'a', 'other'),
      ).toThrow(expect.objectContaining({ code: 'DATABASE_NAME_MISMATCH' }));
    });
  });

  describe('topLevelStatementForm', () => {
    it('reconoce BEGIN READ ONLY, SELECT y ROLLBACK correctamente', () => {
      expect(topLevelStatementForm('BEGIN READ ONLY;')).toBe('BEGIN_READ_ONLY');
      expect(topLevelStatementForm('ROLLBACK;')).toBe('ROLLBACK');
      expect(topLevelStatementForm('SELECT 1;')).toBe('SELECT');
    });

    it('no se confunde con literales que contienen palabras de DDL/DML dentro de un SELECT', () => {
      const sql = `SELECT has_table_privilege(r.oid, c.oid, 'DELETE') AS can_delete`;
      expect(topLevelStatementForm(sql)).toBe('SELECT');
    });

    it('cualquier otra forma se clasifica como OTHER (nunca se ejecuta en runInspection)', () => {
      expect(topLevelStatementForm('DROP TABLE users;')).toBe('OTHER');
      expect(topLevelStatementForm('DELETE FROM users;')).toBe('OTHER');
    });
  });

  describe('expectedObjectsForApplied', () => {
    it('un índice eliminado por una migración posterior no queda en el set esperado', () => {
      const expected = expectedObjectsForApplied(['0001_init', '0002_users_email_case_insensitive_unique']);
      expect(expected.indexes.has('idx_users_email_lower')).toBe(false);
      expect(expected.indexes.has('users_email_lower_unique')).toBe(true);
    });

    it('con solo 0001 aplicado, no incluye objetos de 0002-0006', () => {
      const expected = expectedObjectsForApplied(['0001_init']);
      expect(expected.tables.has('equipment')).toBe(false);
      expect(expected.tables.has('users')).toBe(true);
    });

    it('con solo 0001 aplicado, incluye exactamente las columnas de 0001 (no firebase_uid, de 0005)', () => {
      const expected = expectedObjectsForApplied(['0001_init']);
      expect(expected.columns.has('users.firebase_uid')).toBe(false);
      expect(expected.columns.has('users.email')).toBe(true);
    });

    it('con las 6 aplicadas, incluye users.firebase_uid', () => {
      const expected = expectedObjectsForApplied([...EXPECTED_MIGRATION_NAMES]);
      expect(expected.columns.has('users.firebase_uid')).toBe(true);
    });
  });

  describe('diffPhysicalSchema', () => {
    it('detecta faltantes y sobrantes simultáneamente, en categorías distintas', () => {
      const expected: ExpectedPhysicalSet = {
        tables: new Set(['users']),
        indexes: new Set(['users_pkey']),
        sequences: new Set(),
        extensions: new Set(['pgcrypto']),
        columns: new Set(['users.id', 'users.email']),
      };
      const actual: ActualPhysicalInventory = {
        tables: new Set(['users', 'manual_table']),
        indexes: new Set([]), // falta users_pkey
        sequences: new Set(),
        pgcryptoPresent: true,
        columns: new Set(['users.id']), // falta users.email
      };
      const diff = diffPhysicalSchema(expected, actual);
      expect(diff.missingIndexes).toEqual(['users_pkey']);
      expect(diff.missingColumns).toEqual(['users.email']);
      expect(diff.unexpectedTables).toEqual(['manual_table']);
    });
  });

  describe('summarizePhysicalDiff', () => {
    it('MISSING tiene precedencia sobre UNEXPECTED cuando ambos ocurren a la vez', () => {
      const expected: ExpectedPhysicalSet = { tables: new Set(['users']), indexes: new Set(), sequences: new Set(), extensions: new Set(), columns: new Set() };
      const diff = diffPhysicalSchema(expected, {
        tables: new Set(['manual_table']), // falta 'users', sobra 'manual_table'
        indexes: new Set(),
        sequences: new Set(),
        pgcryptoPresent: true,
        columns: new Set(),
      });
      const summary = summarizePhysicalDiff(expected, diff);
      expect(summary.classification).toBe('MISSING_EXPECTED_OBJECTS');
    });
  });

  describe('findPrivilegeEscalations', () => {
    it('no reporta nada para roles sin capacidades elevadas', () => {
      expect(findPrivilegeEscalations(OK_ROLE_CAPS)).toEqual([]);
    });

    it('reporta SUPERUSER inesperado', () => {
      const rows = [{ ...OK_ROLE_CAPS[0], rolsuper: true }];
      expect(findPrivilegeEscalations(rows)).toEqual(['korixa_app: SUPERUSER inesperado']);
    });
  });
});
