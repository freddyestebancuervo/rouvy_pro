# RidePro — Documento 22: Auditoría y Plan de Despliegue del Backend NestJS (Development)

- **Fecha:** 2026-07-26
- **Rol:** Arquitecto de Software Senior / DevOps
- **Estado de esta tarea:** Solo auditoría (con evidencia real de ejecución) y planificación. **Cero recursos cloud creados, cero despliegues, cero cambios de DNS, cero cambios en Firebase, cero cambios de código de producción.** Se ejecutaron comandos de verificación local (`npm run build`, `npm test`) y se intentó (sin éxito, Docker Desktop no está corriendo) levantar un contenedor Postgres efímero para e2e — ninguno de estos comandos crea infraestructura persistente ni modifica el repositorio.

---

## 1. Estado real del backend (con evidencia, no solo lectura de código)

### 1.1 Hallazgo crítico: el `README.md` del backend está desactualizado

`backend/README.md` afirma: *"❌ Sin lógica de negocio todavía — AuthModule/UsersModule están vacíos... No se ha podido instalar ni ejecutar en el entorno donde se escribió."* **Esto ya no es cierto.** Evidencia:

```
$ npm run build   → sin errores (nest build)
$ npm test        → Test Suites: 8 passed, 8 total / Tests: 73 passed, 73 total
```

Módulos reales, con lógica, DTOs, guards y specs: `AuthModule` (login/registro/refresh con detección de reuso), `UsersModule`, `EquipmentModule`, `WorkoutsModule` — los 4 completamente implementados, no vacíos. El README describe un estado de hace varias iteraciones (tarea "C2"); el código real ya está en "D2" (Workouts) con Bloque C (Auth) cerrado. **Recomiendo actualizar el README como parte de la Fase 1** (no lo hice ahora — está fuera del alcance de "auditoría y plan").

### 1.2 NestJS

