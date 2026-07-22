# Guía de verificación — A3 (Firestore), C2 (Backend/Postgres), D1 (Equipamiento) y D2 (Entrenamientos)

> **¿Sin acceso a una terminal (por ejemplo, trabajando solo desde el
> celular)?** Ver `CI_CD_GUIDE.md` — configuré GitHub Actions para correr
> estos mismos tracks automáticamente en la nube, viendo los resultados
> desde el navegador del celular, sin instalar nada localmente.

Originalmente escrita "antes de seguir con C3"; los Tracks 3 (D1,
Equipamiento) y 4 (D2, Entrenamientos) se agregaron después, sobre la
misma base de Postgres del Track 2 — ninguno lo repite desde cero. Track
1 y Track 2 son independientes entre sí (podés correrlos en cualquier
orden, o en paralelo en dos terminales); Tracks 3 y 4 dependen de que el
Track 2 ya se haya corrido al menos una vez (mismo contenedor y `.env`).
**Track 4 vive en la rama `feature/d2`**, no en `main` — hacé
`git checkout feature/d2` antes de correrlo si estás verificando desde
`main`.

---

## Track 1 — Reglas de seguridad de Firestore (A3)

### Prerrequisitos

```bash
node --version    # necesitás 18+
java -version     # necesitás 11+ (lo usa el emulador de Firestore)
firebase --version
```

Si `firebase --version` falla:
```bash
npm install -g firebase-tools
```
Si después de instalarlo seguís viendo `command not found`, es un
problema de `$PATH`, no de la instalación — ver la sección
"Solución de problemas" al final de este documento.

### Comandos exactos

```bash
cd firebase/rules-tests
npm install
npm test
```

### Qué esperar

`npm install` termina sin errores `403`/`ENOTFOUND` (esos indicarían un
problema de red, no del proyecto). Puede mostrar warnings de
dependencias — normal, ignoralos.

`npm test` levanta el emulador de Firestore, corre la suite completa, y
termina con un resumen de Jest parecido a:

```
Test Suites: 1 passed, 1 total
Tests:       XX passed, XX total
Snapshots:   0 total
Time:        X.XXX s
```

**El número exacto de tests no importa tanto como que diga `XX passed,
XX total`** (es decir, todos pasaron, ninguno en `failed`). Son
aproximadamente 20 tests repartidos en 5 grupos (`describe`): los 4
ataques + los casos de control.

### Qué enviarme

- Si **todo pasó**: pegame el bloque final de resumen de Jest (las 4-5
  líneas de `Test Suites` / `Tests` / `Time`). No hace falta el log
  completo si todo salió bien.
- Si **algo falló**: pegame la salida COMPLETA de la terminal desde
  `npm test` hasta el final — necesito ver exactamente qué test falló y
  el mensaje de `assertFails`/`assertSucceeds` que dio Jest, no solo el
  resumen.
- Si **falla antes de llegar a Jest** (el emulador no arranca, error de
  Java, etc.): pegame ese error tal cual.

---

## Track 2 — Backend NestJS + PostgreSQL (C2)

### Prerrequisitos

```bash
node --version   # 20+ (subido de 18+ tras el cierre de fase de Bloque C:
                 # el override de `file-type` en package.json, aplicado
                 # para resolver GHSA-5v7r-6r5c-r473/GHSA-j47w-4g3g-c36v,
                 # requiere Node >=20 — mismo mínimo que ya usa CI)
```

Necesitás una instancia de PostgreSQL accesible. Dos opciones — elegí
una:

**Opción A — Docker (recomendada, evita configurar Postgres a mano):**
```bash
docker run --name ridepro-postgres \
  -e POSTGRES_USER=ridepro \
  -e POSTGRES_PASSWORD=devpassword \
  -e POSTGRES_DB=ridepro_dev \
  -p 5432:5432 \
  -d postgres:16
```
Verificar que arrancó:
```bash
docker ps   # deberías ver "ridepro-postgres" con estado "Up"
```

**Opción B — Postgres ya instalado en tu máquina:** creá una base y un
usuario:
```bash
createdb ridepro_dev
psql ridepro_dev -c "CREATE USER ridepro WITH PASSWORD 'devpassword';"
psql ridepro_dev -c "GRANT ALL PRIVILEGES ON DATABASE ridepro_dev TO ridepro;"
```

### Comandos exactos

```bash
cd backend
npm install
cp .env.example .env
```

