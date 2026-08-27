// Siembra un par de workouts de ejemplo para la cuenta QA contra el
// backend NestJS YA corriendo en local (`GET /v1/health`) — no crea
// infraestructura nueva, solo llama a los endpoints reales de
// auth/workouts con fetch nativo de Node (sin dependencias nuevas).
//
// Uso (desde backend/, con QA_BACKEND_EMAIL/QA_BACKEND_PASSWORD en .env
// — ver .env.example): npm run seed:qa-workouts
// (requiere el backend arriba en http://localhost:3000)
//
// Auditoría 2026-07-23: antes QA_EMAIL/QA_PASSWORD estaban hardcodeados
// acá mismo. Se leen ahora de variables de entorno (mismas que
// `lib/core/config/dev_backend_test_user.dart` consume vía
// --dart-define-from-file) para que ningún valor real quede en el
// código fuente ni en el historial de git.

// Ya presente en node_modules como dependencia transitiva de
// @nestjs/config — no es una dependencia nueva del proyecto.
require('dotenv').config();

const BASE_URL = 'http://localhost:3000/v1';

const QA_EMAIL = process.env.QA_BACKEND_EMAIL;
const QA_PASSWORD = process.env.QA_BACKEND_PASSWORD;
const QA_DISPLAY_NAME = process.env.QA_BACKEND_DISPLAY_NAME || 'QA Workouts';

if (!QA_EMAIL || !QA_PASSWORD) {
  console.error(
    'Faltan QA_BACKEND_EMAIL/QA_BACKEND_PASSWORD. Definilas en backend/.env ' +
      '(ver .env.example) y corré este script con:\n' +
      '  npm run seed:qa-workouts',
  );
  process.exit(1);
}

const SAMPLE_WORKOUTS = [
  {
    name: 'Sweet Spot 3x12',
    description: 'Tres bloques de sweet spot con recuperación entre series.',
    targetType: 'power',
    isPublic: false,
    intervals: [
      { durationSeconds: 600, targetLow: 50, targetHigh: 60, label: 'Calentamiento' },
      { durationSeconds: 720, targetLow: 88, targetHigh: 94, label: 'Serie 1' },
      { durationSeconds: 300, targetLow: 50, targetHigh: 55, label: 'Recuperación' },
      { durationSeconds: 720, targetLow: 88, targetHigh: 94, label: 'Serie 2' },
      { durationSeconds: 300, targetLow: 50, targetHigh: 55, label: 'Recuperación' },
      { durationSeconds: 720, targetLow: 88, targetHigh: 94, label: 'Serie 3' },
      { durationSeconds: 300, targetLow: 40, targetHigh: 50, label: 'Enfriamiento' },
    ],
  },
  {
    name: 'Recuperación activa 30min',
    description: 'Rodaje suave para días de descanso activo.',
    targetType: 'heart_rate',
    isPublic: false,
    intervals: [
      { durationSeconds: 1800, targetLow: 100, targetHigh: 125, label: 'Z1-Z2' },
    ],
  },
  {
    name: 'A archivar (seed)',
    description: 'Workout de ejemplo pensado para probar el flujo de archivado en la auditoría visual.',
    targetType: 'power',
    isPublic: false,
    intervals: [{ durationSeconds: 1200, targetLow: 60, targetHigh: 70, label: 'Base' }],
  },
];

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: QA_EMAIL, password: QA_PASSWORD }),
  });
  if (res.ok) return res.json();

  if (res.status === 401 || res.status === 404) {
    console.log('Login QA falló, intentando registrar la cuenta...');
    const registerRes = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: QA_EMAIL, password: QA_PASSWORD, displayName: QA_DISPLAY_NAME }),
    });
    if (!registerRes.ok) {
      throw new Error(`Registro falló: ${registerRes.status} ${await registerRes.text()}`);
    }
    return registerRes.json();
  }

  throw new Error(`Login falló: ${res.status} ${await res.text()}`);
}

async function listWorkouts(accessToken) {
  const res = await fetch(`${BASE_URL}/workouts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Listar workouts falló: ${res.status} ${await res.text()}`);
  return res.json();
}

async function createWorkout(accessToken, dto) {
  const res = await fetch(`${BASE_URL}/workouts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(dto),
  });
  if (!res.ok) throw new Error(`Crear workout "${dto.name}" falló: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const health = await fetch(`${BASE_URL}/health`).then((r) => r.json());
  console.log('Backend health:', health);

  const { accessToken } = await login();
  console.log('Login QA ok.');

  const existing = await listWorkouts(accessToken);
  const existingNames = new Set(existing.map((w) => w.name));

  for (const dto of SAMPLE_WORKOUTS) {
    if (existingNames.has(dto.name)) {
      console.log(`Ya existe "${dto.name}" — no se duplica.`);
      continue;
    }
    const created = await createWorkout(accessToken, dto);
    console.log(`Workout creado: "${created.name}" (${created.id})`);
  }

  console.log('\nSeed de Workouts completo.');
  console.log(`  Email:    ${QA_EMAIL}`);
}

main().catch((err) => {
  console.error('Seed falló:', err);
  process.exit(1);
});
