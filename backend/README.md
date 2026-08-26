# RidePro Backend — NestJS + PostgreSQL

Backend propio de RidePro, en paralelo a Firebase. El cliente Flutter conserva Firebase
Auth/Firestore para los flujos que todavía consumen directamente Firebase, mientras el
backend NestJS/PostgreSQL cubre Equipment/Workouts y ya dispone de un puente de identidad
Firebase → NestJS para emitir la sesión propia de la API.

Ver `docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 0 para la separación de capas y
`docs/audits/AUDITORIA_FINAL/fase_4/`, `fase_4_1/` y `fase_4_2/` para la evidencia del
puente, concurrencia y pruebas en Development.

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
✅ **Self-deadlock del pool corregido en PR #5**: la recuperación tras colisión `23505`
reutiliza la conexión ya adquirida en vez de intentar obtener una segunda conexión del
mismo pool antes de liberar la primera.
✅ **Rate limiting híbrido del exchange desde PR #5**: capa por identidad Firebase
hasheada + respaldo por IP verificada, además de la capa pública por IP del controller.
✅ Los timeouts temporales de adquisición del pool se clasifican como `503
DATABASE_TEMPORARILY_UNAVAILABLE` con `Retry-After`, en vez de convertirse en un `500`
genérico.
✅ El HEAD final de PR #5 pasó CI completo: Flutter, Firestore y Backend — migración + e2e.
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
- El exchange aplica rate limiting por identidad verificada usando `sha256(firebase_uid)`
  y un bucket de respaldo por IP verificada; el UID completo no se usa como clave ni se
  registra en logs.

### `UsersModule` (`src/modules/users/`)
- Perfil de usuario (`GET`/`PATCH /v1/users/me`) y eliminación de cuenta.
- Asociación opcional con `firebase_uid`; la identidad Firebase se mantiene única cuando
  está presente.
- `upsertByFirebaseUid` consulta candidatos de identidad en un solo round-trip y, tras una
  colisión concurrente esperada, reconsulta al ganador mediante el mismo `client` de la
  transacción. Esto elimina el self-deadlock documentado en Fase 4.2.1.

### `EquipmentModule` (`src/modules/equipment/`)
- Modelo polimórfico único para bicicletas, rodillos y sensores BLE.

### `WorkoutsModule` (`src/modules/workouts/`)
- Entrenamientos estructurados con intervalos, visibilidad propia/pública y catálogo.

## PostgreSQL

- `pg.Pool` directo, sin ORM — decisión deliberada del proyecto.
- Pool cerrado correctamente en `OnApplicationShutdown`.
- SSL soportado mediante `DATABASE_SSL=true` para PostgreSQL administrado.
- PR #5 **no aumentó `DATABASE_POOL_MAX`** ni cambió Cloud SQL/Cloud Run para esconder el
  problema: corrigió la doble adquisición de conexión que causaba el self-deadlock.
- Cuando el pool está temporalmente saturado por una espera legítima, el filtro global
  reconoce exclusivamente el timeout de adquisición de `pg-pool` y devuelve `503` con
  `Retry-After: 2`; errores SQL reales con `.code` no se reclasifican como saturación.
- **Migraciones incorporadas hasta PR #5:**
  1. `0001_init.sql` — usuarios, roles, refresh tokens, sesiones y audit log.
  2. `0002_users_email_case_insensitive_unique.sql` — unicidad case-insensitive de email.
  3. `0003_equipment.sql` — equipamiento.
  4. `0004_workouts.sql` — entrenamientos + intervalos.
  5. `0005_users_firebase_uid.sql` — `firebase_uid` nullable + índice único parcial.

PR #5 no añadió migraciones ni dependencias nuevas. La migración `0005` es reversible; las
migraciones anteriores conservan la deuda histórica de no disponer todas de rollback
automático equivalente.

## Firebase Auth → NestJS

`POST /v1/auth/firebase/exchange` es la frontera explícita entre los dos sistemas:

1. El cliente obtiene un ID token de Firebase Auth.
2. El backend lo valida con Firebase Admin.
3. Tras verificar identidad/email, aplica los buckets de rate limit por UID hasheado y por
   IP verificada.
4. Se localiza/crea de forma segura la identidad PostgreSQL asociada a `firebase_uid`.
5. El backend emite su propio access token RS256 + refresh token.
6. Las rutas NestJS protegidas siguen aceptando exclusivamente la sesión emitida por el
   backend, no un ID token Firebase directamente.

La existencia de este puente no significa que todos los flujos del cliente Flutter hayan
sido migrados de Firebase a NestJS; PR #4 y PR #5 no constituyen por sí solos una migración
completa del cliente.

## Seguridad

- **JWT RS256** (`src/jwt/token.service.ts`) con `iss`/`aud`/`sub` verificados.
- Refresh tokens hasheados con SHA-256 antes de persistirse.
- Firebase Admin se usa para verificar el ID token del endpoint de exchange; errores de
  token inválido/expirado/revocado se traducen a errores propios sin filtrar mensajes
  internos del SDK.
- `firebase_uid` tiene índice único parcial para impedir dos filas con la misma identidad
  Firebase sin impedir filas legacy con `NULL`.
- **Rate limiting híbrido**: bucket público por IP, bucket por UID Firebase hasheado y
  bucket de respaldo por IP una vez verificada la identidad.
- **CORS** fail-closed mediante `CORS_ALLOWED_ORIGINS`.
- **Validación** global con `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`,
  `transform`).
- **Manejo de errores** con `ApiExceptionFilter`; no expone stack traces al cliente y
  diferencia saturación temporal (`503`) de errores internos (`500`).
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

PR #4 añadió pruebas específicas para el exchange Firebase. PR #5 amplió la cobertura de
concurrencia, saturación temporal y rate limit híbrido, y corrigió el harness e2e para que
el servidor escuche una sola vez en un puerto efímero (`app.listen(0)`) en lugar de dejar
que `supertest` compita abriendo/cerrando listeners implícitos. La validación local final
documentó 122/122 unit y 86/86 e2e en dos corridas completas; el HEAD final del PR pasó los
tres jobs de CI. Esos conteos son evidencia de ese punto histórico y pueden crecer en PR
posteriores.

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
│   ├── common/                        # DB errors, filtros, guards, decoradores, utils
│   └── modules/
│       ├── auth/                      # register/login/refresh/firebase exchange/logout
│       ├── users/                     # perfil + firebase_uid
│       ├── equipment/                 # Bloque D1
│       └── workouts/                  # Bloque D2
├── migrations/                        # incluye 0005_users_firebase_uid.sql desde PR #4
├── test/                              # specs e2e + harness con listener estable
├── scripts/seed_qa_workouts.js
└── .env.example
```

