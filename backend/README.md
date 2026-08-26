# RidePro Backend — NestJS + PostgreSQL

Backend propio de RidePro, en paralelo a Firebase (capa actual de autenticación/Firestore
del cliente Flutter para Auth/Wearables/Training). Ver
`docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 0 para por qué existe este backend:
Firestore/Firebase Auth siguen siendo la fuente de verdad para lo que ya cubren; este
backend es la ruta de escalado para lo que Firestore no modela bien (Equipment, Workouts,
y a futuro multijugador/analítica agregada/panel de admin con queries complejas).

**Auditado con evidencia real el 2026-07-26** (Documento 22,
`docs/audits/AUDITORIA_FINAL/`) — este README reemplaza una versión anterior que
describía un estado de scaffold temprano ya superado.

## Estado actual

✅ Compila sin errores (`npm run build`).
✅ **73/73 pruebas unitarias en verde** (8 suites — ver sección Pruebas).
✅ 4 módulos de negocio completamente implementados (no vacíos): `AuthModule`,
`UsersModule`, `EquipmentModule`, `WorkoutsModule`.
✅ CI (`.github/workflows/ci.yml`, job `backend-tests`) aplica las migraciones y corre
la suite e2e completa contra un Postgres 16 real en cada push/PR.
✅ **Contenedorización implementada y validada desde PR #3**: `Dockerfile` multi-stage,
`.dockerignore`, runtime no-root y `HEALTHCHECK` contra `/v1/health`. Esto acredita la
preparación de la imagen; no equivale por sí solo a un despliegue cloud/Production.

## Módulos

### `AuthModule` (`src/modules/auth/`)
- `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/refresh`.
- Contraseñas con `bcryptjs`; nunca en texto plano.
- Detección de reutilización de refresh token: si un refresh token ya usado se
  presenta de nuevo, se revocan **todos** los refresh tokens activos de ese usuario
  (mitigación de robo de token) — verificado en la suite de pruebas.
- Condición de carrera de email duplicado ya cerrada a nivel de base de datos
  (índice único case-insensitive, migración `0002`), no solo a nivel de aplicación.

### `UsersModule` (`src/modules/users/`)
- Perfil de usuario (`GET`/`PATCH /v1/users/me`), eliminación de cuenta.

### `EquipmentModule` (`src/modules/equipment/`)
- Modelo polimórfico único para todo el equipamiento (bicicletas, rodillos, sensores
  BLE) — agregar una categoría nueva es un `INSERT` en `equipment_categories`, nunca
  una migración estructural.

### `WorkoutsModule` (`src/modules/workouts/`)
- Entrenamientos estructurados (calentamiento + series con objetivo de
  potencia/frecuencia cardíaca). Filtro `?mine=true/false`. Sin búsqueda ni favoritos
  todavía (ver Limitaciones).

## PostgreSQL

- `pg.Pool` directo, sin ORM — decisión deliberada del scaffold original, revisitable
  cuando haya más lógica de negocio que lo justifique.
- Pool cerrado correctamente en `OnApplicationShutdown` (sin fugas de conexión).
- SSL ya soportado (`DATABASE_SSL=true`) para Postgres administrado (RDS, Cloud SQL, etc.).
- **Migraciones** (`node-pg-migrate`, `migrations/*.sql`, 4 archivos aplicados en orden):
  1. `0001_init.sql` — usuarios, roles, refresh tokens, sesiones de entrenamiento, audit log.
  2. `0002_users_email_case_insensitive_unique.sql` — cierre de condición de carrera de email.
  3. `0003_equipment.sql` — modelo polimórfico de equipamiento.
  4. `0004_workouts.sql` — entrenamientos estructurados + intervalos.

## Seguridad

- **JWT RS256** (`src/jwt/token.service.ts`) — par de claves asimétricas, nunca un
  secreto simétrico compartido. Claims `iss`/`aud`/`sub` verificados en cada request
  (`JwtAuthGuard`). Refresh tokens hasheados con SHA-256 antes de persistirse — el
  token en texto plano nunca se guarda.
- **Rate limiting**: `ThrottlerGuard` global (100 req/60s por IP, defensa de respaldo)
  + `RefreshThrottleGuard` específico para `/auth/refresh`.
- **CORS** fail-closed (`src/config/cors.config.ts`): allowlist explícita vía
  `CORS_ALLOWED_ORIGINS`; sin definir y `NODE_ENV=production` → cierre total.
- **Validación**: `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`,
  `transform`) — cualquier campo no declarado en el DTO se rechaza.
- **Manejo de errores**: `ApiExceptionFilter` global — sobre único
  `{ error: { code, message, requestId, details } }`; nunca expone stack traces al
  cliente.
- **Secretos**: `.env` y `secrets/*.pem` nunca se commitean (ver `.gitignore`),
  confirmado con `git check-ignore`.

## Health check

`GET /v1/health` verifica conexión **real** a Postgres (`SELECT 1`), no solo que el
proceso esté vivo:
```json
{"status":"ok","database":"connected"}
```
Responde `503` si la base no responde.

## Pruebas disponibles

```bash
npm test        # Unitarias (Jest, sin Postgres) — 8 suites, 73 tests
npm run test:e2e  # E2E (requiere DATABASE_URL real y accesible, no usa mocks)
```

## Setup local

```bash
cd backend
npm install
cp .env.example .env
# Editar .env con una DATABASE_URL real y generar las claves JWT:
#   openssl genrsa -out secrets/jwt_private.pem 2048
#   openssl rsa -in secrets/jwt_private.pem -pubout -out secrets/jwt_public.pem

npm run migrate:up   # Aplica las 4 migraciones en orden

npm run build         # Compila TypeScript → dist/
npm run start:dev     # Arranca con reinicio automático (desarrollo)
# o, ya compilado:
npm run start:prod    # node dist/main
```

Confirmar que levantó correctamente:
```bash
curl http://localhost:3000/v1/health
# Esperado: {"status":"ok","database":"connected"}
```

## Estructura

```
backend/
├── Dockerfile                        # imagen multi-stage validada desde PR #3
├── .dockerignore                     # excluye secretos/artefactos del contexto de build
├── src/
│   ├── main.ts                      # bootstrap: helmet, CORS, prefijo /v1, ValidationPipe
│   ├── app.module.ts                 # módulo raíz
│   ├── app.controller.ts             # GET /v1/health
│   ├── config/                       # database.config.ts, cors.config.ts
│   ├── database/database.module.ts   # pool global de pg.Pool
│   ├── jwt/                          # TokenService (RS256), JwtModule
│   ├── common/                       # guards, filtros, decoradores, utils compartidos
│   └── modules/
│       ├── auth/                     # registro, login, refresh
│       ├── users/                    # perfil, eliminación de cuenta
│       ├── equipment/                # Bloque D1
│       └── workouts/                 # Bloque D2
├── migrations/                       # 4 archivos SQL, aplicados con node-pg-migrate
├── test/                             # specs e2e (requieren Postgres real)
├── scripts/seed_qa_workouts.js        # datos de prueba, solo QA local
└── .env.example
```

## Limitaciones actuales (honestas, no ocultarlas)

- ❌ **Sin backend desplegado en ningún entorno cloud real** — solo corre local y en
  CI. La **contenedorización ya está cerrada desde PR #3**; el despliegue cloud de
  Development es una fase distinta (ver Documento 22 como plan histórico).
- ❌ **Sin puente Firebase↔NestJS** (`T-F1.5`, Documento 15) — este backend usa su
  propio sistema de autenticación JWT, completamente independiente de Firebase Auth.
  Un usuario autenticado con Firebase no tiene, hoy, ninguna forma automática de
  autenticarse contra este backend.
- ❌ **Sin rollback automático completo de migraciones** — las 4 migraciones son SQL
  de "solo ida" (`node-pg-migrate up`), sin contraparte `.down.sql`. Revertir un
  esquema hoy requiere SQL manual.
- ❌ **Sin CI/CD de despliegue** — el workflow de CI solo compila/prueba, no publica
  ninguna imagen ni despliega a ningún lado.
- ❌ Sin logging estructurado ni observabilidad externa (métricas, tracing, alertas) —
  solo el `Logger` nativo de Nest a stdout.

## Por qué `pg.Pool` directo y no un ORM

Decisión deliberada, no una omisión: elegir un ORM (TypeORM/Prisma/Drizzle) es una
decisión que vale la pena tomar con más lógica de negocio de la que hay hoy — un ORM
mal elegido en este punto sería más caro de deshacer que no tener ninguno todavía.

## Próximos pasos sugeridos

1. Desplegar Development a un entorno cloud real: la **contenedorización ya fue
   completada en PR #3**; quedan como fases separadas la infraestructura Cloud Run /
   Cloud SQL y el despliegue, sujetas a su propia evidencia/autorización.
2. Diseñar el puente Firebase↔NestJS (`T-F1.5`) cuando se priorice.
3. Agregar migraciones `.down.sql` antes de tener datos reales en cualquier entorno
   desplegado.