# RidePro Backend — NestJS + PostgreSQL

Backend propio de RidePro, en paralelo a Firebase. El cliente Flutter conserva Firebase
Auth/Firestore para los flujos que todavía consumen directamente Firebase, mientras el
backend NestJS/PostgreSQL cubre Equipment/Workouts y ya dispone de un puente de identidad
Firebase → NestJS para emitir la sesión propia de la API.

Ver `docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 0 para la separación de capas y
`docs/audits/AUDITORIA_FINAL/fase_4/` / `fase_4_1/` para la evidencia del puente y sus
pruebas en Development.

**Auditado con evidencia real el 2026-07-26** (Documento 22,
`docs/audits/AUDITORIA_FINAL/`) — ese documento conserva un snapshot anterior a la
contenedorización y al puente Firebase↔NestJS; las capacidades posteriores se acreditan
por los PR que las integraron.

## Estado actual

✅ Compila sin errores (`npm run build`).
✅ 4 módulos de negocio implementados: `AuthModule`, `UsersModule`, `EquipmentModule`,
`WorkoutsModule`.
✅ CI aplica las migraciones y corre la suite e2e contra PostgreSQL real/efímero.
✅ **Contenedorización implementada y validada desde PR #3**: `Dockerfile` multi-stage,
`.dockerignore`, runtime no-root y `HEALTHCHECK` contra `/v1/health`.
✅ **Puente Firebase Auth → NestJS implementado desde PR #4**: el backend verifica un ID
token de Firebase y lo intercambia por la sesión JWT/refresh propia de la API mediante
`POST /v1/auth/firebase/exchange`.
✅ **Development sí tuvo despliegue real en Cloud Run durante la ingeniería de PR #4**:
`ridepro-backend-dev` fue actualizado por imagen inmutable y validado con `/v1/health`.
Esto no acredita ni implica un despliegue del backend de Production.

## Módulos

### `AuthModule` (`src/modules/auth/`)
- `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/refresh`.
- `POST /v1/auth/firebase/exchange` — acepta un ID token Firebase, lo verifica server-side
  y emite la sesión propia de la API.
- `POST /v1/auth/logout` — protegido por `JwtAuthGuard` y revoca el refresh token indicado.
- Contraseñas con `bcryptjs`; nunca en texto plano.
- Detección de reutilización de refresh token: si un refresh token ya usado se presenta
  de nuevo, se revocan todos los refresh tokens activos de ese usuario.
- Condición de carrera de email duplicado cerrada a nivel de base de datos mediante el
  índice único case-insensitive de la migración `0002`.

### `UsersModule` (`src/modules/users/`)
- Perfil de usuario (`GET`/`PATCH /v1/users/me`) y eliminación de cuenta.
- Asociación opcional con `firebase_uid`; la identidad Firebase se mantiene única cuando
  está presente.

### `EquipmentModule` (`src/modules/equipment/`)
- Modelo polimórfico único para bicicletas, rodillos y sensores BLE.

### `WorkoutsModule` (`src/modules/workouts/`)
- Entrenamientos estructurados con intervalos, visibilidad propia/pública y catálogo.

## PostgreSQL

- `pg.Pool` directo, sin ORM — decisión deliberada del proyecto.
- Pool cerrado correctamente en `OnApplicationShutdown`.
- SSL soportado mediante `DATABASE_SSL=true` para PostgreSQL administrado.
- **Migraciones incorporadas hasta PR #4:**
  1. `0001_init.sql` — usuarios, roles, refresh tokens, sesiones y audit log.
  2. `0002_users_email_case_insensitive_unique.sql` — unicidad case-insensitive de email.
  3. `0003_equipment.sql` — equipamiento.
  4. `0004_workouts.sql` — entrenamientos + intervalos.
  5. `0005_users_firebase_uid.sql` — `firebase_uid` nullable + índice único parcial.

La migración `0005` es reversible; las migraciones anteriores conservan la deuda histórica
de no disponer todas de rollback automático equivalente.

## Firebase Auth → NestJS

`POST /v1/auth/firebase/exchange` es la frontera explícita entre los dos sistemas:

1. El cliente obtiene un ID token de Firebase Auth.
2. El backend lo valida con Firebase Admin.
3. Se localiza/crea de forma segura la identidad PostgreSQL asociada a `firebase_uid`.
4. El backend emite su propio access token RS256 + refresh token.
5. Las rutas NestJS protegidas siguen aceptando exclusivamente la sesión emitida por el
   backend, no un ID token Firebase directamente.

La existencia de este puente no significa que todos los flujos del cliente Flutter hayan
sido migrados de Firebase a NestJS en el mismo PR; PR #4 no modificó archivos Flutter.

## Seguridad

- **JWT RS256** (`src/jwt/token.service.ts`) con `iss`/`aud`/`sub` verificados.
- Refresh tokens hasheados con SHA-256 antes de persistirse.
- Firebase Admin se usa para verificar el ID token del endpoint de exchange; errores de
  token inválido/expirado/revocado se traducen a errores propios sin filtrar mensajes
  internos del SDK.
- `firebase_uid` tiene índice único parcial para impedir dos filas con la misma identidad
  Firebase sin impedir filas legacy con `NULL`.
- **Rate limiting** global + guard específico de refresh y límite dedicado al exchange.
- **CORS** fail-closed mediante `CORS_ALLOWED_ORIGINS`.
- **Validación** global con `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`,
  `transform`).
- **Manejo de errores** con `ApiExceptionFilter`; no expone stack traces al cliente.
- `.env` y `secrets/*.pem` permanecen fuera de git.

## Health check

`GET /v1/health` verifica conexión real a PostgreSQL (`SELECT 1`):

```json
{"status":"ok","database":"connected"}
```

Responde `503` si la base no responde.

## Pruebas disponibles

```bash
npm test
npm run test:e2e
```

PR #4 añadió pruebas unitarias y e2e específicas para el exchange Firebase, usuarios con
`firebase_uid`, logout, rate limiting y escenarios de concurrencia. La evidencia de la
Fase 4.1 documenta 104/104 unit y 85/85 e2e en su cierre; esos números son evidencia de
ese punto histórico y pueden crecer en PR posteriores.

## Setup local

```bash
cd backend
npm install
cp .env.example .env
# Editar .env con una DATABASE_URL real y generar las claves JWT:
#   openssl genrsa -out secrets/jwt_private.pem 2048
#   openssl rsa -in secrets/jwt_private.pem -pubout -out secrets/jwt_public.pem

npm run migrate:up
npm run build
npm run start:dev
# o, ya compilado:
npm run start:prod
```

Confirmar que levantó correctamente:

```bash
curl http://localhost:3000/v1/health
# Esperado: {"status":"ok","database":"connected"}
```

## Estructura

```text
backend/
├── Dockerfile                         # imagen multi-stage validada desde PR #3
├── .dockerignore                      # excluye secretos/artefactos del build
├── src/
│   ├── main.ts                        # bootstrap, CORS, /v1, ValidationPipe
│   ├── app.module.ts                  # módulo raíz
│   ├── app.controller.ts              # GET /v1/health
│   ├── config/                        # configuración de DB/CORS
│   ├── database/                      # pool global de pg.Pool
│   ├── firebase/                      # Firebase Admin + verificación de ID token
│   ├── jwt/                           # TokenService RS256
│   ├── common/                        # guards, filtros, decoradores, utils
│   └── modules/
│       ├── auth/                      # register/login/refresh/firebase exchange/logout
│       ├── users/                     # perfil + firebase_uid
│       ├── equipment/                 # Bloque D1
│       └── workouts/                  # Bloque D2
├── migrations/                        # incluye 0005_users_firebase_uid.sql desde PR #4
├── test/                              # specs e2e
├── scripts/seed_qa_workouts.js
└── .env.example
```

## Limitaciones vigentes al cierre de PR #4

- ❌ **No hay evidencia de un deploy real del backend de Production.** El despliegue real
documentado en PR #4 corresponde a `ridepro-development` / `ridepro-backend-dev`.
- ⚠️ **El pool PostgreSQL mostró límite bajo concurrencia alta.** Fase 4.1 validó 8
concurrentes, pero 20 concurrentes agotaron el pool configurado con default 10; quedó como
trabajo posterior, no se oculta como PASS.
- ⚠️ El puente server-side existe, pero PR #4 no modificó Flutter; por tanto no debe
interpretarse como una migración completa del cliente a autenticación NestJS.
- ❌ Las migraciones anteriores a `0005` no tienen rollback automático completo equivalente.
- ❌ Sin logging estructurado/observabilidad externa completa; el backend usa el logger
nativo y la observabilidad de la plataforma.

## Próximos pasos desde este punto histórico

1. Resolver el límite del pool PostgreSQL bajo concurrencia alta en una tarea separada.
2. Validar explícitamente los consumidores Flutter del exchange antes de afirmar una
migración completa cliente→backend.
3. Mantener Development y Production como entornos separados; cualquier despliegue o
mutación de Production requiere su propio gate y evidencia.