## Limitaciones vigentes al cierre de PR #5

- ❌ **No hay evidencia de un deploy real del backend de Production.** El despliegue real
  documentado durante PR #4 corresponde a `ridepro-development` / `ridepro-backend-dev`.
- ⚠️ **La topología de capacidad sigue teniendo margen estrecho aunque el self-deadlock
  esté corregido.** La Fase 4.2 midió Cloud SQL con 25 conexiones máximas, 22 usables y
  Cloud Run con hasta 2 instancias × pool 10; no se aumentó el pool en PR #5.
- ⚠️ El almacenamiento del rate limiter sigue siendo en memoria por instancia; el diseño
  distribuido/compartido se difirió y la revisión independiente registró crecimiento de
  cardinalidad como deuda de baja-media severidad para volumen futuro.
- ⚠️ La revisión independiente dejó un gap no bloqueante: una carrera muy específica en
  el `UPDATE` de una identidad Firebase ya existente podría propagar un `23505` como 500
  en vez de traducirlo a `409 FIREBASE_EMAIL_CONFLICT`. No se oculta como resuelto.
- ⚠️ El puente server-side existe, pero no debe interpretarse como una migración completa
  del cliente Flutter a autenticación NestJS.
- ❌ Las migraciones anteriores a `0005` no tienen rollback automático completo equivalente.
- ❌ Sin logging estructurado/observabilidad externa completa; el backend usa el logger
  nativo y la observabilidad de la plataforma.

## Próximos pasos desde este punto histórico

1. Corregir en una tarea separada el `23505` específico del camino `UPDATE` de una
   identidad Firebase existente, con prueba dedicada.
2. Reevaluar capacidad/pool y almacenamiento compartido del rate limiter cuando el volumen
   real justifique escalar; no aumentar conexiones sin medir Cloud SQL + Cloud Run juntos.
3. Validar explícitamente los consumidores Flutter del exchange antes de afirmar una
   migración completa cliente→backend.
4. Mantener Development y Production como entornos separados; cualquier despliegue o
   mutación de Production requiere su propio gate y evidencia.