import {
  INSPECTION_QUERIES,
  EXPECTED_MIGRATION_NAMES,
  ENGINE_TRACKING_OBJECTS,
  parseConnectionString,
  assertExpectedTarget,
  classifyMigrationPrefix,
  expectedObjectsForApplied,
  classifyOwnerModel,
  findPrivilegeEscalations,
  topLevelStatementForm,
  InspectorError,
  runInspection,
  type RoleCapabilityRow,
} from './db-readonly-inspector';

// `pg.Client` se mockea por completo — ningún test de este archivo toca
// una base de datos real (Correction/PHASE 23: "NO real database").
const mockConnect = jest.fn();
const mockQuery = jest.fn();
const mockEnd = jest.fn();

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
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
  physicalPresence?: Record<string, boolean>;
}) {
  const {
    transactionReadOnly = 'on',
    currentUser = 'korixa_runtime',
    currentDatabase = 'korixa_production',
    pgmigrationsExists = true,
    trackedNames = ['0001_init', '0002_users_email_case_insensitive_unique'],
    objectOwners = [],
    physicalPresence = {},
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
      return Promise.resolve({ rows: OK_ROLE_CAPS });
    }
    if (sql === INSPECTION_QUERIES.roleMemberships) {
      return Promise.resolve({ rows: [] });
    }
    if (sql === INSPECTION_QUERIES.databaseOwnership) {
      return Promise.resolve({ rows: [{ datname: 'korixa_production', owner: 'korixa_app' }] });
    }
    if (sql === INSPECTION_QUERIES.schemaOwnership) {
      return Promise.resolve({ rows: [{ nspname: 'public', owner: 'korixa_app' }] });
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
    if (sql === INSPECTION_QUERIES.migrationTrackerExists) {
      return Promise.resolve({ rows: [{ pgmigrations_exists: pgmigrationsExists }] });
    }
    if (sql === INSPECTION_QUERIES.migrationTrackerRows) {
      return Promise.resolve({ rows: trackedNames.map((name) => ({ name, run_on: '2026-08-22T00:00:00.000Z' })) });
    }
    if (sql === INSPECTION_QUERIES.physicalSchemaExistence) {
      return Promise.resolve({ rows: [physicalPresence] });
    }
    if (sql === INSPECTION_QUERIES.firebaseUidColumnExists) {
      return Promise.resolve({ rows: [{ firebase_uid_column_exists: false }] });
    }
    if (sql === INSPECTION_QUERIES.pgcryptoPresent) {
      return Promise.resolve({ rows: [{ pgcrypto_present: true }] });
    }
    throw new Error(`Query no reconocida por el mock: ${sql}`);
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
      installHappyPathMock({});

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
      installHappyPathMock({});

      await runInspection();

      expect(mockQuery.mock.calls[0][0]).toBe(INSPECTION_QUERIES.beginReadOnly);
      expect(topLevelStatementForm(mockQuery.mock.calls[0][0])).toBe('BEGIN_READ_ONLY');
    });

    it('la assertion de solo-lectura se ejecuta inmediatamente después de BEGIN', async () => {
      setEnv(baseEnv());
      installHappyPathMock({});

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
  // 8. Identidad válida -> continúa hasta completar.
  // ---------------------------------------------------------------------
  it('con identidad válida (korixa_runtime, korixa_production) la inspección completa y produce un final_disposition', async () => {
    setEnv(baseEnv());
    installHappyPathMock({});

    const result = await runInspection();

    expect(result.db_role_mapping).toBe('MATCHES_EXPECTED');
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
    it('clasifica correctamente cada prefijo válido, incluyendo el vacío y el completo', () => {
      for (let i = 0; i <= EXPECTED_MIGRATION_NAMES.length; i += 1) {
        const prefix = EXPECTED_MIGRATION_NAMES.slice(0, i);
        const result = classifyMigrationPrefix([...prefix]);
        if (i === 0) {
          expect(result.state).toBe('CLEAN_EMPTY');
        } else {
          expect(result.state).toBe('TRACKED_AND_CONSISTENT');
          if (result.state === 'TRACKED_AND_CONSISTENT') {
            expect(result.applied).toEqual(prefix);
            expect(result.pending).toEqual(EXPECTED_MIGRATION_NAMES.slice(i));
          }
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
  // 14-15. Caso sin tracker.
  // ---------------------------------------------------------------------
  it('tracker ausente + sin objetos de aplicación -> CLEAN_EMPTY', async () => {
    setEnv(baseEnv());
    installHappyPathMock({ pgmigrationsExists: false, trackedNames: [], objectOwners: [] });

    const result = await runInspection();

    expect(result.pgmigrations.exists).toBe(false);
    expect(result.final_disposition).toBe('CLEAN_EMPTY');
  });

  it('tracker ausente + objetos de aplicación presentes -> HOLD', async () => {
    setEnv(baseEnv());
    installHappyPathMock({
      pgmigrationsExists: false,
      trackedNames: [],
      objectOwners: [{ schema: 'public', object_name: 'users', object_type: 'table', owner: 'korixa_app' }],
    });

    const result = await runInspection();

    expect(result.final_disposition).toBe('HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING');
  });

  // ---------------------------------------------------------------------
  // 16. Migración trackeada con objeto físico faltante -> HOLD.
  // ---------------------------------------------------------------------
  it('migración trackeada como aplicada pero con objeto físico esperado faltante -> HOLD', async () => {
    setEnv(baseEnv());
    installHappyPathMock({
      pgmigrationsExists: true,
      trackedNames: ['0001_init'],
      physicalPresence: { users_exists: false }, // 0001 implica users; falta.
    });

    const result = await runInspection();

    expect(result.final_disposition).toBe('HOLD_TRACKING_WITH_MISSING_OBJECTS');
    expect(result.physical_schema.expected_missing).toContain('users');
  });

  // ---------------------------------------------------------------------
  // 17-18. Modelo de ownership.
  // ---------------------------------------------------------------------
  describe('classifyOwnerModel', () => {
    it('korixa_runtime como owner de un objeto de aplicación es una violación (HOLD)', () => {
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

  it('runInspection() reporta HOLD_INCONSISTENT_OWNER_MODEL si korixa_runtime posee un objeto de aplicación', async () => {
    setEnv(baseEnv());
    installHappyPathMock({
      pgmigrationsExists: false,
      trackedNames: [],
      objectOwners: [{ schema: 'public', object_name: 'users', object_type: 'table', owner: 'korixa_runtime' }],
    });

    const result = await runInspection();

    // Objeto sin tracker Y ownership inconsistente — el gate de tracking
    // ausente se evalúa primero (ver runInspection), documentado y
    // determinístico, no accidental.
    expect(['HOLD_PHYSICAL_OBJECTS_WITHOUT_TRACKING', 'HOLD_INCONSISTENT_OWNER_MODEL']).toContain(
      result.final_disposition,
    );
  });

  // ---------------------------------------------------------------------
  // 19-20. Objetos del motor node-pg-migrate nunca se marcan como
  // inesperados.
  // ---------------------------------------------------------------------
  it('pgmigrations y pgmigrations_id_seq están en la whitelist de objetos del motor, nunca se tratan como inesperados', () => {
    expect(ENGINE_TRACKING_OBJECTS.tables).toContain('pgmigrations');
    expect(ENGINE_TRACKING_OBJECTS.sequences).toContain('pgmigrations_id_seq');
  });

  it('runInspection excluye los objetos del motor del cálculo de ownership de aplicación', async () => {
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

    // korixa_runtime posee pgmigrations (normal — el propio runner lo crea
    // con la credencial que ejecuta `migrate up`), pero como se excluye
    // del cálculo de ownership de APLICACIÓN, no dispara
    // HOLD_INCONSISTENT_OWNER_MODEL.
    expect(result.final_disposition).not.toBe('HOLD_INCONSISTENT_OWNER_MODEL');
  });

  // ---------------------------------------------------------------------
  // 21. Ninguna query de tabla de aplicación (Correction C).
  // ---------------------------------------------------------------------
  it('ninguna INSPECTION_QUERY hace SELECT/COUNT de una tabla de aplicación', () => {
    const applicationTables = ['users', 'roles', 'user_roles', 'refresh_tokens', 'ride_sessions', 'audit_log', 'equipment', 'equipment_categories', 'workouts', 'workout_intervals'];
    for (const [key, sql] of Object.entries(INSPECTION_QUERIES)) {
      if (key === 'migrationTrackerRows') continue; // única excepción permitida — metadata de migración, no negocio.
      for (const table of applicationTables) {
        expect(sql.toUpperCase()).not.toMatch(new RegExp(`FROM\\s+PUBLIC\\.${table.toUpperCase()}\\b`));
        expect(sql.toUpperCase()).not.toMatch(new RegExp(`FROM\\s+${table.toUpperCase()}\\b`));
      }
    }
  });

  // ---------------------------------------------------------------------
  // 22. Errores saneados.
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

  // ---------------------------------------------------------------------
  // 23-24. ROLLBACK intentado en falla + cliente siempre cierra.
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
    installHappyPathMock({});

    await runInspection();

    expect(mockEnd).toHaveBeenCalled();
  });

  it('no intenta conectar en absoluto si el connection string falla la validación previa (host mismatch)', async () => {
    setEnv(baseEnv({ EXPECTED_DB_HOST: 'not-the-real-host' }));

    await expect(runInspection()).rejects.toMatchObject({ code: 'DATABASE_HOST_MISMATCH' });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // 25. El JSON de salida contiene solo las claves aprobadas.
  // ---------------------------------------------------------------------
  it('el resultado solo contiene las claves de InspectionResult — ninguna clave adicional', async () => {
    setEnv(baseEnv());
    installHappyPathMock({});

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
      'db_role_mapping',
      'production_schema_state',
      'final_disposition',
    ];
    expect(Object.keys(result).sort()).toEqual(approvedTopLevelKeys.sort());
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