Editá `.env` y dejá esta línea (ajustá el password si usaste otro):
```
DATABASE_URL=postgres://ridepro:devpassword@localhost:5432/ridepro_dev
```

Aplicar la migración:
```bash
psql "postgres://ridepro:devpassword@localhost:5432/ridepro_dev" -f migrations/0001_init.sql
```

**Qué esperar de este comando específicamente:**
```
CREATE EXTENSION
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE TABLE
INSERT 0 4
CREATE TABLE
CREATE INDEX
CREATE TABLE
CREATE INDEX
CREATE TABLE
CREATE INDEX
```
(5 `CREATE TABLE`, 6 `CREATE INDEX`, 1 `INSERT 0 4` — los 4 roles
sembrados —, 1 `CREATE EXTENSION`. Si ves algún `ERROR:` en vez de esto,
copiámelo tal cual.)

Arrancar el servidor:
```bash
npm run start:dev
```

**Qué esperar:** en la consola, una línea como:
```
RidePro backend escuchando en http://localhost:3000/v1
```
sin ningún stack trace de error debajo.

En **otra terminal** (dejá la anterior corriendo el servidor):
```bash
curl http://localhost:3000/v1/health
```

**Qué esperar:**
```json
{"status":"ok","database":"connected"}
```

(Si estás en Windows sin `curl`, abrí `http://localhost:3000/v1/health`
directamente en el navegador — deberías ver ese mismo JSON.)

Volvé a la terminal del servidor y detenelo con `Ctrl+C`. Después:
```bash
npm run test:e2e
```

**Qué esperar:** resumen de Jest similar al de Firestore —
`Tests: 1 passed, 1 total` (es un solo test e2e por ahora, el del health
check).

### Qué enviarme

1. La salida completa de `psql -f migrations/0001_init.sql` (las ~12
   líneas de arriba, o el error si algo falló).
2. La salida de `curl http://localhost:3000/v1/health` (o el JSON que
   viste en el navegador).
3. El resumen final de `npm run test:e2e`.
4. Si `npm install` falló: el error completo (probablemente de red, pero
   confirmalo).

---

## Track 3 — Backend Equipamiento (D1, Bloque D)

> Este track asume que ya corriste el Track 2 al menos una vez (mismo
> contenedor `ridepro-postgres`, mismo `.env`) — si es la primera vez que
> tocás este backend, hacé el Track 2 primero.

Con C1-C5 y D1 (módulo `equipment`, ver
`docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md` sección 2) implementados, este
track agrega la migración `0003` y verifica el CRUD completo de
equipamiento contra Postgres real.

### Comandos exactos

Con el contenedor `ridepro-postgres` corriendo (`docker ps` debería
mostrarlo `Up`):

```bash
cd backend
docker exec -i ridepro-postgres psql -U ridepro -d ridepro_dev < migrations/0003_equipment.sql
```

**Qué esperar de este comando específicamente:**
```
CREATE TABLE
INSERT 0 8
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE INDEX
```
(2 `CREATE TABLE` — `equipment_categories` y `equipment` —, 1
`INSERT 0 8` — las 8 categorías sembradas: `bike`, `smart_trainer`,
`power_meter`, `heart_rate_monitor`, `cadence_sensor`, `speed_sensor`,
`speed_cadence_combo`, `other` —, 4 `CREATE INDEX`. Si ves algún
`ERROR:` en vez de esto, copiámelo tal cual — lo más probable es que el
Track 2 no se haya corrido antes, y la migración `0003` depende de que
`users` ya exista.)

