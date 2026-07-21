# RidePro Backend (objetivo) — NestJS + PostgreSQL

Scaffold de la tarea **C2** (`ROADMAP_M0_M1.md`). Ver
`docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 0 para por qué existe
este backend en paralelo a Firebase (capa actual del cliente Flutter) —
resumen: Firestore/Firebase Auth siguen siendo la fuente de verdad HOY;
este backend es la ruta de escalado para lo que Firestore no modela bien
(multijugador, analítica agregada, panel de admin con queries complejas).

## Estado actual

✅ Levanta, se conecta a Postgres, expone `GET /v1/health`.
❌ **Sin lógica de negocio todavía** — `AuthModule`/`UsersModule` están
vacíos a propósito (ver sus docblocks). Los endpoints reales
(`POST /auth/register`, `POST /auth/login`) son la tarea **C3**.

⚠️ **No se ha podido instalar ni ejecutar en el entorno donde se
escribió** (sin acceso a red para `npm install`, sin instancia de
Postgres disponible) — mismo patrón de limitación que
`firebase/rules-tests/`, ver `docs/SECURITY_AUDIT.md`. El código está
escrito para ser correcto por inspección (sigue la API estándar de
NestJS 10.x), pero no ha corrido ni una vez.

## Setup (en un entorno con red)

```bash
cd backend
npm install
cp .env.example .env
# Editar .env con una DATABASE_URL real apuntando a un Postgres local o de desarrollo.

# Crear las tablas (ver migrations/0001_init.sql):
psql "$DATABASE_URL" -f migrations/0001_init.sql

npm run start:dev
```

Confirmar que levantó correctamente:
```bash
curl http://localhost:3000/v1/health
# Esperado: {"status":"ok","database":"connected"}
```

## Ejecutar el test e2e

```bash
npm run test:e2e
```

Requiere una `DATABASE_URL` real y accesible (no usa mocks — el propósito
del único test que existe hoy es confirmar una conexión REAL a Postgres).

## Estructura

```
backend/
├── src/
│   ├── main.ts                 # bootstrap, prefijo /v1, validación global
│   ├── app.module.ts            # módulo raíz
│   ├── app.controller.ts        # GET /v1/health
│   ├── config/
│   │   └── database.config.ts   # pool de conexión a Postgres (pg, sin ORM todavía)
│   └── modules/
│       ├── auth/auth.module.ts  # vacío — tarea C3
│       └── users/users.module.ts# vacío — tarea C3/D1
├── migrations/
│   └── 0001_init.sql            # DDL completo, igual a la spec sección 2.2
├── test/
│   └── app.e2e-spec.ts          # test e2e del endpoint de salud
└── .env.example
```

## Por qué `pg.Pool` directo y no un ORM

Decisión deliberada de este scaffold, no una omisión: elegir entre
TypeORM/Prisma/Drizzle es una decisión que vale la pena tomar cuando ya
hay lógica de negocio real que escribir (tarea C3), no antes — un ORM mal
elegido en este punto sería más caro de deshacer que no tener ninguno
todavía.

## Siguiente paso

Tarea **C3** del roadmap: implementar `POST /auth/register` y
`POST /auth/login` siguiendo el contrato exacto de
`docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 1.2 (incluyendo el sobre
de error estándar `{ "error": { "code", "message", "requestId" } }`).
