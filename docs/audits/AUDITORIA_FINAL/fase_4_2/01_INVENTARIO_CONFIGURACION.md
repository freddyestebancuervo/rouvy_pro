# 1. Inventario de configuración (Partes 2, 4 y 5) — solo lectura

## 1.1 Configuración del pool de PostgreSQL (`backend/src/config/database.config.ts`)

| Parámetro | Valor por defecto (código) | Variable de entorno | Uso actual real (Cloud Run) | Riesgo |
|---|---|---|---|---|
| `max` (tamaño del pool) | `10` | `DATABASE_POOL_MAX` | **`10`** — la variable nunca se configuró en `ridepro-backend-dev` | Alto — ver análisis en [02](02_ANALISIS_POOL_POSTGRESQL.md) |
| `idleTimeoutMillis` | `30000` (30s) | `DATABASE_IDLE_TIMEOUT_MS` | `30000` (sin configurar) | Bajo — tiempo razonable, no contribuye al agotamiento bajo ráfaga |
| `connectionTimeoutMillis` | `5000` (5s) | `DATABASE_CONNECTION_TIMEOUT_MS` | `5000` (sin configurar) | Medio — es el tiempo exacto que tarda en fallar una request cuando el pool está lleno; muy corto para absorber una ráfaga breve, muy largo para fallar rápido y dar un 503 controlado |
| `ssl` | deshabilitado salvo `DATABASE_SSL=true` | `DATABASE_SSL` | según secreto `DATABASE_URL` (usa socket de Cloud SQL vía Unix socket, no aplica TLS de red) | Ninguno — patrón estándar del conector de Cloud SQL |
| `min` (mínimo de conexiones abiertas) | no configurado — `pg.Pool` usa `0` por defecto | no existe variable | `0` — las conexiones se abren bajo demanda, no hay "precalentamiento" | Medio — la primera ráfaga después de idle paga el costo de abrir conexiones nuevas, en vez de reutilizar unas ya abiertas |

## 1.2 Arquitectura del pool — un único `pg.Pool` por proceso

- **Un solo `new Pool()` en todo el código fuente** (`database.config.ts:35`) — confirmado con `grep -rn "new Pool(" src/`, una sola coincidencia.
- `DatabaseModule` es `@Global()` y provee `PG_POOL` como **singleton** — todos los consumidores comparten la MISMA instancia de pool, nunca crean uno propio.
- Consumidores confirmados (`@Inject(PG_POOL)`): `AppController` (healthcheck), `AuditLogRepository`, `EquipmentRepository`, `RefreshTokensRepository`, `UsersRepository`, `WorkoutsRepository` — **6 en total, 0 pools adicionales**.
- `DatabasePoolShutdown` cierra el pool en `OnApplicationShutdown` (vía `app.enableShutdownHooks()` en `main.ts`) — confirmado, sin fugas de proceso al apagar.

## 1.3 Manejo de conexiones — `pool.connect()` (transacciones) vs `pool.query()` (directo)

| Archivo | `pool.connect()` | `client.release()` en `finally` |
|---|---|---|
| `equipment.repository.ts` | 2 | 2/2 ✓ |
| `refresh-tokens.repository.ts` | 1 (`rotate`, usa `SELECT ... FOR UPDATE`) | 1/1 ✓ |
| `users.repository.ts` | 2 (`createWithPassword`, `upsertByFirebaseUid`) | 2/2 ✓ |
| `workouts.repository.ts` | 1 | 1/1 ✓ |
| **Total** | **6** | **6/6 — cero fugas encontradas** |

**21 sitios** con `this.pool.query()` directo (auto-adquiere y libera una
conexión por consulta, sin retenerla). Ningún repositorio retiene una
conexión más tiempo del necesario para su propia transacción — todas las
transacciones son cortas (BEGIN → 2-3 sentencias → COMMIT/ROLLBACK), sin
anidamiento (confirmado: ningún `pool.connect()` ocurre dentro del bloque
`try` de otro `pool.connect()`).

## 1.4 Capacidad real de Cloud SQL Development (`ridepro-backend-dev-pg`)

Consultado en modo lectura, sin modificar nada:

| Métrica | Valor | Fuente | Momento |
|---|---|---|---|
| Edición/versión | PostgreSQL 16 | `gcloud sql instances describe` | 2026-07-28, esta sesión |
| Tier | `db-f1-micro` (shared-core, el más pequeño de Cloud SQL) | `gcloud sql instances describe` | ídem |
| Disco | 10 GB | `gcloud sql instances describe` | ídem |
| Disponibilidad | ZONAL (sin réplica de alta disponibilidad) | `gcloud sql instances describe` | ídem |
| `max_connections` | **25** | `SHOW max_connections` (SQL de solo lectura) | ídem |
| `superuser_reserved_connections` | **3** | `SHOW superuser_reserved_connections` | ídem |
| **Conexiones usables reales** | **22** (`25 − 3`) | cálculo | ídem |
| Conexiones activas en el momento de la medición | 9 (7 sin `application_name`, 2 `cloudsqlagent`) | `pg_stat_activity` | ídem, fuera de horario de carga — no representa el pico de Fase 4.1 |

No se imprimieron IPs, contraseñas ni connection strings en ningún momento
de esta consulta (conexión vía Cloud SQL Auth Proxy con ADC, sin credenciales
en texto plano).

## 1.5 Configuración real de Cloud Run (`ridepro-backend-dev`)

| Parámetro | Valor real |
|---|---|
| `containerConcurrency` (requests simultáneos por instancia) | **80** |
| CPU | 1 |
| Memoria | 512Mi |
| Timeout de request | 60s |
| `maxScale` | **2** |
| `minScale` | no configurado → `0` (scale-to-zero) |
| `startup-cpu-boost` | `true` |
| `cloudsql-instances` (conexión) | `ridepro-development:southamerica-east1:ridepro-backend-dev-pg` |

### Cálculo de conexiones potenciales

```
conexiones potenciales = pool por instancia × máximo de instancias
                        = 10 × 2
                        = 20
```

Margen real disponible después de la app:

```
22 (usables en Cloud SQL) − 20 (potencial de la app) = 2
```

Esas 2 conexiones de margen deben cubrir **simultáneamente**: migraciones
(`node-pg-migrate`), acceso administrativo puntual (como el usado para este
mismo diagnóstico, vía Cloud SQL Auth Proxy), y cualquier herramienta de
monitoreo futura. **Es un margen insuficiente para operar con confianza**,
incluso sin considerar que Cloud Run pueda escalar más allá de 2 en el
futuro sin que alguien recuerde ajustar `DATABASE_POOL_MAX` en consecuencia.

Ver el análisis completo de por qué esto se traduce en los 13 errores 500
observados en [02_ANALISIS_POOL_POSTGRESQL.md](02_ANALISIS_POOL_POSTGRESQL.md).
