// Siembra un usuario QA + datos de ejemplo (perfil, sesiones de
// entrenamiento) contra el Firebase Local Emulator Suite.
//
// SOLO funciona contra el emulador: apunta a
// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST (localhost) y usa
// el project ID local `demo-ridepro-security-tests` (ver `.firebaserc`),
// reservado por Firebase para uso 100% offline. Nunca toca el proyecto
// real `ridepro-dbafe`.
//
// Dos SDKs a propósito, no por descuido:
//   - `firebase-admin` SOLO para crear el usuario de Auth con
//     `emailVerified: true` (evita que la app fuerce la pantalla de
//     verificación de correo) — eso el SDK cliente no puede hacerlo sin
//     pasar por el flujo real de verificación.
//   - `firebase` (SDK cliente, el mismo que usa la app Flutter Web) para
//     TODAS las escrituras de Firestore. Confirmado empíricamente: el
//     Firestore Emulator persiste campos numéricos escritos por
//     `firebase-admin` en un formato que el SDK cliente Web no
//     deserializa (`ftp`/`weightKg` volvían `null` al leerlos desde la
//     app, pese a estar correctos en el wire format vía REST) — es una
//     incompatibilidad Admin↔Client SDK contra el emulador, no un bug de
//     la app (un ciclo escribir→leer 100% vía el SDK cliente, igual que
//     hace la propia app, funciona perfecto). Escribir con el SDK
//     cliente autenticado como el propio usuario evita el problema por
//     completo y además ejercita las Security Rules reales
//     (`firestore.rules`), igual que un login real.
//
// Uso: con los emuladores ya arriba (`firebase emulators:start --only
// auth,firestore`), correr `npm run seed` en este directorio.

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const admin = require('firebase-admin');
const {
  initializeApp,
} = require('firebase/app');
const {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
} = require('firebase/auth');
const {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  collection,
  getDocs,
  writeBatch,
  Timestamp,
} = require('firebase/firestore');

// DEBE coincidir con el `projectId` compilado en `lib/firebase_options.dart`
// (`ridepro-dbafe`) — el emulador aísla los datos por project ID como
// namespaces independientes dentro del mismo proceso local. Usar un
// project ID distinto (p. ej. el alias `demo-ridepro-security-tests` de
// `.firebaserc`, reservado para `firebase/rules-tests/`) sembraría datos
// en un namespace que la app nunca consulta — el emulador seguiría
// siendo 100% local en cualquier caso (nunca contacta el proyecto real),
// pero la app vería todo vacío. Confirmado empíricamente: con el project
// ID equivocado, hasta una `.get()` sin filtros sobre la colección
// sembrada volvía 0 documentos desde Dart.
const PROJECT_ID = 'ridepro-dbafe';

admin.initializeApp({ projectId: PROJECT_ID });

const QA_EMAIL = 'qa.emulator@ridepro.local';
// No es un secreto real: esta cuenta solo existe dentro del Auth
// Emulator (localhost:9099) de una máquina de desarrollo — nunca es
// válida contra un proyecto Firebase real. Mismo criterio ya aplicado a
// `DevBackendTestUser` (lib/core/config/dev_backend_test_user.dart).
const QA_PASSWORD = 'QaEmulator#2026';
const QA_DISPLAY_NAME = 'QA Emulator';

function daysAgo(n, hour = 7) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const RIDE_SESSIONS = [
  { daysAgo: 1, durationMin: 45, distanceKm: 22.5, kcal: 610, power: 210, cadence: 88, hr: 148, devices: 2 },
  { daysAgo: 3, durationMin: 60, distanceKm: 31.2, kcal: 780, power: 195, cadence: 84, hr: 142, devices: 2 },
  { daysAgo: 5, durationMin: 30, distanceKm: 14.8, kcal: 390, power: 225, cadence: 91, hr: 155, devices: 1 },
  { daysAgo: 8, durationMin: 75, distanceKm: 38.6, kcal: 960, power: 180, cadence: 80, hr: 138, devices: 2 },
  { daysAgo: 12, durationMin: 50, distanceKm: 25.1, kcal: 670, power: 205, cadence: 86, hr: 146, devices: 1 },
];

async function ensureAuthUser() {
  const auth = admin.auth();
  try {
    const existing = await auth.getUserByEmail(QA_EMAIL);
    console.log(`Usuario ya existe en el emulador: ${existing.uid}`);
    return existing.uid;
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    const created = await auth.createUser({
      email: QA_EMAIL,
      password: QA_PASSWORD,
      displayName: QA_DISPLAY_NAME,
      emailVerified: true,
    });
    console.log(`Usuario creado en el emulador: ${created.uid}`);
    return created.uid;
  }
}

async function main() {
  const uid = await ensureAuthUser();

  // A partir de acá, todo pasa por el SDK cliente autenticado como el
  // propio usuario — mismo camino que recorre la app real.
  const clientApp = initializeApp({ projectId: PROJECT_ID, apiKey: 'fake-api-key' }, 'seed-client');
  const clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, 'http://localhost:9099', { disableWarnings: true });
  const db = getFirestore(clientApp);
  connectFirestoreEmulator(db, 'localhost', 8080);

  await signInWithEmailAndPassword(clientAuth, QA_EMAIL, QA_PASSWORD);
  console.log('Autenticado como QA en el SDK cliente.');

  const userDocRef = doc(db, 'users', uid);
  await setDoc(
    userDocRef,
    {
      email: QA_EMAIL,
      displayName: QA_DISPLAY_NAME,
      photoUrl: null,
      ftp: 245,
      weightKg: 72.5,
      premium: false,
    },
    { merge: true },
  );
  console.log(`Documento users/${uid} sembrado (vía SDK cliente).`);

  const sessionsCollection = collection(db, 'users', uid, 'ride_sessions');
  const existing = await getDocs(sessionsCollection);
  if (!existing.empty) {
    console.log('Ya hay ride_sessions sembradas — no se duplican.');
  } else {
    const batch = writeBatch(db);
    for (const s of RIDE_SESSIONS) {
      const start = daysAgo(s.daysAgo);
      const end = new Date(start.getTime() + s.durationMin * 60 * 1000);
      const ref = doc(sessionsCollection);
      batch.set(ref, {
        startTime: Timestamp.fromDate(start),
        endTime: Timestamp.fromDate(end),
        distanceMeters: s.distanceKm * 1000,
        caloriesKcal: s.kcal,
        lastPowerWatts: s.power,
        lastCadenceRpm: s.cadence,
        lastHeartRateBpm: s.hr,
        deviceCount: s.devices,
      });
    }
    await batch.commit();
    console.log(`${RIDE_SESSIONS.length} ride_sessions sembradas.`);
  }

  console.log('\nSeed completo.');
  console.log(`  Email:    ${QA_EMAIL}`);
  console.log(`  Password: ${QA_PASSWORD}`);
  console.log(`  UID:      ${uid}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed falló:', err);
  process.exit(1);
});
