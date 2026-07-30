# RidePro — Documento Maestro de Arquitectura
## Documento 5 de 9: Escalabilidad

- **Fecha:** 2026-07-24 · **Rama/HEAD:** `feature/d2` / `d3d01d8`
- **Método:** análisis arquitectónico de capacidad — identificación de cuellos de botella por evidencia de código/configuración, proyectados sobre 6 niveles de usuarios (1K/10K/100K/1M/5M/10M). **No incluye pruebas de carga reales** (`k6`, `autocannon`, JMeter u otra herramienta) — no hay entorno desplegado contra el cual ejecutarlas (Documento 1, sección 6). Las afirmaciones de "a partir de qué escala esto duele" son proyecciones razonadas a partir de límites conocidos de la tecnología usada, no mediciones — se marcan como tales.
- **No se modifica código en este documento.**

---

## 1. Resumen — a qué escala aparece cada cuello de botella

| Cuello de botella | 1K | 10K | 100K | 1M | 5M | 10M |
|---|---|---|---|---|---|---|
| Rate limiter en memoria (backend) | ok | ok | ok | 🟠 rompe con >1 instancia | 🔴 | 🔴 |
| Pool de Postgres (`max: 10` por instancia) | ok | ok | 🟡 vigilar | 🟠 | 🔴 | 🔴 |
| Endpoints sin paginación (`equipment`, `workouts`) | ok | ok | 🟡 usuarios con mucho historial | 🟠 | 🔴 | 🔴 |
| Firestore (Auth + perfil + sesiones) | ok | ok | ok | ok | 🟡 (costo, no capacidad) | 🟡 (costo, no capacidad) |
| Sin backend desplegado / sin CD / sin Docker | 🔴 **ya bloquea hoy** — no hay dónde correr esto a ninguna escala | | | | | |
| Sin caché de lectura (Redis) | ok | ok | ok | 🟡 | 🟠 | 🔴 |
| Sin cola de trabajos en segundo plano | ok | ok | ok | 🟡 (si se agregan Estadísticas/Notificaciones) | 🟠 | 🔴 |
| Un único proyecto Firebase (todos los entornos) | 🔴 **riesgo operacional a cualquier escala**, no un problema de capacidad | | | | | |

**Lectura de la tabla:** el problema de escalabilidad más urgente de RidePro **no es de capacidad técnica** — es que **no existe ningún backend desplegado en ninguna parte** (Documento 1, sección 6 y 12): no hay Docker, no hay CD, no hay staging/producción real. Antes de preguntarse "¿aguanta 1 millón de usuarios?", la pregunta real es "¿aguanta 1 usuario, en un servidor real, fuera de una laptop de desarrollo?" — la respuesta hoy es no, porque no hay dónde desplegarlo. Todo lo demás en este documento es válido como análisis de diseño, pero es proyección sobre una base que todavía no está en producción.

---

## 2. Base de datos (PostgreSQL)

- **Pool de conexiones:** `max: 10` por instancia de backend, configurable vía `DATABASE_POOL_MAX` sin tocar código (`backend/src/config/database.config.ts:20`). Con una sola instancia backend (escenario actual, sin CD), 10 conexiones concurrentes son razonables para decenas/cientos de usuarios activos simultáneos, pero se agotan rápido con más tráfico concurrente — el propio código ya lo deja ajustable, así que **no es una limitación de diseño, es un valor de arranque a subir cuando haga falta**, junto con aumentar el `max_connections` del servidor Postgres real (fuera del código de la app).
- **Índices:** presentes y bien dirigidos — verificado leyendo las 4 migraciones completas. Ejemplos: `idx_ride_sessions_user_start (user_id, start_time DESC)`, `idx_equipment_user_active (user_id, category_code) WHERE archived_at IS NULL` (índice parcial, evita indexar filas archivadas), `idx_workouts_owner (owner_id) WHERE archived_at IS NULL`. **No se encontró ninguna consulta de listado sin índice de soporte** en los repositorios inspeccionados.
- **🟠 Hallazgo nuevo — sin paginación en los endpoints de listado:** `EquipmentQueryDto` (`backend/src/modules/equipment/dto/equipment-query.dto.ts`) y `WorkoutQueryDto` (`backend/src/modules/workouts/dto/workout-query.dto.ts`) — leídos completos — **no tienen ningún campo `limit`/`offset`/`page`**. `GET /equipment` y `GET /workouts` devuelven **todas** las filas que matchean los filtros (`category`, `includeArchived`, `mine`), sin límite. **Esto contradice una afirmación de la auditoría de arquitectura previa** (`docs/architecture/01_SYSTEM_ARCHITECTURE.md`, sección 10: *"DTOs de `workouts`/`equipment` en NestJS incluyen `*-query.dto.ts` (evidencia de paginación ya contemplada en el contrato)"*) — la evidencia real, verificada línea por línea en esta pasada, es que **los archivos existen pero no paginan nada**. Se corrige acá con evidencia directa.
  - **Impacto real hoy:** ninguno — un usuario con 5-20 equipos/workouts no genera una respuesta pesada.
  - **Impacto proyectado:** un usuario "power user" con cientos de workouts históricos (entrenador que crea decenas de plantillas por temporada, multiplicado por años de uso) empieza a generar respuestas de tamaño creciente sin límite. A escala de plataforma (100K+ usuarios), esto también bloquea cualquier futuro endpoint administrativo o de catálogo público que liste "todos los workouts públicos" sin control de tamaño de respuesta.
  - **Solución recomendada:** agregar `limit`/`cursor` (paginación por cursor, no por `offset`, para evitar el costo creciente de `OFFSET` en tablas grandes) a ambos DTOs, con un límite máximo hardcodeado del lado servidor (p. ej. 50) independientemente de lo que pida el cliente. Aditivo, no rompe a los clientes actuales si el límite por defecto es generoso.
