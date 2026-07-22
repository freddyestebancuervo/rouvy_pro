# Roadmap de desarrollo — M0/M1 a nivel de producción

**Estado actual:** Bloque A completo, Bloque B completo (B1-B3), y Bloque
C completo (C1-C5) implementado, verificado, **y auditado — fase
cerrada** (2026-07-21): npm audit (24→20 vulnerabilidades, las 2
resolubles sin breaking changes corregidas, resto documentado con
exposición real evaluada), revisión de seguridad/arquitectura/
rendimiento/duplicación/deuda técnica completa, incluyendo una condición
de carrera real (unicidad de email) encontrada y corregida con test de
concurrencia real. 36 tests (16 unit + 20 e2e) en verde. Ver "Cierre de
fase — Auditoría técnica del Bloque C" para el detalle completo.
**Bloque D en curso.** D1 (Equipamiento) y D2 (Entrenamientos)
implementados y verificados contra Postgres real: **125 tests (68 unit +
57 e2e)**, `lint`/`tsc --noEmit`/`build` limpios. D3 (Rutas) es la
siguiente prioridad — **no iniciada**.

**✅ Hallazgo crítico de proceso resuelto (2026-07-22):** el backend
completo (Bloque C + D1) estaba sin commitear desde hacía varias
sesiones — ver "Auditoría de mantenimiento post-D1" para el detalle
original. Se reconstruyó en 4 commits lógicos verificados uno por uno en
`git worktree` aislado (`feat(backend): complete Block C authentication`,
`feat(backend): implement Equipment module (D1)`,
`refactor(backend): extract shared postgres error utilities`,
`docs: synchronize technical documentation`) y se subieron a
`origin/main`. `main` está sincronizada con `origin/main`, sin cambios
pendientes de commitear (fuera de lo explícitamente diferido:
`.claude/settings.local.json` ahora ignorado en el `.gitignore` del
repo).

**D2 se desarrolló en la rama `feature/d2`** (creada desde `main` tras la
reconstrucción de historial) — **todavía no mergeada a `main`**. Ver
sesión "Implementación de D2 (Entrenamientos)" abajo.

## Fase de diseño — Bloque D (núcleo funcional del usuario) — 2026-07-22

Antes de escribir código del Bloque D se hizo la fase de diseño técnico
y de producto correspondiente (revisión del estado real del repo,
arquitectura de datos, endpoints, permisos, reglas de negocio, riesgos y
puntos de extensión) — documento completo en
`docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md`. Resumen de lo que cambia
respecto al roadmap original:

- **El Bloque D deja de ser "panel de administración"** y pasa a ser el
  núcleo funcional visible para el usuario: perfil (extensión),
  equipamiento, entrenamientos, actividades e historial, rutas, y
  métricas deportivas. El panel de administración no se descarta — se
  reordena, porque administrar contenido (rutas, usuarios) tiene más
  sentido una vez existe el núcleo de datos sobre el que administrar.
- **Todo lo nuevo va a PostgreSQL/NestJS, no a Firestore** — ningún
  dominio nuevo (equipamiento, entrenamientos, rutas reales, métricas)
  tiene hoy una colección Firestore que reconciliar. Solo Actividades
  tiene una contraparte Firestore existente (`users/{uid}/ride_sessions`,
  en producción); ahí se construye el endpoint NestJS pero **no** se
  migra el cliente Flutter en la misma tarea (decisión explícita, ver
  módulo 4 del documento de diseño).
- **Clases grupales, avatares y tiempo real NO se implementan en este
  bloque** — quedan como decisiones documentadas y puntos de extensión
  concretos (módulo 7 del documento de diseño), verificados uno a uno
  para confirmar que ninguno fuerza rediseñar las tablas nuevas de este
  bloque.
- Se identificó que "bicicletas/equipos" no existe en ningún lugar del
  código (ni Flutter ni backend) — es dominio completamente nuevo, a
  diferencia del resto de módulos que ya tienen alguna forma de
  implementación parcial (BLE local, catálogo mock, etc.) que este
  bloque completa o expone por HTTP.
- **Revisión 2 (2026-07-22):** el módulo de equipamiento se rediseñó por
  completo tras revisión — la primera versión modelaba "bicicletas" y
  "sensores" como dos tablas separadas, con un rodillo inteligente
  ambiguamente repartido entre ambas. Se reemplazó por un modelo
  **Equipment** único y polimórfico (`equipment_categories` +
  `equipment` + `equipment_ble_link`) donde incorporar una categoría
  nueva (zapatillas, ruedas, un rodillo de otra marca) es un `INSERT` en
  el catálogo de categorías, nunca un `ALTER TABLE` — ver módulo 2 del
  documento de diseño para el detalle completo, incluyendo las
  alternativas de diseño consideradas y descartadas.

