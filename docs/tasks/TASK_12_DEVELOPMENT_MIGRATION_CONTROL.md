# Task 12 — Development Migration Control Design

> **Documento de diseño únicamente.** Ninguna migración fue ejecutada, ninguna
> base de datos fue mutada, y `.github/workflows/backend-deploy-development.yml`
> no fue modificado para producir este documento. La implementación real queda
> explícitamente fuera de alcance (sección 15) y requiere autorización separada.

- **Fecha:** 2026-08-16
- **Autor:** Ejecutor técnico (diseño, Tarea #12)
- **`main` auditado:** `e836aa3ebb6edea18f1d1f2d3903203036213986`
- **Workflow auditado:** `.github/workflows/backend-deploy-development.yml` (tal como quedó tras la Tarea #11 — cadena de trazabilidad `SOURCE_SHA → imagen → digest → deploy` ya probada en runtime)

---

## 1. Estado actual verificado

Todo lo siguiente fue confirmado por lectura directa contra `origin/main` y,
donde se indica, contra el proyecto GCP real `ridepro-development` (consultas
`gcloud ... describe`/`get-iam-policy`, estrictamente de solo lectura, sin
leer valores de secretos).

### 1.1 Sistema de migraciones

| Hecho | Valor verificado |
|---|---|
| Herramienta | `node-pg-migrate` |
| Versión declarada (`package.json`) | `^7.6.1` |
| Versión resuelta (`package-lock.json`, instalada localmente) | `7.9.1` |
| Clase de dependencia | **`devDependency`** — no `dependency` |
| Directorio de migraciones | `backend/migrations` |
| Cantidad de archivos | **5** |
| Archivos | `0001_init.sql`, `0002_users_email_case_insensitive_unique.sql`, `0003_equipment.sql`, `0004_workouts.sql`, `0005_users_firebase_uid.sql` |
| `migrate:up` | `npm run migrate:up` → `node-pg-migrate up -m migrations` |
| `migrate:down` | `npm run migrate:down` → `node-pg-migrate down -m migrations` |
| Tabla de tracking (default de la herramienta, en uso) | `pgmigrations` |

### 1.2 Imagen runtime de Cloud Run (`backend/Dockerfile`, stage `runtime`)

| Hecho | Valor verificado |
|---|---|
| Base | `node:20-alpine` |
| Instalación | `npm ci --omit=dev` (excluye TODAS las `devDependencies`) |
| Contenido copiado | únicamente `dist/` (compilado desde el stage `build`) |
| `backend/migrations/` presente en la imagen | **NO** |
| `node-pg-migrate` presente en la imagen | **NO** (es `devDependency`, `--omit=dev` la excluye) |
| Entrypoint | `node dist/main.js` |

**`RUNTIME_IMAGE_HAS_MIGRATOR = NO`**
**`RUNTIME_IMAGE_HAS_MIGRATION_FILES = NO`**

Consecuencia directa: **no se puede asumir que `npm run migrate:up` es
ejecutable dentro de la imagen que Cloud Run despliega hoy.** Cualquier
diseño que dependa de correr el migrador *desde* esa imagen es inválido sin
antes modificar el Dockerfile — cambio explícitamente fuera de alcance de
esta tarea.

### 1.3 Uso actual de `migrate:up` en el repositorio

El único lugar donde `npm run migrate:up` se ejecuta hoy es
`.github/workflows/ci.yml`, job `backend-tests`, contra el contenedor
Postgres **efímero** de ese job (`postgres:16` levantado como *service* del
propio run de CI). Ese job hace `npm install` (completo, con
`devDependencies`), a diferencia de la imagen runtime. **Esa ejecución nunca
toca Cloud SQL real** — es aislada y desechable por diseño.

### 1.4 Workflow de deploy actual

`.github/workflows/backend-deploy-development.yml` conserva exactamente la
secuencia integrada y probada en runtime en la Tarea #11:

```
Guard — main only
  → checkout
  → Verificar SHA fuente exacto antes de autenticar (id: source)
  → WIF (google-github-actions/auth)
  → setup-gcloud
  → Verificar projectId
  → Configurar Docker
  → Build + label OCI org.opencontainers.image.revision
  → Verificar label OCI ANTES de publicar (id: verify-image-label)
  → Push (tag determinístico por SOURCE_SHA)
  → Resolver y validar digest (id: digest → image_tag_ref / artifact_digest / immutable_ref)
  → Reporte de publicación
  → Capturar PREVIOUS_REVISION (id: capture-previous)
  → Deploy por digest, SIN tráfico (steps.digest.outputs.immutable_ref)
  → Identificar NEW_REVISION
  → Validar candidata (runtime_image / runtime_digest)
  → Mover 100% del tráfico
  → Verificar split de tráfico
  → Health check
  → Confirmar ausencia de drift
  → Rollback condicionado (solo si algo falló después del switch)
  → Resumen final
```

Búsqueda exhaustiva (case-insensitive) de la palabra "migrat" en el archivo:
**0 coincidencias.**

**`MIGRATION_STAGE_PRESENT = NO`** — confirmado. Este documento no lo cambia.

### 1.5 Conectividad real a Cloud SQL (auditoría de solo lectura contra GCP)

| Hecho | Valor verificado |
|---|---|
| Instancia Cloud SQL | `ridepro-development:southamerica-east1:ridepro-backend-dev-pg` |
| Versión | `POSTGRES_16` |
| Región | `southamerica-east1` |
| Service account **runtime** del servicio (`ridepro-backend-dev`) | `ridepro-backend-dev-sa@ridepro-development.iam.gserviceaccount.com` |
| Roles IAM (proyecto) de esa SA runtime | `roles/cloudsql.client`, `roles/firebaseauth.viewer`, `roles/logging.logWriter` |
| Service account **deployer** (GitHub Actions WIF, usada en `backend-deploy-development.yml`) | `ridepro-github-deployer@ridepro-development.iam.gserviceaccount.com` |
| Roles IAM (proyecto) de la SA deployer | **ninguno** — 0 bindings a nivel de proyecto |
| Roles IAM (recurso) de la SA deployer | `roles/artifactregistry.writer` (repo `ridepro-backend`) + `roles/run.developer` (servicio `ridepro-backend-dev`) — nada más |
| `roles/cloudsql.client` otorgado a la SA deployer | **NO, en ningún ámbito** |
| Cloud SQL Auth Proxy referenciado en el repo | **NO** (`git grep` sin resultados) |
| Cloud Run Jobs existentes en `ridepro-development` | **0** (`gcloud run jobs list` vacío) |
| Ejecutor de migraciones automatizado ya existente | **ninguno** |

**`DATABASE_CONNECTIVITY_FROM_GITHUB_RUNNER = NOT_PROVEN`** — de hecho, activamente
refutado: la identidad que usa el workflow de deploy hoy **no tiene ningún
camino de conexión a Cloud SQL**, ni por IAM (`cloudsql.client` ausente) ni
por herramienta (Auth Proxy ausente del repo).

**`CURRENT_MIGRATION_EXECUTOR = NONE`**

### 1.6 Herramienta real instalada — comportamiento verificado localmente

`node-pg-migrate@7.9.1` fue inspeccionado localmente (`--help`, sin conectar
a ninguna base) para no diseñar sobre suposiciones. Flags relevantes
confirmados como realmente existentes en esta versión:

- `--dry-run` — *"Prints the SQL but doesn't run it"*. Existe y es utilizable
  para preflight sin mutar nada.
- `--single-transaction` (**default: `true`**) — combina todas las
  migraciones pendientes en una única transacción; si cualquiera falla,
  **todas** se revierten. Ya es el comportamiento por defecto, sin que este
  diseño tenga que reimplementarlo.
- `--lock` (**default: `true`**) — *"When false, disables locking mechanism
  and checks"*. La herramienta ya tiene un mecanismo interno de locking
  propio (alcance: su propia ejecución, no documentado como un identificador
  estable externamente observable). Se documenta como una capa adicional ya
  existente; no reemplaza el diseño de advisory lock explícito de la
  sección 7, que sigue siendo necesario para dar una barrera con
  identificador estable y auditable a nivel de esta pipeline.
- No existe subcomando nativo `status`/`list-pending`. Los únicos verbos son
  `up`, `down`, `create`, `redo`.
- Tabla de tracking real: `pgmigrations` (`-t/--migrations-table`, default).

Estos hechos alimentan directamente el diseño de la sección 6.

---

## 2. Problema a resolver

Development tiene un pipeline de deploy fail-closed y trazable de extremo a
extremo para **código de aplicación** (Tarea #11), pero **ningún control
automatizado, seguro y auditable** existe todavía para aplicar cambios de
**esquema de base de datos**. Hoy, si `backend/migrations/` tuviera un
archivo nuevo pendiente, no hay ningún paso del pipeline que lo detecte, lo
aplique, ni lo verifique — el esquema real de `ridepro-backend-dev-pg` solo
se ha modificado hasta ahora mediante intervención manual documentada en
sesión (ver Puerta G, `PROJECT_STATUS.md`), nunca por un mecanismo repetible
del propio CI/CD.

## 3. Restricciones y principios

Los 10 principios obligatorios de la tarea, sin reformular:

1. Una migración se ejecuta como máximo una vez por deployment.
2. Ningún deploy puede correr dos migraciones concurrentes.
3. `migrate:up` es el camino normal.
4. `migrate:down` **no** es rollback automático.
5. Rollback de aplicación ≠ rollback de base de datos.
6. Cambios de esquema siguen expand/contract.
7. La revisión anterior debe seguir funcionando después de la fase EXPAND.
8. Ningún cambio destructivo depende del mismo deploy que introduce el
   código nuevo que lo necesita.
9. Una migración fallida impide crear/mover tráfico a una nueva revisión.
10. La ejecución produce evidencia auditable.

---

## 4. Ejecutor de migraciones

### 4.1 Opciones evaluadas

**Opción A — GitHub Actions runner + Cloud SQL Auth Proxy/conector**

El propio job `publish` (o un job hermano) instalaría dependencias
(`npm ci`, con `devDependencies`, ya que el runner no está limitado como la
imagen runtime), descargaría/ejecutaría el binario oficial de Cloud SQL Auth
Proxy, y correría `npm run migrate:up` directamente desde el runner efímero.

- Reutiliza la misma identidad WIF ya autenticada en el job.
- Requiere **una IAM nueva**: `roles/cloudsql.client` otorgado a
  `ridepro-github-deployer` — hoy esa SA no tiene ningún permiso relacionado
  con bases de datos. Esto **amplía el radio de explosión de la identidad
  que ya tiene permiso para publicar código y desplegar** — cualquier
  compromiso de esa SA pasaría a incluir también acceso de escritura a la
  base de datos de Development.
- Introduce una dependencia nueva de supply-chain en el runner (el binario
  del Auth Proxy: descarga, verificación, pin de versión) que hoy no existe
  en ningún workflow del repositorio.
- Aislamiento: el runner de GitHub ya es efímero, pero comparte el mismo
  proceso/contexto que build+push+deploy — el radio de blast si algo sale
  mal durante la migración es el mismo runner que ya tiene el `immutable_ref`
  listo para desplegar.
- Concurrencia: solo protegido por `concurrency:` de GitHub Actions (ver
  sección 7) — sin barrera adicional propia del ejecutor.
- Promoción a Staging/Production: cada entorno repetiría el mismo patrón
  dentro del mismo job, multiplicando el permiso `cloudsql.client` en la
  misma identidad deployer para cada instancia adicional.

**Opción B — Cloud Run Job dedicado de migraciones**

Una imagen separada y mínima (basada en el mismo stage `build` del
Dockerfile actual, que **ya tiene** `node-pg-migrate` instalado por incluir
`devDependencies` — solo le faltaría `COPY migrations ./migrations`, cambio
de Dockerfile fuera de alcance de esta tarea de diseño) ejecutándose como
`gcloud run jobs execute` contra el conector Cloud SQL nativo de Cloud Run
(el mismo mecanismo `run.googleapis.com/cloudsql-instances` que el propio
servicio `ridepro-backend-dev` ya usa con éxito).

- IAM: una **SA nueva, dedicada exclusivamente a migraciones**
  (`ridepro-backend-migrator-sa@ridepro-development.iam.gserviceaccount.com`,
  propuesta), con **únicamente** `roles/cloudsql.client` — sin
  `firebaseauth.viewer` ni `logging.logWriter` que sí necesita la SA
  runtime. Alternativa más simple (menor esfuerzo de aprovisionamiento):
  reutilizar `ridepro-backend-dev-sa` (ya tiene `cloudsql.client`, cero IAM
  nueva) — pero eso mezcla la identidad de "sirve tráfico" con la de
  "muta esquema", perdiendo aislamiento de auditoría entre ambas
  actividades. Se recomienda la SA dedicada nueva (ver 4.2).
- El deployer (`ridepro-github-deployer`) solo necesita permiso para
  **disparar** el Job (`roles/run.developer` extendido al recurso Job, ya es
  el mismo rol que hoy tiene sobre el servicio) — **nunca** necesita
  `cloudsql.client` él mismo. El radio de explosión de la identidad que
  puede desplegar código **no crece**.
- Sin Auth Proxy: el conector nativo de Cloud Run ya está en uso comprobado
  por el propio servicio.
- Concurrencia: los Cloud Run Jobs tienen su propio control de
  `--task-count`/`--parallelism` (fijable a `1`/`1`) — una **tercera** capa
  de concurrencia, ortogonal a GitHub Actions y al advisory lock de
  PostgreSQL (defensa en profundidad real, no solo teórica).
- Auditabilidad: ejecuciones del Job quedan en Cloud Logging con su propio
  historial, correlacionable con el run de GitHub Actions vía `SOURCE_SHA`
  pasado como variable/argumento — trazabilidad de extremo a extremo
  preservando el mismo principio ya usado en la Tarea #11.
- Promoción a Staging/Production: el mismo patrón (Job + SA dedicada +
  conector nativo) se replica parametrizado por proyecto/instancia — sin
  tocar la identidad deployer en ningún entorno adicional.
- Costo real de esta opción (reconocido explícitamente, sin ocultarlo):
  requiere crear infraestructura nueva (imagen del migrador, recurso Job,
  SA dedicada, bindings IAM) que la Opción A no requeriría. Es la opción
  operacionalmente más pesada de instalar la primera vez.

**Opción C — reutilizar la imagen del servicio actual**

**Rechazada**, con evidencia directa (sección 1.2): la imagen `runtime` no
contiene `node-pg-migrate` (excluido por `--omit=dev`, es `devDependency`)
ni `backend/migrations/` (nunca copiado). Hacerla viable exigiría modificar
el `Dockerfile` de producción para siempre incluir tooling de desarrollo y
los archivos de migración en la imagen que sirve tráfico real — contradice
directamente la razón de ser documentada de esa separación de stages
(`build` vs `runtime`, superficie mínima) y está además explícitamente fuera
de alcance de esta tarea. No se modifica el Dockerfile para intentar hacerla
funcionar.

### 4.2 Decisión

**`RECOMMENDED_MIGRATION_EXECUTOR = Opción B — Cloud Run Job dedicado, con
service account propia de solo-migraciones (`cloudsql.client` únicamente)`.**

**`JUSTIFICATION`**: se prioriza **menor privilegio** sobre **menor esfuerzo
de implementación** — instrucción explícita de esta tarea. La Opción A es
más simple de cablear hoy, pero exige otorgarle a la identidad que **ya
puede publicar y desplegar código arbitrario en cada push a `main`** un
permiso nuevo y sensible (`cloudsql.client`) que hoy deliberadamente no
tiene. La Opción B mantiene esa identidad exactamente como está
(`artifactregistry.writer` + `run.developer`, nada de bases de datos) y
aísla el permiso de escritura de esquema en una identidad de un solo
propósito, más fácil de auditar y de revocar independientemente. Además
suma una tercera capa de concurrencia (Cloud Run Job) sin costo adicional de
diseño, y es el patrón que mejor promueve a Staging/Production sin volver a
tocar la identidad deployer en cada entorno nuevo.

---

## 5. Secuencia canónica del deployment

Orden propuesto (evalúa el orden de 23 pasos dado en la tarea y lo confirma
como correcto, con una corrección de encuadre explicada abajo):

```
 1. Guard main-only
 2. Checkout exacto
 3. Verificación SOURCE_SHA (== CHECKED_OUT_SHA)
 4. WIF (deployer)
 5. Project ID check
 6. Build
 7. OCI revision label verification
 8. Push
 9. Resolver digest → congelar immutable_ref
10. Capturar estado previo de Cloud Run (PREVIOUS_REVISION + fingerprint)
11. MIGRATION PREFLIGHT             ← nuevo (sección 6)
12. LOCK de migración (PostgreSQL)  ← nuevo (sección 7)
13. Ejecutar migrate:up             ← nuevo (sección 8)
14. POST-MIGRATION VERIFY           ← nuevo (sección 9)
15. Liberar lock                    ← nuevo (sección 7)
16. Deploy immutable_ref --no-traffic
17. Identificar candidata
18. Validar candidata
19. Switch tráfico
20. Health
21. No-drift
22. Rollback condicionado (solo aplicación, nunca DB — sección 12)
23. Resultado final / evidencia (sección 14)
```

**Este es el orden correcto**, y confirma explícitamente el principio ya
señalado por la tarea: la imagen debe estar **construida, publicada y con su
digest congelado ANTES** de tocar la base — nunca al revés. Si el build o el
push fallaran, no tendría sentido haber mutado ya el esquema para una imagen
que nunca llegó a existir. La migración solo se ejecuta una vez que existe
un `immutable_ref` válido y verificado, pero **antes** de invocar
`gcloud run deploy` — exactamente como pide la tarea ("la migración debe
terminar satisfactoriamente ANTES del `gcloud run deploy`").

Nota de encuadre: los pasos 11–15 (preflight → lock → migrate:up → verify →
unlock) constituyen, en la Opción B elegida (sección 4.2), la **invocación
de un Cloud Run Job independiente** desde el job `publish` (vía
`gcloud run jobs execute --wait` o equivalente), no pasos ejecutados
directamente por el runner de GitHub Actions. El runner dispara el Job y
espera su resultado; el Job en sí corre el preflight/lock/migrate/verify
dentro de su propio contenedor, con su propia SA.

---

## 6. Migration preflight

Diseño fail-closed, ejecutado dentro del Cloud Run Job antes de tocar el
esquema. Basado en el comportamiento **real** de `node-pg-migrate@7.9.1`
(sección 1.6), no en suposiciones:

1. **Proyecto correcto** — el propio conector nativo de Cloud Run
   (`run.googleapis.com/cloudsql-instances`) ya ata la ejecución a la
   instancia exacta configurada en el Job; se confirma además con
   `SELECT current_database()`.
2. **Instancia/conexión posible** — cualquier consulta subsiguiente exitosa
   lo prueba; si la conexión falla, el preflight falla inmediatamente (sin
   reintentos silenciosos indefinidos).
3. **Identidad/autenticación correcta** — `SELECT current_user`, comparado
   contra el usuario de base de datos esperado para la SA del migrador.
4. **Base esperada** — `current_database() = 'ridepro_dev'` (Development).
5. **Historial de migraciones legible** — `SELECT name FROM pgmigrations
   ORDER BY run_on` (lectura pura, sin mutar nada).
6. **Migraciones pendientes identificables** — diff entre los archivos
   presentes en `backend/migrations/` del `SOURCE_SHA` desplegado y los
   `name` ya registrados en `pgmigrations`. Como verificación cruzada (no
   como fuente primaria), se ejecuta también `node-pg-migrate up --dry-run`
   (confirmado existente en la versión real instalada) y se compara que el
   conjunto de migraciones que la propia herramienta planea aplicar
   coincida con el diff manual — cualquier discrepancia es señal de una
   tabla `pgmigrations` corrupta o manipulada, y el preflight falla cerrado.
7. **No existe estado inconsistente** — cada `name` ya presente en
   `pgmigrations` debe seguir teniendo un archivo correspondiente en
   `backend/migrations/` (protege contra un archivo ya aplicado que fue
   renombrado o borrado, lo cual rompería el `--check-order` que
   `node-pg-migrate` ya aplica por defecto).
8. **No hay migración concurrente** — delegado íntegramente al advisory
   lock de la sección 7; el preflight en sí no intenta detectarlo por otra
   vía (evita duplicar lógica de concurrencia en dos sitios distintos).
9. **Ningún secreto se imprime** — `DATABASE_URL` se consume desde la misma
   referencia de secreto ya usada por el servicio en runtime (Secret
   Manager, cableada al Job igual que al servicio); el script de preflight
   nunca hace `echo`/log de la cadena de conexión completa, solo de campos
   derivados no sensibles (nombre de base, nombres de migraciones,
   conteos).

**Outputs propuestos:**

```
DB_PREFLIGHT             = PASS / FAIL
CURRENT_MIGRATION        = <name de la fila más reciente en pgmigrations>
PENDING_MIGRATION_COUNT  = <entero >= 0>
PENDING_MIGRATIONS       = <lista de filenames>
MIGRATION_REQUIRED       = YES / NO
```

**Caso `MIGRATION_REQUIRED = NO` (nada pendiente):** es un resultado sano y
frecuente (la mayoría de los deploys solo cambian código de aplicación). El
pipeline **no debe fallar** en ese caso — el Job debe reportar
`DB_PREFLIGHT = PASS`, `MIGRATION_REQUIRED = NO`, y el job `publish` continúa
directamente hacia el deploy, saltando limpiamente los pasos 12–15 (no hay
nada que bloquear ni aplicar).

---

## 7. Control de concurrencia

### GitHub concurrency

```yaml
concurrency:
  group: cloud-run-deploy-development
  cancel-in-progress: false
```

**`GITHUB_CONCURRENCY_ONLY = INSUFFICIENT`.** Esta barrera impide que **dos
ejecuciones del mismo workflow** corran simultáneamente, pero no protege
contra: (a) una migración disparada por otra vía (ejecución manual, otro
pipeline futuro de Staging apuntando por error a la misma instancia,
intervención de sesión como las ya documentadas en Puerta G/J), ni (b) una
ejecución anterior que quedó colgada a nivel de proceso pero cuyo workflow
ya se reporta como terminado. Se necesita una segunda barrera a nivel de la
propia base de datos.

### PostgreSQL advisory lock

```
DB_LOCK_TYPE             = Session-level advisory lock
                            (pg_advisory_lock / pg_advisory_unlock — NO
                            pg_advisory_xact_lock, ver justificación abajo)
DB_LOCK_SCOPE            = pg_advisory_lock(classid, objid) de dos claves:
                            classid = 1200  (constante fija, documentada:
                                      "namespace de locks de migración
                                      Korixa")
                            objid   = 1     (Development; 2 reservado para
                                      Staging, 3 para Production — mismo
                                      esquema, extensible sin colisión)
DB_LOCK_TIMEOUT           = statement_timeout = 60s aplicado ÚNICAMENTE a la
                            sentencia de adquisición (SELECT
                            pg_advisory_lock(1200, 1);) — espera acotada,
                            nunca bloqueo infinito. Si no se adquiere en
                            60s, la sentencia es cancelada por Postgres y el
                            preflight falla cerrado.
DB_LOCK_OWNER             = un único proceso "wrapper" (dentro del Cloud Run
                            Job) que:
                            1. abre UNA conexión dedicada y la mantiene
                               ABIERTA durante toda la operación;
                            2. adquiere el lock en esa conexión (paso
                               anterior);
                            3. lanza `npm run migrate:up` como proceso HIJO
                               (con su propia conexión separada, vía `pg`/
                               node-pg-migrate) MIENTRAS la conexión que
                               sostiene el lock permanece abierta en
                               background;
                            4. espera la salida del hijo y captura su
                               exit code;
                            5. libera el lock explícitamente en la MISMA
                               conexión que lo adquirió;
                            6. cierra la conexión.
DB_LOCK_RELEASE_STRATEGY  = liberación explícita (`pg_advisory_unlock`) en
                            un bloque `finally`/equivalente que se ejecuta
                            SIEMPRE (éxito, fallo, o excepción del hijo).
                            Red de seguridad adicional, garantizada por
                            PostgreSQL sin necesidad de código propio: los
                            locks de sesión se liberan automáticamente
                            cuando la sesión que los sostiene termina (por
                            cualquier causa — crash del wrapper, corte de
                            red, Job matado externamente). Por eso se elige
                            explícitamente ámbito de SESIÓN, no de
                            transacción: si fuera `pg_advisory_xact_lock`,
                            el lock se liberaría en cuanto termine
                            CUALQUIER transacción de esa conexión — y el
                            wrapper no necesariamente mantiene una única
                            transacción abierta durante todo el proceso hijo.
```

**Advertencia explícita ya incorporada al diseño** (la que la tarea pide no
pasar por alto): **no** se propone `SELECT pg_advisory_lock(...); cerrar
conexión; npm run migrate:up` — eso liberaría el lock inmediatamente al
cerrar la conexión, antes de que la migración siquiera empiece. El diseño de
arriba mantiene la conexión que sostiene el lock **viva y abierta** durante
todo el ciclo de vida del proceso hijo `migrate:up`.

Resultado: **tres capas independientes de concurrencia** —
GitHub Actions `concurrency:` (nivel workflow) + Cloud Run Job
`--task-count=1 --parallelism=1` (nivel ejecución de infraestructura) +
PostgreSQL advisory lock `(1200, 1)` (nivel base de datos, la única capa que
protege incluso contra una ejecución disparada completamente fuera de este
pipeline).

---

## 8. `migrate:up`

```
AUTO_MIGRATE_UP   = YES
AUTO_MIGRATE_DOWN = NO
```

La operación normal es exactamente `npm run migrate:up` (equivalente:
`node-pg-migrate up -m migrations`), invocada:

- **una sola vez** por deployment (garantizado por el lock de la sección 7 +
  por ser un único paso del pipeline, nunca reintentado automáticamente);
- usando el **mismo código y migraciones del `SOURCE_SHA`** verificado en el
  paso 3 (la imagen del migrador se construye del mismo checkout, nunca de
  una copia separada o desactualizada);
- apuntando **únicamente** a `ridepro-development`/`ridepro-backend-dev-pg`
  (nunca a Staging/Production — no existen todavía, y este diseño no los
  introduce);
- usando la referencia de secreto ya existente para `DATABASE_URL` (misma
  fuente que usa el servicio en runtime), nunca impresa en logs;
- **fail-closed**: `--single-transaction` (default real de la versión
  instalada, sección 1.6) ya garantiza que si cualquier migración pendiente
  falla, ninguna queda parcialmente aplicada; el wrapper propaga el exit
  code del hijo tal cual, y cualquier código distinto de 0 detiene el
  pipeline completo (sin deploy, sin tráfico — ver matriz, sección 13).

---

## 9. Verificación post-migration

Ejecutada dentro del mismo Cloud Run Job, después de que `migrate:up`
termine con éxito y **antes** de liberar el advisory lock:

1. El proceso hijo terminó con `exit 0` (ya capturado por el wrapper).
2. `PENDING_MIGRATION_COUNT` recalculado (mismo método que el preflight) es
   ahora `0`.
3. El historial en `pgmigrations` es coherente: la cantidad de filas nuevas
   desde el preflight es exactamente igual al `PENDING_MIGRATION_COUNT`
   capturado antes de migrar, y sus `name` coinciden exactamente (mismo
   orden) con `PENDING_MIGRATIONS`.
4. La base sigue accesible: una consulta trivial (`SELECT 1`) en una
   conexión **nueva** (no la del wrapper) confirma que no quedó en un estado
   colgado.
5. Consulta mínima de integridad, no destructiva: `SELECT to_regclass(...)`
   sobre las tablas base ya conocidas (`equipment`, `workouts`, `users`),
   confirmando que el esquema sigue siendo consultable tras el cambio — sin
   escribir ni leer datos de negocio.
6. El resultado se asocia explícitamente a `SOURCE_SHA` y al `RUN_ID` de
   GitHub Actions que disparó el Job (pasados como argumento/variable de
   entorno al ejecutar el Job), para que la evidencia (sección 14) sea
   correlacionable de extremo a extremo.

**Outputs propuestos:**

```
MIGRATION_RESULT       = PASS / FAIL
APPLIED_MIGRATIONS     = <lista de filenames recién aplicados>
POST_PENDING_COUNT     = <entero, esperado 0>
POST_MIGRATION_DB_CHECK = PASS / FAIL
```

Si cualquiera de estas verificaciones falla, `MIGRATION_RESULT = FAIL`
incluso si el proceso `migrate:up` en sí reportó `exit 0` — la verificación
post no es opcional ni cosmética.

---

## 10. Backup decision gate

```
BACKUP_REQUIRED = YES / NO   (evaluado por migración pendiente, no por deploy)
```

**Criterio propuesto**, aplicado dentro del preflight (sección 6), antes de
adquirir el lock:

1. Cada migración **nueva** (creada después de la adopción de esta política)
   debe declarar su clase mediante un comentario de cabecera obligatorio en
   el propio archivo `.sql`, por ejemplo:
   `-- korixa:migration-class: expand`. Sin esa etiqueta, el preflight
   **falla cerrado** exigiendo clasificación explícita — nunca se infiere
   en silencio.
2. Clasificación `expand` (aditiva, compatible, ver sección 11) →
   `BACKUP_REQUIRED = NO` por defecto.
3. Clasificación `contract`/`destructive` (o cualquiera de: `DROP TABLE`,
   `DROP COLUMN`, `RENAME` incompatible, `ALTER ... TYPE` riesgoso,
   `NOT NULL` inmediato sobre datos existentes, backfill masivo,
   transformación irreversible) → `BACKUP_REQUIRED = YES`.
4. Como defensa adicional (no como fuente primaria de la clasificación), el
   preflight aplica un escaneo de patrones de alto riesgo
   (`grep`-equivalente sobre el `.sql`: `DROP `, `RENAME `, `ALTER .* TYPE`,
   `NOT NULL` sin `DEFAULT`) sobre el archivo. Si el patrón dispara pero la
   etiqueta declara `expand`, es una **discrepancia** entre intención
   declarada y contenido real → el preflight falla cerrado exigiendo
   corrección, en vez de confiar ciegamente en la etiqueta.

**Importante — reafirmado explícitamente**: esta tarea **no implementa**
ningún mecanismo real de backup/restore. Si `BACKUP_REQUIRED = YES`, el
preflight **falla cerrado** — el pipeline de Development, tal como está
diseñado hoy, simplemente **no tiene autorización arquitectónica** para
aplicar automáticamente una migración clasificada como
destructiva/`contract` mientras no exista una fase posterior que implemente
esa protección real. La única vía para una migración así, hasta entonces,
es un procedimiento manual explícitamente autorizado por el propietario,
fuera de este pipeline — el mismo patrón de autorización explícita usado en
todo el resto de este proyecto.

---

## 11. Expand / migrate / contract

**EXPAND** — permitido en deployment normal, automatizado por este diseño:

- `ADD TABLE`.
- `ADD COLUMN` nullable (o con `DEFAULT` seguro).
- `ADD INDEX`/constraint compatible (sin bloquear escritura de forma
  prolongada — `CREATE INDEX CONCURRENTLY` cuando aplique).
- Estructuras nuevas que no rompen absolutamente nada de lo que la revisión
  **anterior** de la aplicación ya usa.
- Dual-read/dual-write cuando la migración de datos lo requiera (el
  *backfill* en sí, ver abajo, es un paso separado — no forma parte de la
  migración de esquema EXPAND).

**MIGRATE/BACKFILL** — en paso separado cuando aplique (fuera de la
migración de esquema atómica de `node-pg-migrate`; no se diseña su
mecanismo concreto en esta tarea, solo se reconoce como categoría distinta
de EXPAND y de CONTRACT).

**CONTRACT** — **nunca en el mismo deployment** que introduce la
dependencia nueva que lo motiva. Tratados siempre como `contract`/riesgo
(sección 10):

- `DROP COLUMN`, `DROP TABLE`.
- Rename incompatible (sin alias/vista de compatibilidad).
- `NOT NULL` inmediato sobre una columna con datos existentes, sin
  preparación previa (backfill + validación antes de imponer la
  restricción).
- Cambio de tipo incompatible.
- Eliminación de índice/constraint que la revisión anterior todavía
  requiere.

```
MINIMUM_CONTRACT_DELAY_POLICY      = El archivo de migración CONTRACT debe
                                      vivir en un PR y deploy SEPARADO,
                                      posterior, del EXPAND correspondiente
                                      — nunca combinados en el mismo archivo
                                      ni en el mismo deploy. El EXPAND debe
                                      haber completado un ciclo de deploy
                                      exitoso (switch de tráfico + health
                                      verde) antes de que el CONTRACT
                                      correspondiente sea siquiera elegible
                                      para mergearse.
OLD_REVISION_COMPATIBILITY_REQUIRED = YES
AUTOMATIC_DESTRUCTIVE_MIGRATION     = NO
```

---

## 12. Política de rollback

**`APP_ROLLBACK != DB_ROLLBACK`** — declarado explícitamente, sin
ambigüedad.

Si `migrate:up` = **PASS** pero el deploy/candidata/health posteriores
**FALLAN**, el mecanismo de rollback **ya existente** en
`backend-deploy-development.yml` (Tarea #8/#9) puede devolver el tráfico a
`PREVIOUS_REVISION` con total normalidad — precisamente **porque** el
principio de EXPAND (sección 11) garantiza que esa revisión anterior sigue
siendo compatible con el esquema ya expandido. **Nunca** se ejecuta
`npm run migrate:down` automáticamente como parte de esa respuesta.

```
AUTO_DATABASE_ROLLBACK = NO
AUTO_MIGRATE_DOWN       = NO
FORWARD_FIX_PREFERRED   = YES
```

Respuesta ante ese escenario (migración OK, deploy de aplicación falla):

1. Conservar el esquema ya expandido — no se revierte.
2. Restaurar tráfico de aplicación a `PREVIOUS_REVISION` (ya lo hace el
   rollback condicionado existente).
3. Investigar la causa raíz del fallo de deploy/health (no de la
   migración, que ya se confirmó exitosa).
4. Corregir **hacia adelante** (nuevo commit, nuevo deploy) — nunca revertir
   el esquema para "deshacer" un problema que en realidad está en el código
   de aplicación o en la infraestructura del deploy, no en la base.
5. Un `contract` destructivo real, si alguna vez es necesario deshacer algo
   a nivel de esquema, pertenece a una etapa **posterior**, explícitamente
   autorizada — nunca a una reacción automática de este pipeline.

---

## 13. Failure matrix

| Escenario | Migración | Deploy | Tráfico | `migrate:down` automático |
|---|---|---|---|---|
| **PRECHECK FAIL** (preflight, sección 6) | no ejecutada | no | no | no |
| **LOCK FAIL/TIMEOUT** (sección 7, >60s) | no ejecutada | no | no | no |
| **MIGRATE_UP FAIL** | aplicada parcialmente **no** (single-transaction) | no | no | **no** |
| **POST_VERIFY FAIL** (sección 9) | aplicada, pero sin verificación confirmada | no | no | **no** — requiere intervención/revisión manual |
| **DEPLOY `--no-traffic` FAIL** (después de migración exitosa) | conservada (esquema expandido) | falla | `PREVIOUS_REVISION` sigue sirviendo | **no** |
| **CANDIDATE FAIL** | conservada | no llega a switch | tráfico previo intacto | **no** |
| **TRAFFIC/HEALTH FAIL** | conservada | revertido vía rollback existente (app) | vuelve a `PREVIOUS_REVISION` | **no** |
| **SUCCESS** | conservada, verificada | completo | nueva revisión al 100% | — (no aplica) |

En **ningún** escenario de esta matriz se ejecuta `migrate:down`
automáticamente — coherente con la sección 12.

---

## 14. Evidencia y observabilidad

Job Summary propuesto para la futura implementación (sin secretos, siguiendo
exactamente el mismo patrón ya establecido y probado en la Tarea #11):

```
MIGRATION_SOURCE_SHA
MIGRATION_EXECUTOR          (identificador del Cloud Run Job / ejecución)
MIGRATION_DATABASE_ID       (nombre de la instancia Cloud SQL, no credenciales)
MIGRATION_LOCK              = PASS / FAIL
MIGRATION_LOCK_WAIT         (segundos esperados hasta adquirir, o "timeout")
MIGRATION_BEFORE_VERSION    (= CURRENT_MIGRATION del preflight)
MIGRATION_PENDING_COUNT
MIGRATION_APPLIED           (lista de filenames)
MIGRATION_AFTER_VERSION     (última migración aplicada tras el run)
MIGRATION_VERIFY            = PASS / FAIL
BACKUP_REQUIRED             = YES / NO
EXPAND_CONTRACT_CLASS       (declarada por cada migración aplicada)
AUTO_MIGRATE_DOWN           = NO   (constante, siempre reportada así)
```

**Nunca incluye**: `DATABASE_URL`, contraseñas, tokens, ni ningún valor de
secreto — mismo estándar ya aplicado en el resumen de deploy existente.

---

## 15. Diseño de implementación futura

**Esto NO se ejecuta en esta tarea.** Se documenta únicamente qué archivos
**probablemente** necesitarán cambiar, basado en la arquitectura elegida
(sección 4.2), sin tocarlos:

- `.github/workflows/backend-deploy-development.yml` — insertar los pasos
  11–16 de la secuencia (sección 5): disparo del Cloud Run Job de
  migraciones entre "capturar estado previo" y "deploy `--no-traffic`",
  esperando su resultado antes de continuar.
- Un **nuevo Dockerfile** (o un nuevo *stage* dentro del `backend/Dockerfile`
  existente) para el migrador — probablemente partiendo del stage `build`
  ya existente (que ya tiene `devDependencies`, incluido `node-pg-migrate`)
  y agregando `COPY migrations ./migrations`, con un entrypoint que invoque
  el wrapper de la sección 7/8 en vez de `node dist/main.js`.
- Un script wrapper nuevo, probablemente
  `backend/scripts/migrate-with-lock.js` (o `.ts`), implementando la lógica
  de preflight + advisory lock + `migrate:up` + post-verify de las
  secciones 6–9, usando `pg` (ya dependencia real del proyecto — sin
  agregar ninguna librería nueva).
- Configuración/creación (fuera de este repo o vía comandos `gcloud`
  documentados, dado que el proyecto no usa Terraform/IaC hoy) de:
  - el recurso Cloud Run Job dedicado;
  - la service account dedicada de migraciones y su binding
    `roles/cloudsql.client`;
  - el binding de `roles/run.developer` (o el mínimo necesario) del
    deployer sobre el nuevo recurso Job específicamente.

**No se decide que ningún archivo "debe" cambiar sin evidencia** — esta
lista es una proyección razonada a partir de la arquitectura ya elegida y
auditada en este mismo documento, no una decisión ya tomada de contenido.

---

## 16. Acceptance criteria

Este documento (Tarea #12) se considera completo cuando:

- El sistema real de migraciones fue auditado contra `origin/main` (§1.1).
- Quedó documentado, con evidencia directa, que la imagen runtime actual no
  puede asumirse capaz de correr `migrate:up` (§1.2).
- Se comparó al menos 3 opciones de ejecutor con criterios explícitos y se
  eligió una basada en evidencia, no en facilidad (§4).
- Existe un diseño de preflight fail-closed (§6).
- Existe doble (de hecho, triple) control de concurrencia (§7).
- El advisory lock tiene lifetime correctamente diseñado — sin el error de
  cerrar la conexión antes de tiempo (§7).
- `migrate:up` ocurre como máximo una vez por deploy (§8).
- `migrate:down` automático está explícitamente prohibido en todo el
  documento (§8, §12, §13).
- Existe verificación post-migration obligatoria (§9).
- Existe un gate de decisión de backup, con fail-closed si no puede
  satisfacerse (§10).
- Expand/contract está definido, con separación obligatoria de deploys
  (§11).
- La compatibilidad de la revisión anterior tras EXPAND es un requisito
  explícito (§11, §12).
- App rollback y DB rollback están completamente separados en la política
  (§12).
- Existe una matriz de fallos exhaustiva (§13).
- Existe un diseño de evidencia auditable sin secretos (§14).

## 17. Fuera de alcance

- Implementación real del Cloud Run Job, su imagen, su SA, o sus bindings
  IAM.
- Modificación de `backend/Dockerfile`, `backend/package.json`, o
  cualquier archivo bajo `backend/`.
- Modificación de `.github/workflows/backend-deploy-development.yml` o
  `.github/workflows/ci.yml`.
- Ejecución real de `migrate:up`, `migrate:down`, o cualquier DDL/DML contra
  cualquier instancia de Cloud SQL.
- Implementación de backup/restore real (solo se define **cuándo** debería
  exigirse, no **cómo** ejecutarse).
- Diseño o implementación del mecanismo concreto de *backfill*.
- Cualquier trabajo sobre Staging o Production — este diseño es exclusivo
  de Development, aunque se construyó pensando en que el mismo patrón
  (sección 4.1, Opción B) sea replicable después.
- Tarea #13 y cualquier tarea posterior.