- **Sin réplicas de lectura** — no evaluado como urgente: a los volúmenes de escritura actuales (CRUD de equipment/workouts, no telemetría cruda) una sola instancia de Postgres bien indexada soporta varios órdenes de magnitud más de lo que el proyecto tiene hoy (0 usuarios en producción real). Relevante a partir de ~1M usuarios activos, no antes.

## 3. Backend (NestJS)

- **Stateless donde importa, con una excepción real:** los servicios no guardan estado de negocio en memoria entre requests — la única pieza de estado en memoria del proceso es el `ThrottlerStorage` (rate limiting, ver Documento 3 sección 6). **Esto es el bloqueador real de escalar horizontalmente el backend a más de una instancia** — con 2+ instancias detrás de un balanceador, cada una lleva su propio contador de rate limit, diluyendo el límite efectivo. Debe resolverse (Redis como backend de `ThrottlerStorage`, ya anticipado en el propio comentario del código: *"mismo backend en memoria hoy, intercambiable por Redis en producción sin tocar este guard"*) **antes** de correr más de una instancia, no después.
- **Sin health check endpoint verificado explícitamente en esta pasada más allá de `/v1/health` mencionado en documentación previa del proyecto (fuera de esta serie)** — necesario para que cualquier balanceador de carga/orquestador (Cloud Run, Kubernetes, ECS) sepa cuándo una instancia está lista.
- **Sin CD ni contenedor** — significa que, literalmente, escalar horizontalmente hoy requeriría primero construir la capacidad de desplegar una sola instancia de forma repetible (Documento 1 §6/§8, ausencia de Docker/CD), antes de poder hablar de "2 instancias" o "10 instancias".

## 4. Flutter (cliente)

- El cliente no es, en sí mismo, un cuello de botella de escalabilidad de la plataforma (cada instalación es independiente) — el cuello de botella relevante es cuánta carga genera **por usuario** contra el backend/Firebase, no cuántos usuarios corran el cliente a la vez.
- **Firestore listeners:** el patrón de `snapshots()` (listeners en tiempo real) escala de forma nativa con el número de usuarios en la infraestructura gestionada de Google — no requiere ninguna acción del equipo de RidePro para escalar de 1K a 10M usuarios en ese eje específico. El límite real es de **costo** (facturación por lectura/escritura/almacenamiento de Firestore), no de capacidad — relevante a partir de varios millones de usuarios activos, es una conversación de presupuesto, no de arquitectura.
- Sin lazy-loading de rutas (Documento 4) — irrelevante para escalabilidad de plataforma, relevante solo para tiempo de arranque por dispositivo.

## 5. Firebase

- **Auth, Firestore, Storage, Messaging son servicios gestionados por Google, diseñados para escalar a decenas de millones de usuarios sin intervención de infraestructura del equipo** — no hay evidencia de un patrón de uso (fan-out masivo, documentos calientes con escritura concurrente muy alta) que rompa esto en el código inspeccionado. `ride_sessions` es append-only por usuario (sin contención entre usuarios distintos) — patrón que escala bien de forma nativa en Firestore.
- **El riesgo real de Firebase no es de escala, es operacional:** un único proyecto para todos los entornos (Documento 1 sección 6, Documento 3 sección 10) — a 10M usuarios reales conviviendo con tráfico de QA en el mismo proyecto, el riesgo de un evento QA/debug tocando datos reales por error crece, no decrece, con la escala.

## 6. Caché

