/**
 * Tests de seguridad de las reglas de Firestore (`firestore.rules`).
 *
 * Ejecutar SIEMPRE contra el emulador (`npm test`, que levanta el
 * emulador vía `firebase emulators:exec`) — NUNCA apuntar
 * accidentalmente al proyecto de Firebase real, por eso el
 * `projectId` usado aquí es un nombre obviamente falso
 * (`demo-ridepro-security-tests`) y no el proyecto de producción.
 *
 * ⚠️ Estos tests NO se han podido ejecutar en el entorno donde se
 * escribió este archivo (sin acceso a red / Firebase CLI). Antes de
 * dar por cerrada la tarea A3 del roadmap, alguien con el entorno
 * real debe correr `npm install && npm test` desde
 * `firebase/rules-tests/` y confirmar que TODOS pasan — ver
 * `docs/SECURITY_AUDIT.md` sección "Cómo verificar".
 */

const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, updateDoc, getDoc, deleteDoc } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-ridepro-security-tests',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** Siembra un documento de usuario saltándose las reglas (como lo haría
 * Firebase Admin SDK) — se usa para preparar el estado "ya existe un
 * usuario" antes de probar ataques de UPDATE, que son distintos de los
 * ataques de CREATE. */
async function seedUser(uid, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${uid}`), {
      email: `${uid}@ridepro.com`,
      displayName: uid,
      role: 'user',
      premium: false,
      ...data,
    });
  });
}

// ===========================================================================
// 1. ATAQUE: crear un usuario con role="admin"
// ===========================================================================
describe('Ataque 1 — creación de cuenta con rol elevado', () => {
  test('NO se puede crear el documento propio con role="admin"', async () => {
    const attacker = testEnv.authenticatedContext('attacker-uid');
    const db = attacker.firestore();

    await assertFails(
      setDoc(doc(db, 'users/attacker-uid'), {
        email: 'attacker@ridepro.com',
        displayName: 'Attacker',
        role: 'admin',
      }),
    );
  });

  test('NO se puede crear el documento propio con role="coach"', async () => {
    const attacker = testEnv.authenticatedContext('attacker-uid');
    const db = attacker.firestore();

    await assertFails(
      setDoc(doc(db, 'users/attacker-uid'), {
        email: 'attacker@ridepro.com',
        displayName: 'Attacker',
        role: 'coach',
      }),
    );
  });

  test('SÍ se puede crear el documento propio con role="user" (el único valor seguro)', async () => {
    const legit = testEnv.authenticatedContext('legit-uid');
    const db = legit.firestore();

    await assertSucceeds(
      setDoc(doc(db, 'users/legit-uid'), {
        email: 'legit@ridepro.com',
        displayName: 'Legit',
        role: 'user',
      }),
    );
  });

  test('SÍ se puede crear el documento propio SIN incluir el campo role en absoluto', async () => {
    const legit = testEnv.authenticatedContext('legit-uid-2');
    const db = legit.firestore();

    await assertSucceeds(
      setDoc(doc(db, 'users/legit-uid-2'), {
        email: 'legit2@ridepro.com',
        displayName: 'Legit Two',
      }),
    );
  });
});

// ===========================================================================
// 2. ATAQUE: modificar role después de creado
// ===========================================================================
describe('Ataque 2 — escalada de privilegios tras la creación', () => {
  test('NO se puede cambiar el propio role de "user" a "admin" con update', async () => {
    await seedUser('alice');
    const alice = testEnv.authenticatedContext('alice');
    const db = alice.firestore();

    await assertFails(updateDoc(doc(db, 'users/alice'), { role: 'admin' }));
  });

  test('NO se puede cambiar el propio role ni siquiera a otro valor "menor" como "premium"', async () => {
    await seedUser('alice');
    const alice = testEnv.authenticatedContext('alice');
    const db = alice.firestore();

    await assertFails(updateDoc(doc(db, 'users/alice'), { role: 'premium' }));
  });

  test('NO se puede colar un cambio de role junto a un cambio legítimo en el mismo update', async () => {
    await seedUser('alice');
    const alice = testEnv.authenticatedContext('alice');
    const db = alice.firestore();

    await assertFails(
      updateDoc(doc(db, 'users/alice'), { displayName: 'Alice Renamed', role: 'admin' }),
    );
  });
});

// ===========================================================================
// 3. ATAQUE: cambiar otros campos protegidos
// ===========================================================================
describe('Ataque 3 — otros campos protegidos', () => {
  const protectedFieldAttempts = [
    { field: 'permissions', value: ['manage_users', 'delete_content'] },
    { field: 'subscription', value: { plan: 'enterprise', expiresAt: '2099-01-01' } },
    { field: 'isAdmin', value: true },
    { field: 'customClaims', value: { admin: true } },
    { field: 'premium', value: true },
  ];

  test.each(protectedFieldAttempts)(
    'NO se puede establecer "$field" en CREATE',
    async ({ field, value }) => {
      const attacker = testEnv.authenticatedContext('attacker-2');
      const db = attacker.firestore();

      await assertFails(
        setDoc(doc(db, 'users/attacker-2'), {
          email: 'attacker2@ridepro.com',
          displayName: 'Attacker Two',
          [field]: value,
        }),
      );
    },
  );

  test.each(protectedFieldAttempts)(
    'NO se puede modificar "$field" en UPDATE tras la creación',
    async ({ field, value }) => {
      await seedUser('bob');
      const bob = testEnv.authenticatedContext('bob');
      const db = bob.firestore();

      await assertFails(updateDoc(doc(db, 'users/bob'), { [field]: value }));
    },
  );
});

// ===========================================================================
// 4. ATAQUE: acceder a documentos de otros usuarios
// ===========================================================================
describe('Ataque 4 — acceso cruzado entre usuarios', () => {
  test('NO se puede leer el documento de otro usuario', async () => {
    await seedUser('victim');
    const attacker = testEnv.authenticatedContext('attacker-3');
    const db = attacker.firestore();

    await assertFails(getDoc(doc(db, 'users/victim')));
  });

  test('NO se puede escribir/sobrescribir el documento de otro usuario', async () => {
    await seedUser('victim-2');
    const attacker = testEnv.authenticatedContext('attacker-4');
    const db = attacker.firestore();

    await assertFails(
      setDoc(doc(db, 'users/victim-2'), { email: 'hijacked@evil.com', displayName: 'Hijacked' }),
    );
  });

  test('NO se puede actualizar un campo (incluso uno "inofensivo") del documento de otro usuario', async () => {
    await seedUser('victim-3');
    const attacker = testEnv.authenticatedContext('attacker-5');
    const db = attacker.firestore();

    await assertFails(updateDoc(doc(db, 'users/victim-3'), { displayName: 'Renamed by attacker' }));
  });

  test('NO se puede leer el historial de sesiones de otro usuario', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/victim-4/ride_sessions/session-1'), {
        startTime: new Date(),
        endTime: new Date(),
        distanceMeters: 20000,
        caloriesKcal: 500,
      });
    });

    const attacker = testEnv.authenticatedContext('attacker-6');
    const db = attacker.firestore();

    await assertFails(getDoc(doc(db, 'users/victim-4/ride_sessions/session-1')));
  });

  test('un usuario NO autenticado no puede leer ni escribir ningún documento', async () => {
    const anon = testEnv.unauthenticatedContext();
    const db = anon.firestore();

    await assertFails(getDoc(doc(db, 'users/victim-4')));
    await assertFails(setDoc(doc(db, 'users/anon-attempt'), { email: 'x@x.com', displayName: 'X' }));
  });
});

// ===========================================================================
// Casos de control positivos — confirman que la corrección NO rompió el
// uso legítimo (una suite que solo prueba ataques podría "pasar" con una
// regla que deniega todo, lo cual rompería la app entera; estos tests lo
// descartan).
// ===========================================================================
describe('Casos de control — uso legítimo sigue funcionando', () => {
  test('un usuario puede leer su propio documento', async () => {
    await seedUser('carol');
    const carol = testEnv.authenticatedContext('carol');
    const db = carol.firestore();

    await assertSucceeds(getDoc(doc(db, 'users/carol')));
  });

  test('un usuario puede actualizar sus propios campos de perfil (displayName, ftp, weightKg)', async () => {
    await seedUser('carol-2');
    const carol = testEnv.authenticatedContext('carol-2');
    const db = carol.firestore();

    await assertSucceeds(
      updateDoc(doc(db, 'users/carol-2'), { displayName: 'Carol Updated', ftp: 250, weightKg: 65.5 }),
    );
  });

  test('un usuario puede crear una sesión de entrenamiento propia', async () => {
    const dave = testEnv.authenticatedContext('dave');
    const db = dave.firestore();

    await assertSucceeds(
      setDoc(doc(db, 'users/dave/ride_sessions/session-1'), {
        startTime: new Date(),
        endTime: new Date(),
        distanceMeters: 15000,
        caloriesKcal: 400,
      }),
    );
  });

  test('una sesión de entrenamiento ya creada NO se puede editar (append-only)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/dave-2/ride_sessions/session-1'), {
        startTime: new Date(),
        endTime: new Date(),
        distanceMeters: 15000,
        caloriesKcal: 400,
      });
    });

    const dave = testEnv.authenticatedContext('dave-2');
    const db = dave.firestore();

    await assertFails(updateDoc(doc(db, 'users/dave-2/ride_sessions/session-1'), { distanceMeters: 99999 }));
  });

  test('un usuario NO puede borrar su propio documento directamente (soft delete vía Cloud Function)', async () => {
    await seedUser('erin');
    const erin = testEnv.authenticatedContext('erin');
    const db = erin.firestore();

    await assertFails(deleteDoc(doc(db, 'users/erin')));
  });

  test('una colección no declarada explícitamente queda denegada por el catch-all', async () => {
    const frank = testEnv.authenticatedContext('frank');
    const db = frank.firestore();

    await assertFails(setDoc(doc(db, 'some_future_collection/doc-1'), { anything: true }));
  });
});
