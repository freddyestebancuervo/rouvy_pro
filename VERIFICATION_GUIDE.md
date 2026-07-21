# Guía de verificación — A3 (Firestore) y C2 (Backend/Postgres)

> **¿Sin acceso a una terminal (por ejemplo, trabajando solo desde el
> celular)?** Ver `CI_CD_GUIDE.md` — configuré GitHub Actions para correr
> estos mismos 3 tracks automáticamente en la nube, viendo los resultados
> desde el navegador del celular, sin instalar nada localmente.

**Antes de seguir con C3**, según lo acordado. Dos tracks independientes
— podés correrlos en cualquier orden, o en paralelo en dos terminales.
Ninguno depende del otro.

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
node --version   # 18+
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

## Qué pasa después de que me envíes esto

- **Si ambos tracks pasan sin errores:** marco A3 y C2 como verificadas
  en `ROADMAP_M0_M1.md` y `docs/SECURITY_AUDIT.md`, y arranco C3
  (`POST /auth/register` y `POST /auth/login` reales) sobre una base ya
  confirmada.
- **Si algo falla:** con el log exacto reviso si es un problema de las
  reglas/código (lo corrijo) o de configuración de tu entorno (te guío
  para resolverlo) — no avanzo a C3 hasta que ambos tracks estén verdes.
- **Si no podés correr uno de los dos tracks** (por ejemplo, no tenés
  Docker ni Postgres instalable ahora mismo): decímelo y seguimos solo
  con el que sí podés validar, dejando el otro explícitamente pendiente
  — no asumo que "probablemente funciona" solo porque el otro track pasó.

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