- **No existe ninguna capa de caché de lectura (Redis u otra)** — aceptable a la escala actual (0 usuarios en producción), consistente con el principio ya aplicado en el proyecto de "no introducir Redis sin necesidad medida" (ADR-0001, mismo criterio anti-sobreingeniería). El primer consumidor real de caché sería previsiblemente el `ThrottlerStorage` (sección 3, necesario para escalar horizontalmente, no opcional) — momento natural para introducir Redis y, ya que está, evaluar cachear lecturas frecuentes de solo-lectura (p. ej., catálogo de equipamiento estándar, si existiera).

## 7. API

- Sobre de error único, validación estricta (`whitelist`/`forbidNonWhitelisted`, Documento 3) — buena base para una API pública de mayor volumen.
- **Sin versionado explícito verificado más allá del prefijo `/v1`** (mencionado en el plan de transición) — correcto tenerlo desde ahora; evita el problema clásico de romper clientes viejos al evolucionar el contrato a escala.
- Sin idempotencia (H3, Documento 2/3) — se vuelve más relevante, no menos, a mayor escala: con más tráfico, la probabilidad de timeouts ambiguos en la red aumenta proporcionalmente.

## 8. Archivos

- Sin código de negocio que suba/descargue archivos verificado en uso real todavía (Firebase Storage declarado, sin consumidor — Documento 2, sección 1.13) — no hay patrón de acceso a archivos que evaluar a escala porque no existe todavía.

## 9. Streaming / Video

- **No existe** (Documento 2, sección 1.8) — no aplica análisis de escalabilidad a algo que no está construido. Se deja como nota para el Documento 8 (Roadmap): si RidePro construye contenido de rutas en video (comparable a Zwift/ROUVY), la arquitectura de streaming (CDN, transcodificación, almacenamiento) es una decisión de infraestructura completamente nueva, no una extensión trivial de lo que existe — dimensionarla en el momento en que se priorice, no antes.

---

## 10. Proyección por nivel de usuarios (resumen narrativo)

- **1,000 usuarios:** la arquitectura actual (si estuviera desplegada) la soporta sin cambios. Ningún cuello de botella de esta lista se activa.
- **10,000 usuarios:** igual que el anterior. El pool de Postgres (10 conexiones) empieza a ser el primer parámetro a vigilar si el patrón de uso concentra picos (p. ej., muchos entrenamientos empezando a la misma hora).
- **100,000 usuarios:** momento razonable para: subir `DATABASE_POOL_MAX`, implementar paginación real en `equipment`/`workouts` (sección 2), y tener ya resuelto el despliegue reproducible (Docker/CD) — no como reacción a un incidente, sino porque a este volumen ya debería existir un entorno de producción real funcionando desde antes.
- **1,000,000 de usuarios:** requiere backend desplegado en más de una instancia → obliga a resolver el rate limiter en memoria (sección 3) primero. Es también el punto donde el costo de Firestore empieza a ser una línea de presupuesto que vale la pena monitorear activamente, no solo una preocupación técnica.
- **5,000,000 de usuarios:** caché de lectura (Redis) deja de ser opcional si hay cualquier endpoint de solo-lectura de alto tráfico (catálogos, rankings). Cola de trabajos en segundo plano necesaria si para entonces existen Estadísticas agregadas o Notificaciones (Documento 8).
- **10,000,000 de usuarios:** todo lo anterior debe estar resuelto. A este volumen, el monolito modular de NestJS sigue siendo defendible (Documento 1, sección 4, ADR-0001) **siempre que** el módulo con mayor carga de escritura (previsiblemente Estadísticas o Eventos, si se construyen) pueda extraerse a su propio servicio sin rediseñar límites de datos — que es exactamente la razón por la que la separación modular actual se preservó desde el día uno.

**Advertencia explícita:** esta sección es una proyección arquitectónica razonada, no un resultado de prueba de carga. Antes de tomar cualquier decisión de infraestructura basada en estos números, se recomienda una prueba de carga real contra un entorno de staging (que hoy no existe — Documento 1, sección 6).

---

## 11. Criterios de aprobación de este documento

- [x] Cubre los ejes pedidos: base de datos, backend, Flutter, Firebase, caché, API, archivos, streaming/video.
- [x] Proyección explícita sobre los 6 niveles de usuarios pedidos (1K/10K/100K/1M/5M/10M).
- [x] Cada cuello de botella con evidencia de código/configuración, no solo opinión.
- [x] Se distingue explícitamente análisis arquitectónico de medición real (no se declara ninguna cifra de capacidad como "medida").
- [ ] **No cumplido — declarado explícitamente:** sin prueba de carga real ejecutada — no hay entorno contra el cual correrla (ver sección 1).

**Siguiente documento:** Documento 6 — Arquitectura Multiplataforma.