**Primera tarea concreta recomendada: D1 — Equipamiento (CRUD completo,
modelo unificado).** Es el único módulo sin dependencias, desbloquea a
Entrenamientos/Actividades, y es la superficie donde se establece el
patrón de ownership compartido (helper de "recurso pertenece al usuario
autenticado") que el resto de módulos nuevos reutilizará. Detalle
completo, alternativas consideradas y por qué se descartaron, en la
sección 9 de `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md`.

## Sesión de implementación de D1 (Equipamiento) — 2026-07-22

Con el diseño aprobado, se implementó **D1 completo** — modelo de
datos, CRUD, ownership, y todas las pruebas obligatorias — **verificado
contra Postgres real** (mismo contenedor Docker de las sesiones de
Bloque C, `ridepro-postgres`, con las migraciones `0001`/`0002` ya
aplicadas), no solo con mocks:

- **Migración `0003_equipment.sql`**: `equipment_categories` (tabla de
  referencia, 8 filas sembradas: `bike`, `smart_trainer`, `power_meter`,
  `heart_rate_monitor`, `cadence_sensor`, `speed_sensor`,
  `speed_cadence_combo`, `other`) + `equipment` (núcleo polimórfico
  único, sin tabla por categoría) + 4 índices, incluyendo los dos que
  garantizan invariantes reales a nivel de base: `equipment_
  one_default_per_user_category` (único parcial, "máximo 1 default por
  categoría y usuario") y `equipment_user_ble_address_unique` (único
  parcial, "no duplicar el mismo sensor físico"). Aplicada limpia contra
  Postgres real: `CREATE TABLE` ×2, `INSERT 0 8`, `CREATE INDEX` ×4.
- **`src/common/ownership/assert-owned.util.ts`** (nuevo, compartido):
  helper de ownership extraído ANTES de escribir el primer módulo nuevo,
  según lo que ya preveía la decisión transversal 0.1.4 del documento de
  diseño — se usa dos veces dentro del propio módulo Equipment (ownership
  del recurso primario y de `parentEquipmentId` como campo relacionado),
  listo para que Entrenamientos/Actividades lo reutilicen sin
  reimplementarlo.
- **Módulo `equipment`** (`backend/src/modules/equipment/`):
  repository/service/controller/DTOs siguiendo la misma convención que
  `users` (C5) — `pg.Pool` directo sin ORM, `JwtAuthGuard` +
  `@CurrentUser()`, `ApiExceptionFilter` para el sobre de error único.
  Los 5 endpoints exactos del alcance (`POST/GET/GET:id/PATCH/DELETE
  /equipment`), sin rutas adicionales — `isDefault: true` (invariante de
  "un default por categoría") vive dentro de `PATCH` en vez de una ruta
  `set-default` separada, decisión documentada en la sección 2.14 de
  `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md`.
- **Validación de categorías contra la tabla real, no una lista
  hardcodeada en el DTO** — `EquipmentService.assertValidCategory`
  consulta `equipment_categories` en cada `create`/`list` filtrado; el
  DTO solo exige que `categoryCode` sea un string de 1-30 caracteres. Es
  la pieza que hace cierta la garantía central del diseño ("agregar una
  categoría nueva es un `INSERT`, nunca tocar código") — verificado con
  un test que rechaza una categoría inexistente (`shoes`) sin necesidad
  de tocar ningún archivo de código para que esa categoría exista de
  verdad más adelante.
- **`parentEquipmentId`** (auto-referencia opcional, profundidad máxima
  1 nivel): validado en `EquipmentService.resolveParentForWrite`,
  reutilizando `assertOwned` para el padre — rechaza padre ajeno, padre
  archivado, padre con su propio padre (2+ niveles), y auto-referencia.
  `null` explícito desasocia sin exigir ownership (no hay nada que
  validar de un `null`).
- **Invariante de "un default por categoría" bajo concurrencia real,
  no solo en el caso feliz** — mismo problema de fondo que ya resolvió
  C4 (rotación de refresh tokens) y con la misma técnica:
  `EquipmentRepository.applyDefault` toma un `SELECT ... FOR UPDATE`
  sobre **toda** la categoría del usuario (no solo la fila que se va a
  marcar) antes de desmarcar/marcar — sin ese lock de grupo, dos
  requests concurrentes marcando equipos DISTINTOS como default en la
  misma categoría podían terminar violando el índice único parcial en
  vez de serializarse. **Verificado con un test que dispara 5 PATCH
  realmente concurrentes** (`Promise.all`, 5 equipos distintos, misma
  categoría) contra Postgres real: las 5 requests responden `200`
  (se serializan correctamente por el lock, ninguna falla) y el estado
  final tiene exactamente 1 equipo con `isDefault: true` — mismo patrón
  de verificación que ya se usó en C4 y en la condición de carrera de
  email del cierre de Bloque C, no solo "debería funcionar en teoría".
  Como red de seguridad adicional (no como mecanismo principal), un
  23505 de esa constraint (o de `equipment_user_ble_address_unique`, para
  el caso de un `bleAddress` duplicado) se traduce a un `409` propio
  (`EQUIPMENT_DEFAULT_CONFLICT`/`EQUIPMENT_BLE_ADDRESS_ALREADY_
  REGISTERED`) en vez de un `500` genérico — mismo patrón
  `isUniqueViolation` que ya usa `AuthService.register`.
- **Soft-delete idempotente**: `DELETE /equipment/:id` archiva
  (`archived_at`, nunca borrado físico — una actividad futura podría
  referenciar el equipo) y NO falla si ya estaba archivado (llamar
  `DELETE` dos veces seguidas responde `204` ambas veces) — criterio
  REST estándar para operaciones idempotentes, ya usado en otras partes
  del proyecto. `PATCH` sobre un equipo archivado sí es un error
  explícito (`409 EQUIPMENT_ARCHIVED`, no `404`) — un archivado es un
  registro histórico de solo lectura, no "no encontrado".
- **35 tests nuevos** — 24 unitarios (`equipment.service.spec.ts`: 21,
  `assert-owned.util.spec.ts`: 3) + 21 e2e (`equipment.e2e-spec.ts`,
  contra Postgres real, solo 2 registros de usuario reutilizados en todo
  el archivo vía `beforeAll` para no acercarse al rate limit de
  `/auth/register`, 5 req/15min/IP). Cobertura explícita de lo pedido:
  401 sin token, 404 recurso inexistente, 404 (no 403) recurso ajeno
  (`GET`/`PATCH`/`DELETE`), validación de categoría inválida, validación
  de campos (nombre corto, `batteryLevel` fuera de rango), soft-delete +
  idempotencia, y concurrencia real del invariante de default.
  **Suite completa del backend: 81 tests (40 unit + 41 e2e), todos en
  verde** (subieron de 36). `npx tsc --noEmit`, `npm run lint` y
  `npm run build`: limpios.
- **Documentación actualizada en el mismo commit que el código** (regla
  del roadmap): `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md` sección 2 gana
  una sub-sección 2.14 "Desviaciones reales de implementación" —
  documenta explícitamente en qué difiere el código final del boceto de
  diseño (sin tabla `equipment_ble_link` separada; `metadata` en vez de
  `specs`; columna `status` nueva; campos de identidad de hardware
  nuevos; sin endpoints `set-default`/`pair-ble` dedicados; sin mapa de
  validación de `metadata` por categoría; `categoryCode` inmutable tras
  la creación) — cada desviación con su razón, no solo el diff.
- **Pendiente, no bloqueante para D1, candidato concreto para D2+**:
  mapa de validación de `metadata` por categoría (D1 solo valida que sea
  un objeto JSON plano); tabla `activity_devices`/lógica BLE avanzada de
  pairing (fuera de alcance explícito de esta tarea); D1 no tiene ningún
  consumidor todavía del lado Flutter (el cliente sigue sin tocar,
  mismo criterio de separar "existe el endpoint" de "el cliente ya lo
  usa" que el propio documento de diseño establece para Actividades).

## Auditoría de mantenimiento post-D1 — 2026-07-22

Antes de iniciar D2 se corrió el checklist de mantenimiento (proceso,
arquitectura, duplicación, sincronización de documentación) — sin escribir
funcionalidad nueva. Un hallazgo real corregido, uno crítico sin resolver
(bloqueante para el próximo paso, no para el estado del código):

- **Duplicación real encontrada y corregida**: `AuthService`
  (`isUniqueViolation`, Bloque C) y `EquipmentService`
  (`uniqueViolationConstraint`, D1) reimplementaban por separado la misma
  extracción defensiva de metadata de un error de `pg` (`code`/
  `constraint`, el driver no los tipa). Extraído a
  `src/common/database/pg-error.util.ts` (`pgErrorCode`,
  `pgConstraintName`, `isPgUniqueViolation`, + 5 tests unitarios nuevos),
  ambos servicios reescritos para usarlo. **Sin cambio de comportamiento**
  — verificado re-corriendo la suite completa después del refactor: los
  mismos 7/7 tests e2e de `auth.e2e-spec.ts`/`auth-email-race.e2e-spec.ts`
  y los 21/21 de `equipment.e2e-spec.ts` siguen en verde, más los 5 tests
  nuevos del helper. **Suite completa del backend: 86 tests (45 unit + 41
  e2e)**, todos en verde.
- **Revisión de arquitectura de módulos**: grafo de dependencias de
  NestJS confirmado ACÍCLICO — `AuthModule → UsersModule,
  RefreshTokensModule`; `UsersModule → RefreshTokensModule`;
  `EquipmentModule` sin imports (aislado, como preveía el diseño);
  `JwtModule`/`DatabaseModule` globales sin dependencias de módulos de
  dominio. Ningún import circular.
- **Migraciones verificadas contra el esquema real** (no solo "corrieron
  sin error"): `\d equipment` contra Postgres real confirma columna por
  columna, constraint por constraint e índice por índice contra
  `0003_equipment.sql` — sin drift. `0001`/`0002` también confirmadas
  (`\dt`, `users_email_lower_unique`).
- **🔴 Hallazgo crítico de proceso (no de código): cero commits desde
  antes del Bloque C.** `git log` solo tiene 2 commits, ambos de
  estabilización de Flutter (`7b5a238`, `2255483`), **anteriores a que
  existiera el backend**. Todo C1-C5 y D1 — auth, users, jwt,
  refresh-tokens, equipment, todas las migraciones, toda la suite de
  tests — vive únicamente en el working tree, sin ningún commit de
  respaldo. Es el mismo tipo de riesgo que ya causó la pérdida de
  historial documentada en la sesión de estabilización de Flutter
  ("recuperó `.git` desde la copia original en OneDrive") — no es
  hipotético en este proyecto, ya pasó una vez. **Recomendación
  entregada al usuario**: commitear en tandas lógicas (Bloque C completo
  como una unidad, D1 como otra) en vez de un solo commit gigante que
  mezcle 5+ sesiones de trabajo no relacionado — decisión pendiente de
  aprobación explícita antes de ejecutar ningún `git add`/`commit`.

## Reconstrucción de historial de Bloque C/D1 en 4 commits — 2026-07-22

Con el plan de la auditoría anterior aprobado, se reconstruyó el
historial real en 4 commits lógicos, **cada uno verificado de forma
aislada en `git worktree`** (checkout separado con solo el contenido
realmente commiteado hasta ese punto — ni un archivo de más filtrándose
desde el working tree) antes de avanzar al siguiente:

1. `feat(backend): complete Block C authentication` — auth/users/jwt/
   refresh-tokens/guards, migración 0002. 16 unit + 20 e2e.
2. `feat(backend): implement Equipment module (D1)` — migración 0003,
   módulo `equipment` completo. 40 unit + 41 e2e acumulado.
3. `refactor(backend): extract shared postgres error utilities` —
   dedup de `isUniqueViolation`/`uniqueViolationConstraint` en
   `pg-error.util.ts`, sin cambio de comportamiento. 45 unit + 41 e2e.
4. `docs: synchronize technical documentation`.

**Los dos archivos que mezclaban contenido de más de un commit lógico**
(`app.module.ts` — registra `EquipmentModule` recién en el commit 2;
`auth.service.ts`/`equipment.service.ts` — usan el helper compartido
recién en el commit 3) se resolvieron reescribiendo temporalmente su
contenido al estado exacto de cada commit (nunca moviendo archivos del
árbol) — más simple y seguro que partir con `git add -p` un archivo
nuevo sin historial previo. Cada worktree de verificación usó una
*junction* NTFS hacia `node_modules` (sin reinstalar) y una copia de
`.env`/`secrets/` (gitignored, necesarios para levantar la app).

Subido a `origin/main` sin incidentes. Cierre: se auditaron también los
3 archivos untracked restantes (`.claude/`,
`firebase/rules-tests/.gitignore`, `firebase/rules-tests/
package-lock.json`) — los 4 legítimos, ninguno artefacto local. Se
versionó `.claude/settings.json` (config de equipo, sin secretos), se
agregó `.claude/settings.local.json` al `.gitignore` del repo (antes
solo ignorado por el gitignore *global* del usuario, frágil para otros
clones), y se versionaron el `.gitignore`/lockfile faltantes de
`firebase/rules-tests/` (su `package.json` ya estaba trackeado desde
Bloque A). Commit `chore: version shared Claude Code config and firebase
rules-tests lockfile`, subido a `origin/main`. `main` quedó limpia y
sincronizada — confirmado con `git status`/`git log --oneline`.

## Implementación de D2 (Entrenamientos) — 2026-07-22

Sobre `main` ya limpia, se creó la rama `feature/d2` y se implementó
**D2 completo** siguiendo el plan aprobado, verificado contra Postgres
real:

- **Migración `0004_workouts.sql`**: `workouts` + `workout_intervals`,
  sin dependencias de otras tablas de Bloque D.
- **Tres decisiones de implementación tomadas durante la construcción**
  (documentadas en `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md` sección
  3.10, no silenciosas): `position` se deriva del índice del array
  recibido (nunca un campo del cliente); `estimated_duration_seconds` se
  calcula en el servidor como la suma de los intervalos; los intervalos
  quedan **inmutables tras la creación** (`PATCH` solo edita
  `name`/`description`/`isPublic` — para otra estructura, archivar y
  crear de nuevo).
- **Primer módulo de Bloque D con lectura cross-usuario real** — a
  diferencia de Equipment (D1, estrictamente `/me`-scoped), `GET`
  expone catálogo (`owner_id IS NULL`) y workouts marcados públicos por
  su dueño. Las escrituras (`PATCH`/`DELETE`) siguen siendo
  estrictamente del dueño: se reutilizó `assertOwned` **tal cual**
  (sin escribir una segunda función de ownership) mapeando
  `ownerId ?? '__catalog__'` — un sentinel que nunca coincide con un
  UUID real, así que un workout de catálogo o ajeno cae limpio en
  "no encontrado" para escritura.
- **Validación de `targetLow`/`targetHigh` por `targetType`** (power
  0-300, heart_rate 60-220, `none` sin ningún target permitido) en el
  servicio — DTO valida forma/rango genérico, la validación cruzada con
  el tipo del workout padre vive en `WorkoutsService`.
- **23 tests unitarios + 16 tests e2e nuevos**, todos en verde en el
  primer intento (sin fallos que corregir). Cobertura: 401, CRUD
  completo, visibilidad propio/público/catálogo/ajeno (incluyendo que un
  workout público ajeno es **visible pero no editable**), validación de
  intervalos (rango, `none` con target, array vacío), 409 sobre
  archivado, soft-delete idempotente. **Sin test de concurrencia
  dedicado** — a diferencia de Equipment, ninguna invariante compartida
  entre filas lo requiere.
- **Suite completa: 125 tests (68 unit + 57 e2e), todos en verde** —
  verificado dos veces: en el working tree y en un `git worktree`
  aislado del commit real. `lint`/`tsc --noEmit`/`build` limpios.
- **Commit** `feat(backend): implement Workouts module (D2)` en
  `feature/d2` — **sin mergear a `main` todavía**.
- **Nota de cobertura documentada, no un gap oculto**: la visibilidad de
  catálogo (`ownerId IS NULL`) no tiene forma de ejercitarse por HTTP
  (`POST /workouts` siempre asigna el dueño autenticado; crear una fila
  de catálogo real es tarea de un panel admin, fuera de alcance de D2,
  mismo criterio que Rutas/D3) — cubierto a nivel unitario con mocks, no
  en el e2e.

## Sesión de verificación — 2026-07-21

El entorno de trabajo cambió: ahora hay red, Node.js, Java (OpenJDK 21) y
`npx firebase-tools` disponible (sin instalación global) — lo que faltaba
en la sesión que dejó A3/C2 bloqueados. Docker y PostgreSQL **siguen sin
estar disponibles** en este entorno.

- **A3/A5 (reglas de Firestore) verificadas** ✅. `cd firebase/rules-tests
  && npm install && npx firebase-tools emulators:exec --config
  ../../firebase.json --project=demo-ridepro-security-tests --only
  firestore "npx jest --runInBand"` → **28/28 tests pasaron** (los 4
  ataques de escalada de privilegios + casos de control). Detalle en
  `docs/SECURITY_AUDIT.md` sección 8. `firestore.rules` queda listo para
  desplegar contra un proyecto Firebase real.
- **C2 (backend NestJS) sigue bloqueado** 🟡 — necesita una instancia de
  PostgreSQL (Docker o instalación local), ninguna de las dos disponibles
  en este entorno y ninguna se instaló sin autorización explícita (ver
  `VERIFICATION_GUIDE.md` Track 2 para los comandos exactos cuando haya
  Postgres accesible).
- **C3 sigue bloqueado.** El gate original ("C3 detenido hasta verificar
  ambos") no es arbitrario: C3 es código de backend (`POST /auth/register`,
  `POST /auth/login`) que solo se puede probar de verdad contra un
  Postgres real corriendo con la migración `0001_init.sql` aplicada —
  exactamente lo que C2 deja sin confirmar. Verificar A3 no cambia eso.
  Queda pendiente de un entorno con Docker o Postgres instalado.

## Sesión de estabilización — 2026-07-21

El proyecto Flutter no compilaba ni corría sus tests (errores de
`flutter analyze`, `flutter gen-l10n` fallando, dependencias
desactualizadas). Se dejó **compilando limpio, con la suite de tests
completa en verde** (166/166) y un bug real de navegación en producción
corregido. Detalle completo en el historial de la conversación; resumen:

- **Entorno:** resuelto bloqueo de permisos de Windows (atributo
  "solo lectura" heredado del ZIP en `lib/`, `lib/l10n/`,
  `lib/l10n/generated/`) que hacía fallar `flutter gen-l10n`/`pub get`.
  `l10n.yaml` limpiado (`synthetic-package` deprecado, removido).
- **8 errores de compilación corregidos** en `core/error/exceptions.dart`,
  `core/health/health_platform_gateway_impl.dart`,
  `core/platform/web_bluetooth_support_web.dart` (migrado de
  `dart:js_util`, eliminado del SDK, a `dart:js_interop`),
  `device_connection/domain/repositories/device_repository.dart`
  (imports rotos), `training/.../session_summary_page.dart` (override
  inválido de `build()` en `ConsumerState`), y un test de wearables.
- **Bug real de producción corregido:** en `login_page.dart`,
  `register_page.dart` y `email_verification_page.dart`, un
  `ref.listen` interpretaba la transición loading→data de la propia
  inicialización de `SocialAuthController`/`EmailVerificationController`
  (`build() async {}`) como "acción del usuario exitosa", disparando
  `context.go(home)` (o un snackbar de "correo reenviado") sin que el
  usuario hiciera nada. Corregido usando el `Future<bool>` que ya
  devuelve cada acción — mismo patrón que `_handleSubmit` ya usaba
  correctamente.
- **Gap real en modo demo corregido:** `RoutesRepository` nunca se
  registraba en `demo_injection.dart` — el catálogo de rutas caía en
  estado de error en modo demo. Se registró `RoutesRepositoryImpl`
  (ya 100% mock, sin Firebase — reutilizada tal cual).
- **`routerProvider` (`app_router.dart`) refactorizado:** reconstruía el
  `GoRouter` completo en cada emisión de `authStateProvider` (pierde
  stack de navegación). Ahora usa `refreshListenable` + lectura en vivo
  del auth state dentro de `redirect`.
- **Bugs de UI corregidos:** overflow de 78px en `login_page.dart`/
  `register_page.dart` (texto en español más largo que en inglés,
  `Row` → `Wrap`); `AppColors.success` no cumplía WCAG AA (4.4857:1,
  ajustado a 4.94:1); `TelemetryAggregator` perdía la integración de
  distancia/calorías en intervalos de exactamente 10s (`<` → `<=`).
- **Pendiente (deuda técnica registrada, no bloqueante):**
  migrar `Radio`/`RadioGroup` en `settings_page.dart` (decisión de
  diseño); validar contra Firebase real (sin credenciales en este
  entorno); pruebas de rendimiento (sin dispositivo/emulador
  disponible aquí).

## Sesión de estabilización (continuación) — 2026-07-21

Se retomó el proyecto desde una copia fuera de OneDrive
(`C:\proyectos\rouvy_proZIP\rouvy_pro`) que había perdido el historial
de git. Se recuperó `.git` desde la copia original en OneDrive (commit
`7b5a238`, el de la sesión de arriba) y se comparó archivo por archivo
contra el estado local: la copia local resultó ser, casi en su
totalidad, una **reversión accidental al estado previo a la
estabilización** (no trabajo nuevo) — incluía de vuelta el bug de
navegación fantasma, el `AppColors.success` fuera de WCAG AA, imports
rotos en `device_repository.dart`, y un `pubspec.yaml` con la clave
`health:` duplicada (rompía cualquier comando `flutter`). Se descartó
todo lo regresivo y se restauró el árbol de trabajo al commit estable
(respaldo del estado previo en la rama `backup/local-pre-limpieza-2026-07-21`,
no tocar).

Con el árbol ya limpio se hizo la primera verificación REAL de
compilación nativa de este proyecto (hasta ahora "compila limpio" solo
se había confirmado con `flutter analyze`/`flutter test`, que no tocan
Android nativo):

- **Scaffolding de Android nunca había estado completo en git** — faltaban
  `settings.gradle`, el wrapper de Gradle, `MainActivity`, `gradle.properties`
  y los recursos por defecto; solo estaban versionados los archivos editados
  a mano (`build.gradle`, `AndroidManifest.xml`, `google-services.json`,
  `GeneratedPluginRegistrant.java`). Se regeneró con `flutter create
  --platforms=android .` y se fusionó a mano la configuración específica
  del proyecto (plugin de `google-services`, `namespace`/`applicationId`
  placeholder con sus comentarios originales, `minSdk 26` por BLE) dentro
  de los nuevos `build.gradle.kts`/`settings.gradle.kts` (Kotlin DSL, el
  formato que ya trae el Flutter SDK de este entorno). Se eliminaron los
  `build.gradle` Groovy viejos (quedaban en conflicto con los `.kts`) y se
  corrigió el paquete de `MainActivity.kt` (`flutter create` lo generó en
  `com.ridepro.rouvy_pro`, pero el `namespace` real del proyecto es
  `com.ridepro.app` — no coincidir rompe el build).
- **Gradle 8.4 → 9.1.0**: AGP 9.0.1 (el que trae este Flutter SDK) exige
  Gradle ≥9.1.0. Actualizado en `gradle-wrapper.properties`.
- **AndroidX habilitado explícitamente** (`android.useAndroidX`/
  `android.enableJetifier=true` en `gradle.properties`) — faltaba, warning
  de Flutter.
- **`applicationId`/`google-services.json` siguen siendo placeholders a
  propósito** (`YOUR_APPLICATION_ID`, `YOUR_FIREBASE_PROJECT_ID`) — no se
  tocaron: configurar el proyecto Firebase real es una decisión de
  producto, no algo deducible del código (ver `SETUP_SOCIAL_LOGIN.md`).
- **`flutter build apk --debug`: ✅ compiló exitosamente** —
  `build/app/outputs/flutter-apk/app-debug.apk`. Primera verificación real
  de compilación nativa Android de todo el proyecto (hasta ahora "compila
  limpio" solo se había confirmado con `analyze`/`test`, que no tocan
  Gradle). Tras el fix, `flutter test` completo se volvió a correr
  (166/166 en verde) para confirmar que los cambios de Android/
  `settings_page.dart` no rompieron nada del lado Dart.
- **Pendiente real, no bloqueante:** el log de build muestra un warning de
  Flutter sobre plugins que aplican Kotlin Gradle Plugin directamente
  (`device_info_plus`, `firebase_analytics`, `health`,
  `sign_in_with_apple`) — versiones futuras de Flutter podrían dejar de
  compilar con estos si no se actualizan a "Built-in Kotlin". No es un
  error hoy, solo deuda a vigilar en `flutter pub outdated`.
- **Deuda de `Radio`/`RadioGroup` resuelta** (ya no pendiente): migrado
  `settings_page.dart` al widget `RadioGroup<T>` ancestro (API que
  reemplaza `groupValue`/`onChanged` por widget desde Flutter 3.32).
  Junto con la migración de `Color.red/green/blue` → `.r/.g/.b` en
  `core/utils/color_contrast.dart`, `flutter analyze --fatal-infos` (el
  gate exacto que usa `.github/workflows/ci.yml`) pasó de 15 issues a
  **0** — antes de este fix, CI habría fallado el paso `analyze` incluso
  sobre el commit "estable", porque nadie había corrido `analyze` con
  `--fatal-infos` localmente.
- **`test/widget_test.dart` eliminado**: boilerplate por defecto de
  `flutter create` (test de un contador contra una clase `MyApp` que no
  existe en este proyecto) — no pertenecía a la suite real y causaba un
  error de compilación en `flutter analyze`.
- **Aclaración sobre `RoutesRepository` y `demo_overrides.dart`**: no le
  faltaba nada. `RoutesRepository` se resuelve en producción y en demo vía
  GetIt (`sl()`, registrado en `demo_injection.dart`, ver sesión de
  arriba) — `demo_overrides.dart` solo cubre providers de Riverpod que
  producción resuelve con `Override`, un mecanismo distinto a propósito
  (ver el comentario al inicio de ese archivo). Nada que corregir ahí.

## Sesión de verificación Track 2 (C2) e implementación de C3 — 2026-07-21

El equipo se reinició con WSL2 instalado; Docker Desktop quedó
disponible (`docker ps` responde). Se ejecutó `VERIFICATION_GUIDE.md`
Track 2 completo:

- **C2 verificado** ✅ — contenedor `postgres:16` levantado vía Docker,
  migración `0001_init.sql` aplicada sin errores (6 `CREATE TABLE` reales:
  `users`, `roles`, `user_roles`, `refresh_tokens`, `ride_sessions`,
  `audit_log` — la guía tenía un conteo desactualizado de tablas/índices,
  corregido acá, no afecta el resultado), `npm run start:dev` +
  `GET /v1/health` → `{"status":"ok","database":"connected"}`, y
  `npm run test:e2e` → 1/1 en verde.
- **Bug de recursos corregido antes de seguir:** `AppController` creaba su
  propio `pg.Pool` fuera del ciclo de vida de Nest — nunca se cerraba al
  parar la app, causando el warning "Jest did not exit" del test e2e.
  Se introdujo `src/database/database.module.ts` (`DatabaseModule`,
  global, un único `Pool` inyectable vía `PG_POOL`) con un hook
  `onApplicationShutdown` que lo cierra; `AppController` ahora lo inyecta
  en vez de crear el suyo. Confirmado: el warning desapareció tras el fix.

Con C2 verificado, se implementó **C3 completa**
(`POST /auth/register` / `POST /auth/login`, sección 1.2 de
`docs/TECHNICAL_SPECIFICATION_M0_M1.md`), verificada con tests e2e reales
contra la misma instancia de Postgres (sin mocks):

- **`UsersRepository`/`RefreshTokensRepository`** (`pg.Pool` directo, sin
  ORM — misma decisión de C2). `findByEmail` compara case-insensitive
  (`LOWER(email)`) a nivel de aplicación: la única constraint real en
  `migrations/0001_init.sql` es `UNIQUE (email)`, sensible a mayúsculas;
  `idx_users_email_lower` es solo un índice, no impone unicidad. Cambiar
  la constraint es una migración nueva (fuera de alcance de C3); el
  chequeo en la app cierra el hueco sin tocar el esquema ya aplicado.
- **`TokenService`**: firma el JWT propio con RS256 (par de claves nuevo
  en `backend/secrets/jwt_{private,public}.pem`, generado con `openssl`,
  **no commiteado** — `secrets/` ya estaba en `.gitignore`), claims
  exactos de la spec sección 5.1 (`sub`, `roles`, `email_verified`, `iss`,
  `aud`, TTL configurable vía `JWT_ACCESS_TOKEN_TTL_SECONDS`). Emite el
  refresh token opaco (`rt_...`, hash SHA-256 persistido en
  `refresh_tokens`) — la spec no fija su TTL (solo el del access token);
  se usó 30 días como default explícito, configurable vía
  `JWT_REFRESH_TOKEN_TTL_DAYS`, documentado como decisión, no como dato
  literal del contrato.
- **`ApiExceptionFilter`** (global, `src/common/filters/`): traduce
  cualquier excepción al sobre único de la spec
  (`{ error: { code, message, requestId, details } }`), incluyendo las
  respuestas de `ValidationPipe` (`400 VALIDATION_ERROR`) y de
  `ThrottlerGuard` (`429 RATE_LIMITED`).
- **Rate limiting real**: `ThrottlerGuard` registrado como `APP_GUARD`
  global (antes solo estaba configurado el módulo, sin guard activo — no
  hacía nada). `@Throttle` en `register` con el valor exacto de la spec
  (5 req/15min/IP); `login` usa el mismo valor por analogía porque la spec
  solo documenta que `429` es una respuesta posible sin fijar un número —
  decisión explícita, no un dato literal del contrato.
- **Política de contraseña** server-side idéntica a
  `Validators.password` del cliente Flutter (8+ caracteres, 1 número, 1
  mayúscula) — la spec (sección 5.5) exige no confiar solo en la
  validación de UI.
- Hashing con `bcryptjs` (12 rounds) — se evitó `bcrypt` nativo para no
  depender de compilación con node-gyp en Windows.
- **Verificado manualmente** (`curl`) además de con tests: registro,
  login, email duplicado (`409 EMAIL_ALREADY_EXISTS`), password fuera de
  política (`400 VALIDATION_ERROR`), credenciales inválidas y usuario
  inexistente (ambos `401 AUTH_INVALID_CREDENTIALS`, mismo mensaje —
  evita enumeración de cuentas), y el `429 RATE_LIMITED` disparándose
  después de 5 requests.
- **`test/auth.e2e-spec.ts`** (nuevo, 6 tests) + el e2e de C2 → **7/7 en
  verde** contra Postgres real. Emails únicos por `randomUUID()` para
  poder correr la suite repetidas veces sin colisionar con datos de
  corridas anteriores; ≤4 llamadas a cada endpoint por archivo para no
  disparar su propio rate limit dentro de la suite.
- `npx tsc --noEmit`, `npm run lint` y `npm run build` — limpios, sin
  errores ni warnings nuevos.
- **Pendiente, no bloqueante:** `npm audit` reporta 24 vulnerabilidades
  (3 low, 13 moderate, 8 high) heredadas de dependencias de desarrollo de
  NestJS/Jest — no revisado en detalle en esta sesión, queda como deuda a
  auditar antes de producción (`npm audit` para el detalle completo).
  `GET/PATCH/DELETE /users/me` (protegidos por guard de JWT) siguen sin
  implementar — dependen de un guard de JWT que aún no existe;
  candidato natural para una tarea propia antes de D1.

## Sesión de implementación de C4 (rotación de refresh tokens) — 2026-07-21

Con C3 verificado, se implementó **C4 completa**: `POST /auth/refresh`
con rotación obligatoria y detección de reuso (spec sección 5.2), la
pieza que el roadmap ya marcaba como "la más fácil de hacer mal si se
implementa apurado" — por eso el detalle:

- **`RefreshTokensRepository.rotate()`** (nuevo): toda la decisión
  (rotar / reuso / expirado / no encontrado) vive en una única
  transacción con `SELECT ... FOR UPDATE` sobre la fila del token
  entrante. El lock es lo que hace la detección de reuso segura ante
  concurrencia: dos requests simultáneos con el MISMO token nunca pueden
  rotar en paralelo — el segundo espera el lock del primero y, al
  obtenerlo, ya encuentra la fila `revoked_at`, cayendo en la rama de
  reuso. **Verificado real, no solo en teoría:** 5 requests concurrentes
  con el mismo refresh token → exactamente 1 rotó (200), los otros 4
  cayeron en reuso (401), y la revocación en cascada dejó 0 tokens
  activos para ese usuario (confirmado contra la tabla `refresh_tokens`
  real). El token nuevo se genera SIEMPRE antes de intentar la rotación
  (operación local, sin costo si se descarta) — evita tener que inyectar
  un callback dentro de la transacción.
- **Reuso detectado ⇒ revocación total:** al recibir un token con
  `revoked_at` ya seteado, se revocan TODOS los refresh tokens activos
  de ese usuario en la misma transacción (spec 5.2, punto 4) y se loguea
  como warning (`AuthService`) — sin exponerlo al cliente: responde el
  mismo `401 REFRESH_TOKEN_INVALID_OR_REUSED` que un token inválido o
  expirado, para no darle a un atacante información sobre por qué falló.
- **Trade-off operacional real, encontrado en la verificación manual (no
  hipotético):** la detección de reuso no puede distinguir "atacante
  reproduciendo un token robado" de "el propio cliente reintentando la
  misma request por una falla de red" — un doble-submit accidental del
  cliente dispara la MISMA revocación total que un ataque real, forzando
  reautenticación completa. Es el comportamiento estándar de la
  industria para rotación de refresh tokens (mismo trade-off que OAuth
  2.0 Security BCP documenta), no un bug — pero es una razón concreta
  para que el cliente Flutter (`AuthRemoteDataSourceNestImpl`, cuando se
  implemente) serialice sus llamadas a `/auth/refresh` con un mutex en
  vez de permitir reintentos concurrentes. Dejado como nota para esa
  tarea futura, no bloqueante para C4 en sí.
- **Rate limit "20 req/15min/TOKEN"** (spec 1.2) — implementado en
  `RefreshThrottleGuard`, deliberadamente APARTE del `ThrottlerGuard`
  global: `ThrottlerModule.forRoot()` evalúa TODOS sus buckets nombrados
  contra TODAS las rutas de la app (confirmado leyendo el código fuente
  de `@nestjs/throttler`), así que un bucket "por token" ahí se
  aplicaría, con IP como fallback, también a endpoints sin refresh token
  de por medio — un footgun fácil de no notar. El guard dedicado
  reutiliza el mismo `ThrottlerStorage` inyectable que usa el resto de la
  app (mismo backend en memoria hoy, mismo camino a Redis en producción
  el día que se configure), solo que con una clave y un tracker propios,
  acotados a esta única ruta. Verificado con 21 requests reales → los
  primeros 20 pasan el guard, el 21 responde `429 RATE_LIMITED`.
- **`AuthService.refresh()`**: nuevo método — 5 tests unitarios
  (`auth.service.spec.ts`, con mocks, primer archivo de tests unitarios
  del proyecto — se agregó `backend/jest.config.js`, no existía
  configuración para `npm run test` separada de la de e2e) cubriendo
  rotación exitosa, `not_found`, `expired`, `reused`, y usuario borrado
  entre el lock y la lectura del perfil.
- **`test/auth-refresh.e2e-spec.ts`** (nuevo, 4 tests) contra Postgres
  real: rotación real + token viejo inservible, reuso real revocando el
  token vigente de la cadena, token inexistente, y el rate limit de 21
  requests. Archivo separado de `auth.e2e-spec.ts` a propósito — cada
  archivo `*.e2e-spec.ts` corre en su propia instancia de `AppModule`
  (Jest aísla el registro de módulos por archivo), así el test de rate
  limiting no consume ni es afectado por la cuota de `register`/`login`
  del otro archivo. **Suite completa: 5 unit + 11 e2e = 16 tests, todos
  en verde.** `tsc --noEmit`, `lint` y `build` limpios.
- **`GET/PATCH/DELETE /users/me`** siguen sin implementar (dependen de un
  guard de JWT que aún no existe) — candidato natural para antes de D1.
- **`npm audit`** queda pendiente a propósito para el cierre de esta fase
  (antes de preparar producción), según lo acordado — no se tocó en esta
  sesión.

## Sesión de implementación del guard de JWT (C5) — 2026-07-21

Con C4 verificado, se implementó el guard de autenticación y los tres
endpoints de perfil que dependían de él (`GET/PATCH/DELETE /users/me`,
spec sección 1.2):

- **Refactor de módulos antes de escribir el guard, no después:**
  `TokenService` vivía dentro de `AuthModule`, pero `JwtAuthGuard`
  (`UsersModule`) también lo necesita para *verificar* tokens — importar
  `AuthModule` desde `UsersModule` hubiera creado un ciclo, porque
  `AuthModule` ya importa `UsersModule` para `UsersRepository`. Se movió
  `TokenService` a un `JwtModule` nuevo, global (`src/jwt/`), y
  `RefreshTokensRepository` a su propio `RefreshTokensModule`
  (`DELETE /users/me` también necesita revocar tokens, mismo problema de
  ciclo). Ninguno de los dos cambios altera comportamiento — es
  reordenar límites de módulo antes de que la próxima pieza los fuerce
  de una forma peor.
- **`TokenService.verifyAccessToken()`** (nuevo): valida firma RS256,
  `iss` y `aud` contra la clave pública (`JWT_PUBLIC_KEY_PATH`) — la
  misma clave generada para C3, ahora usada por primera vez del lado de
  verificación, no solo de firma.
- **`JwtAuthGuard`**: exige `Authorization: Bearer <token>`, cuelga los
  claims en `req.user` (leído por el decorator `@CurrentUser()`). Sin
  código de error específico en la spec para fallas de auth genéricas —
  se usó `401 AUTH_TOKEN_MISSING_OR_INVALID` (decisión, no dato literal
  del contrato), consistente para: sin header, esquema no-Bearer, firma
  inválida, emisor/audiencia incorrectos, expirado, Y cuenta borrada
  (mismo código para no revelar cuál de esos casos ocurrió).
- **`role` singular vs. `user_roles` many-to-many:** la spec devuelve un
  único `"role"` en `GET /users/me`, pero el esquema real permite varios
  roles por usuario. Se resuelve con una prioridad explícita
  (`admin > coach > premium > user`) en vez de, por ejemplo, el primero
  que devuelva la query (no determinístico) — hoy no cambia nada
  observable (`register` solo asigna `'user'`), pero deja de romperse el
  día que un usuario tenga más de uno.
- **Validación de rangos duplicada a propósito en `UpdateProfileDto`**
  (`ftp` 0-1000, `weightKg` 20-300): son los mismos `CHECK` que ya existen
  en `users` (`migrations/0001_init.sql`) — sin este duplicado, un valor
  fuera de rango hubiera vuelto como `500` genérico de Postgres en vez de
  `400 VALIDATION_ERROR`.
- **`DELETE /users/me`**: soft delete (`deleted_at`) + revocación
  inmediata de todos los refresh tokens del usuario (spec 1.2/5.6) — **el
  job de borrado físico en segundo plano NO se implementó** (fuera de
  alcance de este endpoint; es infraestructura de scheduling propia,
  candidata a su propia tarea si se decide priorizarla).
- **Verificado manualmente además de con tests:** un JWT firmado con una
  clave privada DISTINTA a la del backend (par RSA generado al vuelo) es
  rechazado — confirma que `verifyAccessToken` valida la firma de verdad,
  no solo la forma del token.
- **14 tests unitarios nuevos** (`jwt-auth.guard.spec.ts`,
  `users.service.spec.ts`) + **6 tests e2e nuevos** (`users.e2e-spec.ts`,
  incluyendo el flujo real completo: registrar → `GET` perfil → `PATCH` →
  `DELETE` con confirmación → confirmar que el mismo access token ya no
  sirve y que el refresh token quedó revocado). **Suite completa: 14
  unit + 18 e2e = 32 tests, todos en verde.** `tsc --noEmit`, `lint` y
  `build` limpios.
- **Ajuste de lint:** `.eslintrc.js` no tenía configurada la convención
  de "parámetro `_prefijo` = intencionalmente sin usar" — se agregó
  (`argsIgnorePattern: '^_'`), la necesitó `DeleteAccountDto` en el
  controller (el body solo existe para que `ValidationPipe` exija
  `confirm: true`, el handler no lee su valor).

## Cierre de fase — Auditoría técnica del Bloque C — 2026-07-21

Con C1-C5 implementados y verificados individualmente, se hizo el cierre
profesional de la fase: auditoría completa (dependencias, seguridad,
arquitectura, rendimiento, duplicación, deuda técnica), corrección de lo
resoluble sin romper compatibilidad, y una segunda pasada completa de
verificación. `npm audit` quedó para el final de esta auditoría, según lo
acordado.

### Hallazgos, clasificados por severidad

**Crítico:** ninguno.

**Alto:**
1. **Condición de carrera en unicidad de email** (`AuthService.register`
   / `UsersRepository`) — dos registros concurrentes con el mismo email
   en distinto case ("Rider@x.com"/"rider@x.com") pasaban ambos el
   chequeo de aplicación (`findByEmail`, ninguno existe todavía en el
   instante de la lectura) antes de que cualquiera insertara, pudiendo
   crear dos cuentas duplicadas para el mismo email real. Mismo patrón de
   bug que ya se había resuelto con locking para la rotación de refresh
   tokens (C4), pero sin cerrar acá. **Corregido**: migración
   `0002_users_email_case_insensitive_unique.sql` (índice ÚNICO sobre
   `LOWER(email)`, reemplaza al índice no-único de 0001) + traducción del
   `23505 unique_violation` resultante a `409 EMAIL_ALREADY_EXISTS` en
   `AuthService.register`. **Verificado con un test que dispara 2
   requests HTTP realmente concurrentes** (`Promise.all`) contra Postgres
   real — antes del fix este test hubiera sido flaky/hubiera podido
   crear 2 cuentas; después, determinísticamente 1 gana (201) y 1 pierde
   (409).
2. **24 vulnerabilidades de `npm audit`** (3 low, 13 moderate, 8 high) —
   ver desglose y decisión en la sección siguiente.

**Medio (todos corregidos):**
- Sin headers de seguridad HTTP (`helmet` no estaba instalado) —
  agregado, con CSP/COEP desactivados a propósito (API JSON pura para
  app móvil, esas políticas son para servir HTML en navegador).
- `trust proxy` no configurado — `req.ip` (base del rate limiting por
  IP) sería incorrecto detrás de un load balancer real en producción.
  Agregado vía `TRUST_PROXY=true` (opt-in, nunca por defecto — activarlo
  sin un proxy real permitiría falsificar la IP de origen con un header).
- Pool de conexiones (`max`/`idleTimeout`/`connectionTimeout`) y SSL
  hardcodeados, sin forma de ajustarlos para producción sin tocar código
  — ahora configurables vía `DATABASE_POOL_MAX`/`DATABASE_IDLE_TIMEOUT_MS`/
  `DATABASE_CONNECTION_TIMEOUT_MS`/`DATABASE_SSL` (mismos defaults si no
  se definen).
- DTOs (`RegisterDto`/`LoginDto`/`RefreshDto`) sin `@MaxLength` — un
  payload "email"/"password"/"refreshToken" arbitrariamente largo pasaba
  la validación y solo fallaba (o generaba trabajo de CPU innecesario en
  bcrypt) más adelante. Acotados a los mismos límites que ya existen en
  el esquema (`VARCHAR(255)` para email) o a valores razonables (128 para
  contraseñas, 512 para el refresh token opaco de 67 caracteres reales).
- Duplicación de código: el `throw` de `AUTH_INVALID_CREDENTIALS`
  aparecía dos veces idéntico en `AuthService.login`; el bootstrap de
  test e2e (`ValidationPipe` + `ApiExceptionFilter` + prefijo `/v1`) se
  repetía línea por línea en 4 archivos. Ambos factorizados
  (`AUTH_INVALID_CREDENTIALS()` y `test/utils/test-app.ts`).
- Documentación desactualizada: el docblock de `app.e2e-spec.ts` seguía
  diciendo "no ejecutado en el entorno donde se escribió" (cierto en la
  sesión original de C2, falso desde Track 2); la copia del DDL en
  `docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 2.2 no reflejaba la
  migración 0002; `VERIFICATION_GUIDE.md` pedía Node 18+ pero el fix de
  `file-type` (abajo) sube el mínimo real a Node 20+. Los tres
  corregidos.

**Bajo (documentados, sin corregir — no ameritan el riesgo/esfuerzo en
esta fase):**
- 2 queries separadas (`findByEmail`/`findById` + `findRoleNames`) en
  vez de un `JOIN`, en cada login/register/refresh — impacto
  insignificante al volumen de tráfico actual.
- `SELECT *` en las lecturas de `users` trae `password_hash` incluso en
  rutas que nunca lo necesitan (ej. `GET /users/me`) — no es una fuga (no
  sale en la respuesta, se descarta al mapear), pero es innecesario.
- `node-pg-migrate` (herramienta de migraciones, en `devDependencies`)
  nunca se usó realmente — las migraciones se aplicaron siempre a mano
  vía `psql -f` (ver `VERIFICATION_GUIDE.md`), así que no hay tabla
  `pgmigrations` trackeando qué se aplicó. Si en algún momento se decide
  usar `node-pg-migrate` de verdad, hay que reconciliar el estado a mano
  primero.
- El email de una cuenta con soft-delete queda reservado
  permanentemente (el índice único, igual que la constraint original de
  0001, no es parcial por `deleted_at IS NULL`) — comportamiento
  preexistente desde C2/C3, no introducido ni empeorado en esta sesión;
  cambiarlo es una decisión de producto (¿debe un email liberarse tras el
  período de gracia de 30 días de 5.6?), no un bug de esta fase.
- Sin CORS configurado — no aplica hoy (backend consumido por la app
  móvil nativa, no por un navegador), pero va a hacer falta el día que
  Bloque D sume un panel de administración web.
- La spec (5.5) pide rechazar HTTP plano incluso en desarrollo — no
  implementado a nivel de proceso Node a propósito: forzar TLS ahí
  hubiera roto todo el flujo de verificación actual (`VERIFICATION_GUIDE.md`,
  los 36 tests e2e, `curl` manual) sin necesidad, cuando el patrón real de
  despliegue (terminación TLS en el load balancer, no en el proceso
  Node) ya cubre el objetivo de forma más estándar. Decisión, no omisión.

### `npm audit` — decisión detallada

Las 24 vulnerabilidades originales se reducen, todas, a 3 cadenas de
dependencias:

1. **`@nestjs/config` → `lodash`** (alta/moderada, dependencia de
   producción) — **corregido**: bump a `@nestjs/config@4.0.4` (peer
   `@nestjs/common ^10.0.0 || ^11.0.0`, compatible con nuestro `10.4.22`
   sin tocar el resto del framework). `lodash` resuelto a `4.18.1`.
2. **`@nestjs/common` → `file-type`** (moderada) — `file-type` está
   hard-pineado por `@nestjs/common` y solo lo usa `FileTypeValidator`
   (validación de uploads de archivo vía `ParseFilePipe`), una feature
   que este backend no usa en ningún endpoint — exposición real: cero.
   **Corregido igual, por prolijidad**: `overrides.file-type` en
   `package.json` a `21.3.4` (no la última, `22.x`, que exige Node ≥22;
   `21.3.4` solo exige Node ≥20, ya el mínimo real de CI). Verificado que
   sigue siendo ESM (`"type": "module"` en ambas versiones — no es un
   cambio de CJS a ESM lo que podría romper el `require()` interno de
   Nest).
3. **`@nestjs/cli`/`@angular-devkit/*`/`webpack`/`glob`/`inquirer`/`tmp`/
   `picomatch`/`ajv`** (dev-only, cadena de build tools) y
   **`@nestjs/core`/`@nestjs/platform-express`/`@nestjs/testing`** (con
   `body-parser`/`express`/`multer`/`qs`) — **NO corregidas, riesgo
   aceptado documentado, no un descuido**:
   - La cadena de `@nestjs/cli` es exclusivamente de build/desarrollo
     (nunca corre en el proceso servido); los CVEs específicos (glob CLI
     `-c/--cmd`, webpack `buildHttp`) requieren invocar flags/features que
     ningún script de este proyecto usa.
   - La cadena de `@nestjs/core`/`platform-express` SÍ es runtime, pero
     los CVEs son de denegación de servicio (no RCE ni fuga de datos), y
     la exposición real está reducida: `multer` (manejo de multipart) no
     se usa en ningún endpoint (no hay subida de archivos); las rutas
     públicas ya están rate-limitadas (5-20 req/ventana); `ValidationPipe`
     con `whitelist`/`forbidNonWhitelisted` rechaza payloads con forma
     inesperada antes de llegar a lógica de negocio.
   - La corrección real (`@nestjs/core`/`platform-express`/`testing`/`cli`
     de v10 a v11, **major** en las 4 a la vez) es un proyecto de
     migración propio — cambios de comportamiento de Express, superficie
     de breaking changes real — no algo para colar dentro de un cierre de
     auditoría. **Recomendación explícita**: programar la migración a
     NestJS v11 como tarea dedicada, con su propia sesión de regresión
     completa, antes de preparar producción real (no antes de Bloque D).
   - **Quedan 20 vulnerabilidades** (3 low, 10 moderate, 7 high) tras
     esta sesión — bajaron de 24, documentadas y con exposición real
     evaluada explícitamente arriba, no un número que se ignora.

### Verificación final

`npx tsc --noEmit`, `npm run lint` y `npm run build`: limpios. Suite
completa: **16 unit + 20 e2e = 36 tests, todos en verde** (subieron de 32
por los 4 tests nuevos del fix de la carrera de email). Pruebas manuales
adicionales contra el servidor real: headers de `helmet` presentes y
`X-Powered-By` ausente; flujo completo registro → `GET /users/me` →
`refresh` (rotación, tokens nuevos ≠ viejos) → reuso del token viejo
(401, revoca en cascada) → el token que hasta ese momento había sido
válido también rechazado; rate limiting de `login` cortando exactamente
en el 6º intento (5 permitidos).

### Estado final del Bloque C

**C1-C5 implementados, verificados, y ahora auditados — fase cerrada.**
Ningún hallazgo Crítico. El único hallazgo Alto no relacionado a
dependencias (condición de carrera de email) está corregido y probado
bajo concurrencia real. La deuda de dependencias restante (20
vulnerabilidades, todas en dos cadenas conocidas) está documentada con
exposición real evaluada, no oculta. Bloque D puede arrancar sobre esta
base.

Basado en `docs/TECHNICAL_SPECIFICATION_M0_M1.md`. Cada tarea es lo
bastante pequeña para completarse en una sesión de trabajo concreta, en
el orden en que deben abordarse (las posteriores asumen que las
anteriores ya están hechas).

## Bloque A — Endurecer lo que ya existe (sin tocar arquitectura)

- [x] **A1. Habilitar persistencia offline de Firestore** ✅ Implementado.
  Una línea en `main.dart` (`FirebaseFirestore.instance.settings = ...`,
  ver spec sección 7.1). Resuelve el cuello de botella #1. Se amplió con
  un servicio de estado de sincronización observable
  (`core/sync/FirestoreSyncService`) y un banner global
  (`ConnectivitySyncBanner`) — comportamiento completo documentado en
  `docs/OFFLINE_FIRST.md`, incluyendo el protocolo de verificación manual
  y la cobertura de tests automatizados.

- [x] **A2. Añadir el campo `role` a `users/{uid}`** ✅ Implementado.
  `UserRole` enum (`user`/`premium`/`coach`/`admin`) añadido a
  `UserEntity`. `UserModel.fromMap` lee `role` con fallback seguro a
  `user` para documentos previos a esta tarea; `UserModel.toMap` NUNCA
  incluye `role` — es de solo lectura desde el cliente por diseño (doble
  protección: el cliente no lo escribe Y las reglas de Firestore lo
  bloquearían igual, ver A3). Script de backfill idempotente en
  `firebase/scripts/backfill_user_roles.js`, pendiente de ejecutarse
  contra el proyecto de Firebase real (requiere credenciales que no
  existen en este entorno).

- [x] **A3. Desplegar `firestore.rules` versionado** ✅ Implementado y
  **verificado** (2026-07-21) — 28/28 tests en verde contra el emulador
  real. Se encontró y corrigió una vulnerabilidad crítica de escalada de
  privilegios (la regla de `create` no validaba contenido) — ver
  `docs/SECURITY_AUDIT.md` para el análisis completo y el resultado de la
  ejecución (sección 8). Archivo real en `firestore.rules` (raíz), tests
  de seguridad en `firebase/rules-tests/`. Listo para desplegar con
  `firebase deploy --only firestore:rules` contra un proyecto Firebase
  real.

- [x] **A4. Declarar `firestore.indexes.json`** ✅ Implementado (ya existía,
  el checkbox no se había actualizado — corregido ahora).
  `firestore.indexes.json` en la raíz, versiona el índice de
  `ride_sessions.startTime`. No requiere verificación de ejecución
  separada — es un archivo de configuración declarativo, Firestore lo
  aplica al desplegar (`firebase deploy --only firestore:indexes`), no
  hay "test" que correr para un índice en sí.

- [x] **A5. Tests de reglas de seguridad** ✅ Implementado y verificado
  (mismo archivo y misma ejecución que A3 —
  `firebase/rules-tests/firestore.rules.test.js` ya cubre exactamente lo
  que A5 pedía: lectura cruzada entre usuarios, `role`/`premium`
  protegidos, escritura de perfil propio permitida). No era una
  verificación aparte, es la misma suite.

## Bloque B — Cerrar huecos funcionales de M1 ya identificados

- [x] **B1. Snapshot de sesión activa en `shared_preferences`** ✅ Implementado.
  `RideSessionSnapshotLocalDataSource` guarda un snapshot cada 10s
  mientras la sesión está activa (`elapsedSeconds`, distancia, calorías,
  nº de dispositivos). `TrainingHudPage` comprueba al entrar si hay uno
  recuperable (más reciente que 3h) y ofrece un diálogo
  "Descartar"/"Continuar sesión" en vez de perderla en silencio.
  `TelemetryAggregator.seed()` (aditivo, no rompe sus tests existentes)
  permite continuar acumulando distancia/calorías desde el valor
  recuperado. Tests: datasource (persistencia/expiración) + controlador
  (`resumeFromSnapshot`, limpieza al finalizar).

- [x] **B2. Límite de tiempo total de reintento BLE** ✅ Implementado.
  `_DeviceSession.firstDisconnectAt` + `_maxTotalReconnectDuration` (10
  min) en `ble_datasource.dart` — además del límite de 6 intentos ya
  existente, ahora también se detiene si el ciclo de reconexión lleva
  más de 10 minutos corriendo, independientemente de cuántos intentos
  haya consumido el backoff. **Sin test automatizado dedicado** — mismo
  motivo que el resto de `BleDataSourceImpl` (depende de
  `flutter_blue_plus`/plataforma real, no mockeable sin refactorizar a
  inyectar un reloj; limitación preexistente del módulo, no nueva de
  esta tarea).

- [x] **B3. Mensaje contextual tras fallos repetidos de HealthKit** ✅ Implementado.
  `HealthPackageAdapter` cuenta fetches vacíos consecutivos;
  `emptyFetchesHintMessage` sugiere revisar Ajustes tras 3 seguidos,
  **solo** para Apple Health en iOS (Health Connect en Android confirma
  el permiso de forma fiable, no hay ambigüedad que aclarar).
  `WearableConnection.advisoryMessage` (campo nuevo, informativo — nunca
  de error) lo expone hasta `WearableProviderTile`. El chequeo de
  plataforma se hizo inyectable (`isIOS: () => ...`) para que fuera
  realmente testeable — `Platform.isIOS` de `dart:io` nunca es `true` al
  correr `flutter test` en un host normal, así que sin esa inyección el
  caso "estamos en iOS" habría sido imposible de probar (se detectó al
  escribir el propio test).

## Bloque C — Preparar el terreno para el backend NestJS objetivo

*No implica escribir el backend todavía — solo dejar el contrato ya
codificado del lado cliente para que la migración futura sea un cambio de
datasource, no una reescritura de features.*

- [x] **C1. Extraer una interfaz `AuthApiContract` documentada en código** ✅ Implementado.
  Dartdoc en `AuthRepository` con la tabla completa método → endpoint
  REST objetivo, enlazando a la sección 1.2 de la spec.

- [x] **C2. Scaffold del backend (`backend/` en el monorepo)** ✅ Implementado
  y **verificado** (2026-07-21) contra Postgres real (Docker) — 1/1 test
  e2e en verde, `GET /v1/health` confirmado con `curl`. NestJS + `pg.Pool`
  directo (sin ORM, decisión deliberada), migración `0001_init.sql`
  aplicada sin errores. Ver sesión "Verificación Track 2 / C3" arriba
  para el detalle completo, incluyendo el fix del pool de conexiones que
  no se cerraba al apagar la app.

- [x] **C3. Implementar `POST /auth/register` y `POST /auth/login`** ✅
  Implementado y **verificado** (2026-07-21) — contrato exacto de la
  sección 1.2 (incluyendo el sobre de error estándar), JWT RS256 real
  (sección 5.1), rate limiting por endpoint, política de contraseña
  server-side. 7/7 tests e2e en verde contra Postgres real + verificación
  manual de todos los códigos de error del contrato. Ver sesión
  "Verificación Track 2 / C3" arriba para el detalle completo y las
  decisiones documentadas (TTL de refresh token, límite de rate limiting
  en `login`, dedupe de email case-insensitive).

- [x] **C4. Implementar rotación de refresh tokens** ✅ Implementado y
  **verificado** (2026-07-21) — sección 5.2 completa (rotación + detección
  de reuso con revocación total), incluyendo el caso de concurrencia real
  (5 requests simultáneos con el mismo token → exactamente 1 rotó, el
  resto cayó en reuso). 5 tests unitarios + 4 tests e2e dedicados. Ver
  sesión "Implementación de C4" arriba para el detalle completo,
  incluyendo el trade-off operacional de reintentos concurrentes del
  cliente (documentado para la futura integración de Flutter con este
  backend).

- [x] **C5. Guard de JWT + `GET/PATCH/DELETE /users/me`** ✅ Implementado y
  **verificado** (2026-07-21) — no estaba enumerada como tarea propia en
  este roadmap (la dejó pendiente la sesión de C4, "candidato natural
  para una tarea propia antes de D1"), pero era el bloqueo real para D1
  (`GET /admin/users` también necesita un guard de auth) y para que
  `register`/`login`/`refresh` tuvieran algún consumidor protegido que
  los ejercite de punta a punta. Ver sesión "Guard de JWT" arriba para el
  detalle completo.

**Bloque C auditado y cerrado** (2026-07-21) — ver sesión "Cierre de
fase — Auditoría técnica del Bloque C" arriba: npm audit, seguridad,
arquitectura, rendimiento, duplicación y deuda técnica revisados; un
hallazgo Alto (condición de carrera en unicidad de email) encontrado y
corregido con test de concurrencia real; 36 tests en verde.

## Bloque D — Núcleo funcional del usuario (dependiente de C)

*Diseño completo (modelo de datos, endpoints, permisos, validaciones,
reglas de negocio, tests, riesgos, dependencias, criterios de aceptación
y decisiones para escalar de cada módulo) en
`docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md`. El orden de abajo respeta las
dependencias reales entre módulos (sección 9 del documento) — no
reordenar sin revisar esa sección primero.*

- [x] **D1. Equipamiento** (bicicletas, entrenadores inteligentes,
      sensores BLE, unificados) ✅ Implementado y **verificado**
      (2026-07-22) contra Postgres real — modelo polimórfico completo
      (`equipment_categories` + `equipment`, migración `0003`; sin tabla
      `equipment_ble_link` separada, ver decisión documentada en
      `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md` sección 2.14) más el
      helper de ownership compartido (`assertOwned`) que reutilizarán
      D2-D5. 5 endpoints exactos del alcance
      (`POST/GET/GET:id/PATCH/DELETE /equipment`), invariante de "un
      default por categoría" verificada con concurrencia real (5 PATCH
      simultáneos, `SELECT ... FOR UPDATE` sobre la categoría completa),
      soft-delete idempotente. 24 tests unitarios + 21 e2e nuevos (81
      tests totales en el backend, antes 36). Ver sesión "Implementación
      de D1 (Equipamiento)" arriba para el detalle completo.

- [x] **D2. Entrenamientos** ✅ Implementado y **verificado**
      (2026-07-22) contra Postgres real, en la rama `feature/d2`
      (**sin mergear a `main` todavía**) — modelo de entrenamientos
      estructurados con intervalos (`workouts`/`workout_intervals`,
      migración `0004`, sin dependencias). Primer módulo con lectura
      cross-usuario real (catálogo + workouts públicos), intervalos
      inmutables tras la creación, `position`/`estimated_duration_seconds`
      derivados en el servidor. 23 tests unitarios + 16 e2e (125 tests
      totales en el backend, antes 86). Ver sesión "Implementación de D2
      (Entrenamientos)" arriba para el detalle completo.

- [ ] **D3. Rutas** — catálogo real en Postgres (`routes`, migración
      `0005`, sin dependencias) que reemplaza el `RoutesMockDataSource`
      actual. Tiene una decisión de producto pendiente de confirmar
      (ocultar vs. marcar como bloqueado el contenido premium) — ver
      módulo 5 del documento de diseño antes de implementar.

- [ ] **D4. Perfil de usuario (extensión)** — nuevos campos en `users`
      (`preferred_units`, `max_heart_rate`, `onboarding_completed_at`;
      migración `0007`, sin dependencias — ya no incluye
      `default_bike_id`: con Equipment unificado, "el equipo default de
      una categoría" se resuelve con una consulta, no con una FK
      duplicada en `users`). 100% aditivo sobre el contrato ya
      implementado en C5, sin romper los 32 tests de perfil existentes.

- [ ] **D5. Actividades e historial** — expone por HTTP la tabla
      `ride_sessions` (existe desde C2, sin ningún endpoint hasta hoy) y
      la extiende con `equipment_id`/`workout_id`/`route_id` (migración
      `0006`, dependiente de D1, D2 y D3). Decisión explícita: esta
      tarea **no** migra el datasource Flutter de Firestore — eso queda
      como tarea de producto separada, a futuro.

- [ ] **D6. Métricas deportivas** — agregación SQL de estadísticas
      (`GET /metrics/summary`, `/metrics/zones`) y récords personales
      (`personal_records`, migración `0008`, dependiente de D4 y D5).

- [ ] **D7. Preparación futura (clases grupales, avatares, tiempo
      real)** — no implementa nada; es la verificación explícita (sección
      7 del documento de diseño) de que ninguna de esas tres features
      futuras obliga a rediseñar D1-D6. Se marca como "hecha" en cuanto
      esa verificación quede documentada — no requiere código.

**Trabajo pendiente ya identificado, no bloqueante para D1:** el panel de
administración original (`GET /admin/users`) no se descarta, se reordena
— vuelve a tener sentido una vez el núcleo de datos de D1-D6 exista sobre
qué administrar (D3 en particular ya señala la necesidad operativa
concreta: sin panel, cargar/editar el catálogo de rutas exige
migraciones SQL manuales).

---

## Cómo usar este roadmap

Cada tarea, al completarse, debe:
1. Marcarse como hecha en este archivo (editar el checkbox).
2. Si cambia algo del contrato documentado en
   `docs/TECHNICAL_SPECIFICATION_M0_M1.md`, actualizar esa sección en el
   mismo commit — la spec y el código no deben divergir.

El Bloque A es puramente aditivo y de bajo riesgo (no cambia contratos
existentes) — es el punto de entrada recomendado antes de tocar nada del
Bloque C, que sí implica una pieza de infraestructura nueva.