| Aspecto | Estado |
|---|---|
| Versión | NestJS 10.3.10 (Node 24 disponible localmente, compatible) |
| Módulos | `AppModule` (raíz) → `DatabaseModule` (global), `JwtModule` (global), `AuthModule`, `UsersModule`, `EquipmentModule`, `WorkoutsModule`. Sin `RoutesModule`/`TelemetryModule`/`AIModule`/`SyncModule` (no existen todavía, consistente con el alcance actual del cliente) |
| Configuración | `@nestjs/config` global, `.env` vía `ConfigModule.forRoot({ isGlobal: true })`; valores leídos directo de `process.env` en varios lugares (no siempre vía `ConfigService`) — funcional, aunque no 100% idiomático de Nest |
| Validación | `ValidationPipe` global: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` — rechaza cualquier campo no declarado en el DTO. Sólido |
| Prefijo global | `app.setGlobalPrefix('v1')` — confirmado, coincide con `ApiConfig`/`AppEnvironment.backendBaseUrl` del cliente Flutter (`.../v1`) |
| Health checks | `GET /v1/health` — verifica conexión REAL a Postgres (`SELECT 1`), no solo "el proceso vive". Devuelve `503` si la base no responde |
| Manejo de errores | `ApiExceptionFilter` global (`@Catch()`) — sobre único `{ error: { code, message, requestId, details } }`; mapea `ThrottlerException`→`RATE_LIMITED`, `ValidationPipe`→`VALIDATION_ERROR`, etc. Nunca expone stack traces al cliente (solo al logger interno) |
| Logging | `Logger` nativo de Nest (`ApiExceptionFilter` registra `exception.stack` en 500s) — sin agregador externo (Sentry/Datadog/etc.), sin structured logging (JSON) todavía |

### 1.3 PostgreSQL

| Aspecto | Estado |
|---|---|
| Conexión | `pg.Pool` directo (sin ORM, decisión deliberada documentada), pool cerrado correctamente en `OnApplicationShutdown` (evita fugas de conexión) |
| SSL | Ya soportado vía `DATABASE_SSL=true` (activa `rejectUnauthorized: false`, patrón estándar para Postgres administrado tipo RDS/Cloud SQL) — **el código ya está listo para un Postgres gestionado**, no haría falta tocarlo |
| Migraciones | 4 archivos SQL puros (`0001_init.sql` → `0004_workouts.sql`), aplicadas con `node-pg-migrate up` — **corren limpio en CI** (verificado leyendo `.github/workflows/ci.yml`, que las aplica contra un Postgres 16 real antes de los e2e) |
| Seeds | `scripts/seed_qa_workouts.js` — solo para QA local, no pensado para ningún entorno desplegado |
| Índices | Diseño maduro: únicos parciales (`equipment_one_default_per_user_category`, `equipment_user_ble_address_unique`, `users_email_lower_unique`), con corrección real de una condición de carrera ya documentada (migración 0002) |
| **Estrategia de rollback** | ⚠️ **No existe.** Las 4 migraciones son `.sql` puros de "solo ida" — no hay archivos `.down.sql` ni migraciones `.js` con `up`/`down`. El script `migrate:down` está declarado en `package.json` pero no tiene nada que ejecutar de forma automática para estas migraciones. **Esto es un bloqueante real para un despliegue con datos reales**, aunque no bloquea Development (que puede recrearse desde cero) |

### 1.4 Seguridad

| Aspecto | Estado |
|---|---|
| Variables de entorno | `.env`/`.env.example` con convención clara; **confirmado con `git ls-files` y `git check-ignore` que `.env` y `secrets/` NUNCA se han commiteado** — cero secretos en el historial de git |
| Secretos | Par de claves RS256 (`jwt_private.pem`/`jwt_public.pem`) generadas localmente, fuera de git. JWT firmado con clave privada, verificado con la pública — nunca un secreto simétrico compartido |
| CORS | `resolveCorsOptions()`: allowlist explícita si `CORS_ALLOWED_ORIGINS` está definida; si no, fallback de conveniencia SOLO-localhost fuera de producción; en producción sin configurar → **cierre total** (`origin: false`), nunca abierto. Ya auditado y corregido (commit `4caea56`, referenciado en memoria de esta sesión) |
| Autenticación | **Sistema JWT propio (RS256), completamente independiente de Firebase Auth** — no existe ningún puente Firebase↔NestJS (`T-F1.5`, Documento 15, sigue sin construirse). Refresh tokens hasheados (SHA-256, nunca texto plano), con detección de reuso (revoca todos los tokens activos si detecta un refresh ya usado — mitigación real de robo de token, verificado en el log de test: *"Refresh token reuse detectado... todos sus refresh tokens activos fueron revocados"*) |
| Rate limiting | `ThrottlerGuard` global (100 req/60s por IP, defensa de respaldo) + `RefreshThrottleGuard` específico para `/auth/refresh` (evita que el límite por-token se aplique a rutas sin refresh token) |
| Headers | `helmet()` con CSP y `crossOriginEmbedderPolicy` desactivados deliberadamente (API JSON pura, sin HTML que proteger) — headers estándar (`X-Content-Type-Options`, oculta `X-Powered-By`, etc.) sí activos |
| Exposición de errores | `ApiExceptionFilter` nunca devuelve `stack` al cliente; el 500 genérico siempre dice *"Ocurrió un error inesperado."* — mismo principio ya aplicado en el cliente Flutter esta sesión |
| Cuentas de prueba | `DevBackendTestUser`/`QA_BACKEND_EMAIL` — gateado por `kIsWeb`... no, por `kDebugMode` en el cliente; en el backend, el registro/login normal de esa cuenta pasa por los mismos endpoints reales, sin bypass de seguridad |

### 1.5 Operación

| Aspecto | Estado |
|---|---|
| Dockerfile | **No existe** |
| docker-compose | **No existe** (confirmado, `find` sin resultados en todo el repo) |
| Scripts | Solo `seed_qa_workouts.js`; sin scripts de despliegue/build de imagen |
| CI/CD | `.github/workflows/ci.yml`, job `backend-tests`: instala, genera claves JWT efímeras, aplica migraciones, levanta el servidor, verifica `/v1/health`, corre e2e — **contra un Postgres 16 real (contenedor de servicio de GitHub Actions)**. Robusto para CI. **Cero paso de deploy** — nada publica una imagen ni despliega a ningún lado |
| Observabilidad | Solo `Logger` de Nest a stdout — sin métricas, sin tracing, sin dashboards |
| Backups | No aplica todavía (no hay Postgres desplegado en ningún lugar real) |
| Costos actuales | $0 — todo corre local/CI |

---

## 2. Bloqueantes para desplegar Development

1. **No existe Dockerfile** — cualquier plataforma de despliegue basada en contenedores (Cloud Run, Fly.io, Railway con Docker) lo necesita. Railway/Render pueden construir directo desde Node sin Dockerfile (buildpacks), pero un Dockerfile explícito da control total y es portable entre plataformas — lo recomiendo igual.
2. **Sin estrategia de rollback de esquema** — antes de tener datos reales en Development vale la pena decidir si esto se corrige (migraciones reversibles) o se acepta el riesgo (Development se puede recrear desde cero sin costo real).
3. **`AppEnvironment.developmentEnvironment.backendBaseUrl`** apunta a `localhost` — una vez exista una URL real desplegada, hay que actualizar `environment_development.dart` (Fase futura, NO ejecutada hoy, y explícitamente fuera de esta tarea).
4. **Sin gestor de secretos en la nube** — hoy los secretos viven en archivos locales (`.env`, `secrets/*.pem`); cualquier plataforma elegida necesita su propio mecanismo (variables de entorno cifradas o un servicio como Secret Manager).

## 3. Riesgos

| Riesgo | Severidad | Nota |
|---|---|---|
| README desactualizado induce a subestimar el trabajo ya hecho | Bajo, pero real | Corregirlo es casi gratis, recomendado en Fase 1 |
| Sin rollback de esquema | Medio para Prod, bajo para Dev | Development tolera "recrear desde cero"; Producción no debería |
| Cold starts si se elige una plataforma serverless sin instancia mínima | Medio | Afecta UX si Workouts tarda 2-5s en la primera carga tras inactividad — mitigable con `min-instances` (costo extra) |
| Costo de Postgres gestionado en Development | Bajo-Medio | Es el componente más caro de mantener "siempre encendido"; hay alternativas de costo casi cero (ver sección 6) |
| Ausencia de logging estructurado/observabilidad | Bajo hoy, medio a futuro | Suficiente para Development; antes de Producción con usuarios reales convendría al menos logs estructurados y alertas básicas |
| `JWT_AUDIENCE` default (`ridepro-mobile`) no distingue Web de móvil | Bajo | No bloquea nada hoy (mismo backend, mismo emisor); anotar como posible ajuste futuro si se necesita diferenciar clientes |

---

## 4. Alternativas de plataforma comparadas

| Criterio | **Railway** | **Render** | **Fly.io** | **Google Cloud Run + Cloud SQL** |
|---|---|---|---|---|
| Costo (Dev, uso bajo) | ~$5-10/mes (sin free tier desde 2023) | Free tier de cómputo (con sleep) + Postgres free 90 días, luego ~$7/mes | Variable, ~$0-5/mes con instancias compartidas pequeñas | Cloud Run ~$0-3/mes (escala a cero); Cloud SQL ~$9-15/mes (sin tier gratuito permanente) |
| Facilidad de setup | Muy alta — git push, detecta Node automáticamente | Muy alta — similar a Railway, YAML simple | Alta, pero requiere `fly.toml` + CLI propia | Media — requiere Dockerfile + `gcloud`/Cloud Build; más pasos que las anteriores |
| PostgreSQL gestionado | Sí, add-on propio, simple | Sí, add-on propio, simple | Parcial — "Fly Postgres" es más DIY (cluster propio en su infra); "Managed Postgres" es nuevo/menos probado | Sí, Cloud SQL — el más maduro y probado de los 4 (mismo nivel que RDS) |
| **Región cercana a Colombia** | ❌ Solo regiones en EE.UU. | ❌ Oregon/Ohio/Virginia/Frankfurt/Singapore — ninguna en Sudamérica | ✅ Tiene región São Paulo (`gru`) | ✅ Tiene región São Paulo (`southamerica-east1`) — **la misma ya usada hoy para Firestore de `ridepro-development`** (Documento 17) |
| Escalabilidad | Buena, vertical + horizontal simple | Buena, similar | Buena, orientada a edge/multi-región | Excelente — autoscaling nativo de contenedores, es el estándar de la industria para esto |
| Cold starts | Bajos (no escala a cero por defecto en planes pagos) | **Altos en el free tier** (duerme tras inactividad, ~30-60s para despertar) | Bajos si se mantiene 1 instancia corriendo (costo extra) | Presentes por defecto (escala a cero), mitigables con `--min-instances=1` (costo extra, pero bajo) |
| HTTPS | Automático | Automático | Automático | Automático |
| Variables secretas | Panel propio, cifrado en reposo | Panel propio, cifrado en reposo | Panel propio (`fly secrets`) | **Google Secret Manager** — el más maduro de los 4, con versionado y auditoría de acceso |
| Rollback | Manual (redeploy de una versión anterior) | Manual (redeploy) | Manual (`fly releases`) | **Nativo y de primera clase** — Cloud Run versiona cada despliegue como "revisión" con un comando de rollback directo (`gcloud run services update-traffic --to-revisions`) |
| Logs | Panel propio, básico | Panel propio, básico | Panel propio, básico | **Cloud Logging** — integrado, con filtros/búsqueda avanzada, retención configurable |
| Integración con lo ya existente | Ninguna (cuenta/billing nuevos) | Ninguna | Ninguna | **Total** — mismo proyecto GCP que ya respalda Firebase (`ridepro-development`), misma cuenta de facturación, mismo IAM |

---

## 5. Recomendación única

**Google Cloud Run (backend) + Cloud SQL for PostgreSQL, región `southamerica-east1` (São Paulo), dentro del mismo proyecto GCP `ridepro-development`.**

**Por qué, en orden de peso:**
1. **Es la única opción, junto con Fly.io, con una región real cercana a Colombia** — y a diferencia de Fly.io, su Postgres gestionado (Cloud SQL) es tan maduro como RDS, no una oferta más nueva/experimental.
2. **Reutiliza infraestructura ya existente y de confianza** — `ridepro-development` YA es un proyecto GCP (es lo que hay detrás de cualquier proyecto Firebase); habilitar Cloud Run/Cloud SQL ahí no crea una cuenta nueva, ni una relación de facturación nueva, ni un nuevo IAM que aprender — es el mismo panel donde ya se gestiona Firestore.
3. **Rollback y logs de primera clase**, sin configuración adicional — el punto más débil de Railway/Render/Fly.io frente a esta opción.
4. **El código ya está preparado**: `DATABASE_SSL=true` ya existe y sigue exactamente el patrón esperado por Cloud SQL; no hace falta tocar `database.config.ts`.

**Trade-off honesto:** Railway/Render son genuinamente más simples de configurar por primera vez (sin Dockerfile, sin `gcloud`) — si la prioridad fuera "desplegar en la próxima hora sin aprender herramientas nuevas", Railway sería la recomendación. Dado que el criterio explícito que diste ("región cercana a Colombia") descarta a ambos, y que ya existe inversión en el ecosistema GCP vía Firebase, la recomendación se mantiene en Cloud Run + Cloud SQL.

---

## 6. Arquitectura de despliegue propuesta (Development)

```
┌─────────────────────────────────────────────────────────────┐
│ Proyecto GCP: ridepro-development (el mismo de Firebase)     │
│                                                                │
│  ┌──────────────────┐        ┌──────────────────────────┐    │
│  │   Cloud Run        │──────▶│  Cloud SQL (PostgreSQL)   │    │
│  │  (backend NestJS)   │       │  southamerica-east1       │    │
│  │  southamerica-east1  │       │  instancia pequeña (Dev)  │    │
│  │  min-instances: 0     │       └──────────────────────────┘    │
│  │  (o 1, si se paga      │                                       │
│  │   evitar cold start)    │       ┌──────────────────────────┐  │
│  └──────────────────┘        │  Secret Manager            │  │
│           ▲                    │  (DATABASE_URL, JWT keys)   │  │
│           │ HTTPS                └──────────────────────────┘  │
└───────────┼───────────────────────────────────────────────────┘
            │
   RidePro Web Development
   (AppEnvironment.developmentEnvironment.backendBaseUrl
    → https://ridepro-backend-dev-XXXX.a.run.app/v1)
```

---

## 7. Plan por fases (nada ejecutado)

### Fase 1 — Higiene previa (bajo riesgo, sin infraestructura nueva)
- **Objetivo:** dejar el repo consistente con la realidad antes de tocar infraestructura.
- **Archivos afectados:** `backend/README.md` (actualizar estado real), opcionalmente crear migraciones `.down.sql` para las 4 existentes (documentar cómo revertir cada una).
- **Riesgos:** ninguno — es documentación + SQL de reversión, no se ejecuta contra nada real.
- **Pruebas:** ninguna nueva requerida; `npm test`/`npm run build` deben seguir en verde.
- **Criterio de aceptación:** README refleja el estado real (Auth/Users/Equipment/Workouts implementados); cada migración tiene su reversión documentada (aunque no se use todavía).
- **Fuera de alcance:** cualquier cambio de infraestructura.

### Fase 2 — Contenedorización
- **Objetivo:** `Dockerfile` multi-stage (build TypeScript → imagen liviana solo con `dist/` + `node_modules` de producción).
- **Archivos afectados:** `backend/Dockerfile` (nuevo), `backend/.dockerignore` (nuevo).
- **Comandos previstos (no ejecutados):**
  ```
  docker build -t ridepro-backend:dev .
  docker run --rm -p 3000:3000 --env-file .env ridepro-backend:dev
  curl http://localhost:3000/v1/health
  ```
- **Riesgos:** bajo — solo empaquetado, mismo código que ya compila y pasa tests.
- **Criterio de aceptación:** la imagen local responde `200` en `/v1/health` contra un Postgres local (o el contenedor efímero de auditoría, si se autoriza más adelante).

### Fase 3 — Provisionar Cloud SQL (Development)
- **Objetivo:** instancia Postgres gestionada, región `southamerica-east1`, dentro de `ridepro-development`.
- **Comandos previstos (requieren tu autorización explícita antes de ejecutar — no son parte de esta tarea):**
  ```
  gcloud sql instances create ridepro-development-pg \
    --database-version=POSTGRES_16 \
    --region=southamerica-east1 \
    --tier=db-f1-micro \
    --project=ridepro-development
  ```
- **Riesgos:** este SÍ es un recurso cloud real con costo recurrente — requiere aprobación explícita cuando llegue el momento.
- **Criterio de aceptación:** instancia visible en Cloud SQL, accesible solo desde Cloud Run (sin IP pública abierta).

### Fase 4 — Desplegar Cloud Run (Development)
- **Objetivo:** el backend corriendo en una URL HTTPS real.
- **Comandos previstos:**
  ```
  gcloud run deploy ridepro-backend-dev \
    --image=<imagen construida en Fase 2> \
    --region=southamerica-east1 \
    --set-secrets=DATABASE_URL=database-url-dev:latest,JWT_PRIVATE_KEY=jwt-private-dev:latest,JWT_PUBLIC_KEY=jwt-public-dev:latest \
    --project=ridepro-development
  ```
- **Riesgos:** despliegue real — requiere tu autorización explícita, no ejecutado hoy.
- **Criterio de aceptación:** `curl https://<url-real>/v1/health` responde `200 {"status":"ok","database":"connected"}`.

### Fase 5 — Conectar el cliente Flutter
- **Objetivo:** `environment_development.dart` apunta a la URL real de Cloud Run en vez de `localhost`.
- **Archivos afectados:** `lib/core/config/environments/environment_development.dart` (un solo valor, `backendBaseUrl`).
- **Riesgos:** bajo, mismo patrón ya usado y probado (`BACKEND_BASE_URL_OVERRIDE` sigue disponible para volver a `localhost` sin recompilar nada más).
- **Criterio de aceptación:** `flutter build web --release --target lib/main_development.dart`, desplegado al canal Preview, carga Entrenamientos contra el backend real — sin `ApiConfig`/`localhost` de por medio.
- **Explícitamente NO se toca `productionEnvironment.backendBaseUrl`** en esta fase ni en ninguna futura sin autorización aparte.

### Fase 6 — CI/CD
- **Objetivo:** extender `.github/workflows/ci.yml` (o un workflow nuevo) para construir y publicar la imagen a Artifact Registry y desplegar a Cloud Run automáticamente en cambios a `main`/`backend/**`.
- **Riesgos:** requiere secretos de GitHub Actions (credenciales de despliegue) — gestión de secretos adicional, a decidir cuándo se autorice esta fase.

---

## 8. Estrategia de rollback (general, todas las fases)

- **Código/imagen:** Cloud Run mantiene todas las revisiones anteriores — rollback es reasignar tráfico a la revisión previa, sin rebuild.
- **Esquema de base de datos:** hoy **no hay rollback automático** (bloqueante ya señalado, sección 2). Mitigación mientras tanto: Development se puede recrear desde cero (`DROP DATABASE` + re-aplicar migraciones) sin costo real, ya que no tendrá datos de usuarios reales.
- **Despliegue completo:** si Cloud Run/Cloud SQL fallan tras un despliegue, `environment_development.dart` puede revertirse a `localhost` (mismo mecanismo de `BACKEND_BASE_URL_OVERRIDE` ya construido) mientras se investiga, sin bloquear el resto del desarrollo del cliente.

## 9. Costos estimados (aproximados, sin cotización en vivo)

| | Development | Production (futuro, no autorizado hoy) |
|---|---|---|
| Cloud Run | ~$0-3/mes (escala a cero, tráfico de pruebas) | ~$10-30/mes (con `min-instances=1` para evitar cold starts) |
| Cloud SQL | ~$9-15/mes (instancia mínima, siempre encendida) | ~$25-60+/mes (instancia mayor, posible alta disponibilidad) |
| Secret Manager | Prácticamente $0 (pocos secretos, bajo volumen de accesos) | Igual, prácticamente $0 |
| **Total estimado** | **~$10-18/mes** | **~$35-90+/mes**, según tráfico real |

**Alternativa de menor costo para Development específicamente:** usar un Postgres gestionado externo con tier gratuito real (Neon o Supabase, ambos con free tier permanente, aunque sin presencia en Sudamérica) solo para Development, manteniendo Cloud Run para el backend — bajaría el costo de Development a **~$0-3/mes**, a cambio de latencia algo mayor en las consultas a la base (el backend en São Paulo, la base en EE.UU./Europa). Lo dejo como alternativa a decidir, no como parte de la recomendación principal, porque agregar un proveedor más fuera de GCP reintroduce parte de la fragmentación que la recomendación principal buscaba evitar.

---

## 10. Resumen de archivos que habría que modificar (ninguno tocado hoy)

- `backend/README.md` — actualizar estado (Fase 1)
- `backend/migrations/000X_*.down.sql` — nuevos, opcionales (Fase 1)
- `backend/Dockerfile`, `backend/.dockerignore` — nuevos (Fase 2)
- `lib/core/config/environments/environment_development.dart` — un valor (Fase 5, no antes)
- `.github/workflows/ci.yml` o un workflow nuevo — CI/CD (Fase 6)

## 11. Criterios de aceptación globales

1. `/v1/health` responde `200` desde la URL pública real, no solo local.
2. Cero secretos en archivos versionados (ya cumplido hoy, debe seguir cumpliéndose).
3. `flutter build web --release --target lib/main_development.dart` + Workouts cargando contra el backend real, sin `localhost`.
4. `productionEnvironment.backendBaseUrl` sigue siendo el placeholder — no se toca hasta que exista una decisión y fase explícitas para Producción.
5. Rollback de código verificado (desplegar una revisión rota a propósito en un ensayo y confirmar que revertir a la anterior funciona) antes de considerar Development "en producción de pruebas" real.

---

**Detenido aquí.** Documento de auditoría y plan entregado. No se desplegó nada, no se creó ningún recurso cloud, no se modificó DNS ni Firebase, no se tocó `productionEnvironment.backendBaseUrl`, no se hizo `git add`/commit/push. Esperando tu autorización para cualquier fase.