Suite completa (unitarios + e2e — no hace falta levantar el servidor a
mano para este track, `test:e2e` levanta su propia instancia):

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test
npm run test:e2e
```

**Qué esperar:**
- `lint`/`tsc --noEmit`/`build`: sin salida de error (silenciosos si todo
  está bien).
- `npm run test`: `Tests: 45 passed, 45 total` (6 test suites — incluye
  `src/common/database/pg-error.util.spec.ts`, extraído en la auditoría
  de mantenimiento post-D1 para no duplicar la extracción de errores de
  `pg` entre `AuthService` y `EquipmentService`).
- `npm run test:e2e`: `Tests: 41 passed, 41 total` (6 test suites,
  incluyendo `equipment.e2e-spec.ts` con 21 tests — CRUD completo, 401
  sin token, 404 de recursos inexistentes/ajenos, validación de
  categoría y de campos, soft-delete idempotente, y un test de
  concurrencia real con 5 requests simultáneas).

### Qué enviarme

1. La salida completa de aplicar `migrations/0003_equipment.sql` (las 7
   líneas de arriba, o el error si algo falló).
2. El resumen final de `npm run test` y de `npm run test:e2e` (los
   bloques `Test Suites` / `Tests` / `Time` de cada uno).
3. Si `lint`, `tsc --noEmit` o `build` mostraron algo (aunque sea un
   warning): pegámelo tal cual, incluso si el resto pasó.

---

## Track 4 — Backend Entrenamientos (D2, Bloque D, rama `feature/d2`)

> Este track vive en la rama `feature/d2`, todavía sin mergear a `main`.
> `git checkout feature/d2` primero si venís de `main`. Asume que ya
> corriste el Track 2 (mismo contenedor `ridepro-postgres`, mismo
> `.env`) — Track 3 (migración `0003`) no es un prerrequisito estricto
> para este track (`workouts` no depende de `equipment`), pero si ya la
> corriste no hace falta deshacerla.

### Comandos exactos

```bash
git checkout feature/d2
cd backend
docker exec -i ridepro-postgres psql -U ridepro -d ridepro_dev < migrations/0004_workouts.sql
```

**Qué esperar de este comando específicamente:**
```
CREATE TABLE
CREATE TABLE
CREATE INDEX
CREATE INDEX
```
(2 `CREATE TABLE` — `workouts` y `workout_intervals` —, 2 `CREATE
INDEX`. Si ves algún `ERROR:` en vez de esto, lo más probable es que el
Track 2 no se haya corrido antes.)

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run test
npm run test:e2e
```

**Qué esperar:**
- `lint`/`tsc --noEmit`/`build`: sin salida de error.
- `npm run test`: `Tests: 68 passed, 68 total` (7 test suites —
  incluye `workouts.service.spec.ts` con 23 tests).
- `npm run test:e2e`: `Tests: 57 passed, 57 total` (7 test suites,
  incluyendo `workouts.e2e-spec.ts` con 16 tests — CRUD completo, 401
  sin token, visibilidad propio/público/ajeno, validación de
  intervalos, 409 sobre archivado, soft-delete idempotente).

### Qué enviarme

1. La salida completa de aplicar `migrations/0004_workouts.sql`.
2. El resumen final de `npm run test` y de `npm run test:e2e`.
3. Si `lint`, `tsc --noEmit` o `build` mostraron algo: pegámelo tal cual.

---

## Qué pasa después de que me envíes esto

- **Si los cuatro tracks pasan sin errores:** marco A3, C2, D1 y D2 como
  verificados en `ROADMAP_M0_M1.md`, y arranco D3 (Rutas) sobre una base
  ya confirmada.
- **Si algo falla:** con el log exacto reviso si es un problema del
  código (lo corrijo) o de configuración de tu entorno (te guío para
  resolverlo) — no avanzo a la siguiente tarea hasta que los tracks
  relevantes estén verdes.
- **Si no podés correr alguno de los tracks** (por ejemplo, no tenés
  Docker ni Postgres instalable ahora mismo): decímelo y seguimos solo
  con los que sí podés validar, dejando el resto explícitamente pendiente
  — no asumo que "probablemente funciona" solo porque otro track pasó.

---

## Solución de problemas comunes

**`firebase: command not found` después de instalarlo:**
```bash
npm config get prefix
echo $PATH
```
Si el prefix no aparece en tu `$PATH`, agregalo a tu `~/.bashrc`/`~/.zshrc`:
```bash
export PATH="$(npm config get prefix)/bin:$PATH"
```
y abrí una terminal nueva.

**`npm test` (Firestore) tarda mucho o parece colgado la primera vez:**
normal — la primera ejecución descarga el binario del emulador de
Firestore (unos ~70MB). Las siguientes veces es mucho más rápido.

**`psql: command not found`:**
Si usaste la Opción A (Docker) y no tenés `psql` instalado localmente,
podés ejecutar la migración DENTRO del contenedor:
```bash
docker exec -i ridepro-postgres psql -U ridepro -d ridepro_dev < migrations/0001_init.sql
```

**Puerto 5432 ya en uso** (por otro Postgres corriendo):
```bash
docker run --name ridepro-postgres -e POSTGRES_USER=ridepro -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=ridepro_dev -p 5433:5432 -d postgres:16
```
y ajustá `DATABASE_URL` en `.env` a `...@localhost:5433/ridepro_dev`.
