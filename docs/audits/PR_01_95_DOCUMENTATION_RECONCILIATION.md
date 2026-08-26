# Reconciliación documental PR #1 → #95

> Auditoría secuencial de documentación contra evidencia GitHub. El corte autoritativo para esta reconciliación es PR #95 (`72b15fe5e4e6dc59be595b4f685cbe75f148eee2`). Los hechos POST-95 se mantienen fuera de este proceso.

## Reglas

- Revisar PR por PR en orden numérico desde #1 hasta #95.
- Separar hechos históricos de estado vigente.
- No reescribir `PROJECT_STATUS.md` como si sus entradas históricas fueran estado actual.
- Corregir documentación operativa solo cuando exista evidencia suficiente.
- No ejecutar cambios de Production, IAM, base de datos ni despliegues durante esta reconciliación.

## PR #1 — `feat(backend): add Workouts module D2`

### Evidencia GitHub

```text
PR = #1
STATE = MERGED
HEAD_SHA = 7ac9d53f7e13ef140267aca763ef7a508fabbdaf
MERGE_SHA = c2b2da9d395a5a4f03f821fd2854a032e38c4313
BASE_SHA = 9492108539d227a5ff873ba3192c2b6dfe23bffc
CHANGED_FILES = 14
```

El PR integró el módulo D2 Workouts al backend junto con `backend/migrations/0004_workouts.sql`, registro del módulo, DTOs, controller/module/repository/service, unit tests, e2e y cambios documentales en `ROADMAP_M0_M1.md`, `VERIFICATION_GUIDE.md` y `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md`.

### Persistencia al corte PR #95

`backend/migrations/0004_workouts.sql` sigue presente en el árbol exacto de PR #95 y define `workouts` + `workout_intervals`, por lo que D2 no es una rama pendiente: forma parte de la línea integrada de `main` desde PR #1.

### Contradicciones documentales detectadas al corte PR #95

1. `ROADMAP_M0_M1.md` todavía decía que D2 vivía en `feature/d2` y estaba **sin mergear a `main` todavía**.
2. `VERIFICATION_GUIDE.md` todavía instruía `git checkout feature/d2` porque afirmaba que Track 4 no estaba en `main`.
3. `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md` sección 3.10 seguía describiendo D2 como completo en la rama `feature/d2`, sin registrar que el módulo fue integrado por PR #1.

### Acción documental

```text
ROADMAP_M0_M1.md = CORREGIR_ESTADO_DE_MERGE_D2
VERIFICATION_GUIDE.md = ELIMINAR_CHECKOUT_OBSOLETO_FEATURE_D2
TECHNICAL_SPECIFICATION_BLOQUE_D.md = REGISTRAR_D2_MERGED_VIA_PR_1
PROJECT_STATUS.md = NO_REWRITE
```

No se avanzaron estados de D3+ en este cierre; se reconciliarán al llegar a sus PR correspondientes.

### Resultado PR #1

```text
PR_1_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DRIFT_ITEMS = 3
DOCUMENTATION_CLOSED = YES
FILES_FIXED = ROADMAP_M0_M1.md, VERIFICATION_GUIDE.md, docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md
PRODUCTION_MUTATIONS = 0
NEXT = PR #2
```

## PR #2 — `feat: integrate Flutter CI security block 2`

### Evidencia GitHub

```text
PR = #2
STATE = MERGED
BASE_SHA = c2b2da9d395a5a4f03f821fd2854a032e38c4313
HEAD_SHA = 4062595c444ae301164c2f738e94124d1c48905f
MERGE_SHA = 5cc684e43fe5ab6dc4a41411e65facc3f4529b9c
CHANGED_FILES = 57
```

El PR integró el segundo bloque de la historia de `feature/d2` en `main`. Entre los cambios materiales quedaron configuración Firebase/Crashlytics real, cliente de sesión backend en Flutter, feature Flutter de Workouts, endurecimiento CORS, eliminación de credenciales QA hardcodeadas, mejoras de higiene del repo y corrección del job backend de CI para generar claves JWT efímeras y aplicar todas las migraciones pendientes mediante `npm run migrate:up`.

### Persistencia al corte PR #95

La evidencia del árbol exacto de PR #95 confirma que los cambios estructurales de PR #2 no eran temporales:

- `backend/src/config/cors.config.ts` sigue presente y conserva la política fail-closed.
- `.github/workflows/ci.yml` sigue generando el par JWT efímero y ejecutando `npm run migrate:up`.
- La feature Flutter de Workouts integrada por este bloque forma parte de `main`.

### Drift documental detectado

`docs/AUDITORIA_FINAL.md` fue escrito como fotografía previa al merge y todavía afirmaba que ningún commit había sido publicado, ninguna rama fusionada y todo vivía en commits locales de `feature/d2`. Esas afirmaciones eran válidas en la sesión original del 2026-07-23, pero quedaron superadas por PR #2.

No se reescribió la evidencia técnica histórica. Se marcó el documento como **snapshot histórico previo a PR #2** y se enlazó al estado reconciliado posterior.

La inconsistencia del body histórico del propio PR #2 se preserva como metadata histórica; el diff/merge final es la evidencia autoritativa.

### Resultado PR #2

```text
PR_2_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DOCUMENTATION_CLOSED = YES
FILES_FIXED = docs/AUDITORIA_FINAL.md
HISTORICAL_BODY_PRESERVED = YES
CLOSED_PR_BODY_REWRITTEN = NO
PROJECT_STATUS.md = NO_REWRITE
PRODUCTION_MUTATIONS = 0
NEXT = PR #3
```

## PR #3 — `chore(backend): validate production Docker image`

### Evidencia GitHub

```text
PR = #3
STATE = MERGED
BASE_SHA = 5cc684e43fe5ab6dc4a41411e65facc3f4529b9c
HEAD_SHA = 270546380ee5574b398ee5ff951f5b750377bd76
MERGE_SHA = 511a5db50619c0786cd09a9fd1ddc03df42c0590
CHANGED_FILES = 7
CI_RUN = 30514006988 / SUCCESS
```

El PR añadió y validó la base de contenedorización del backend. El diff final incluye `backend/Dockerfile`, `backend/.dockerignore`, separación de `tsconfig.build.json`/`tsconfig.eslint.json`, ajustes de `tsconfig.json` y reglas de `.gitignore` para secretos/artefactos locales. La imagen se diseñó multi-stage, con runtime no-root y `HEALTHCHECK` contra `/v1/health`.

### Persistencia al corte PR #95

En el árbol exacto del corte PR #95, `backend/Dockerfile` sigue presente y evolucionó manteniendo build/runtime separados, runtime `node` no-root y `HEALTHCHECK /v1/health`.

```text
DOCKERFILE_PRESENT_AT_PR95 = YES
MULTI_STAGE = YES
RUNTIME_NON_ROOT = YES
HEALTHCHECK = /v1/health
PR3_CHANGE_PRESERVED = YES
```

### Drift documental detectado

1. `backend/README.md` todavía trataba la contenedorización como pendiente y no incluía `Dockerfile`/`.dockerignore` en su árbol resumido.
2. `docs/audits/AUDITORIA_FINAL/22_AUDITORIA_Y_PLAN_DESPLIEGUE_BACKEND_DEVELOPMENT.md` decía `Dockerfile = No existe`. Esa afirmación era correcta el 2026-07-26 y se conservó como evidencia histórica, añadiendo una nota de supersesión por PR #3.

PR #3 acredita preparación/validación de imagen, no un deploy real de Production.

### Resultado PR #3

```text
PR_3_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DOCUMENTATION_CLOSED = YES
FILES_FIXED = backend/README.md, docs/audits/AUDITORIA_FINAL/22_AUDITORIA_Y_PLAN_DESPLIEGUE_BACKEND_DEVELOPMENT.md
CONTAINERIZATION_STATUS = IMPLEMENTED_VIA_PR_3
PRODUCTION_DEPLOY_INFERRED = NO
HISTORICAL_BODY_PRESERVED = YES
PROJECT_STATUS.md = NO_REWRITE
PRODUCTION_MUTATIONS = 0
NEXT = PR #4
```

## PR #4 — `feat(auth): add Firebase to NestJS authentication bridge`

### Evidencia GitHub

```text
PR = #4
STATE = MERGED
BASE_SHA = 511a5db50619c0786cd09a9fd1ddc03df42c0590
HEAD_SHA = 675bf0d82045fd6ea7131e28919d562aad9d0180
MERGE_SHA = dcc322ea42b1128313fb443fc347c59c32079865
COMMITS = 4
CHANGED_FILES = 58
```

PR #4 incorporó Firebase Admin al backend, la migración `0005_users_firebase_uid.sql`, asociación de identidad por `firebase_uid`, `POST /auth/firebase/exchange`, logout, rate limiting y pruebas de concurrencia. La migración `0005` añade `firebase_uid` nullable y un índice único parcial; al corte PR #95 sigue presente. El controller del corte #95 conserva `POST /auth/firebase/exchange`.

### Evidencia de Development y alcance

La documentación integrada por el propio PR conserva evidencia de un despliegue real de **Development**, no Production: una imagen inmutable fue publicada en Artifact Registry y `ridepro-backend-dev` quedó en la revisión `ridepro-backend-dev-00007-llf`, Ready=True, con 100% del tráfico; `/v1/health` respondió 200 contra base conectada.

Fase 4.1 documentó además una race condition de identidad y un límite aparente del pool bajo concurrencia alta. Parte de ese diagnóstico fue posteriormente refinado y corregido en PR #5.

### CI del HEAD final del PR

```text
CI_RUN = 30562446745
FLUTTER = SUCCESS
FIRESTORE = SUCCESS
BACKEND = FAILURE
FAILED_STEP = Correr los tests e2e
```

El propio cuerpo del PR advertía que no debía fusionarse mientras los checks requeridos siguieran rojos; GitHub registra, sin embargo, `merged=true`. Esta reconciliación conserva el run rojo como evidencia histórica y no lo convierte retrospectivamente en PASS.

### Drift documental detectado

`backend/README.md` seguía afirmando al corte PR #95 que no existía puente Firebase↔NestJS, que el backend JWT era completamente independiente de Firebase Auth, que no había backend desplegado en ningún entorno cloud real y que había solo cuatro migraciones.

Los documentos históricos previos al PR #4 se preservaron como snapshots punto-en-el-tiempo. `docs/TECHNICAL_SPECIFICATION_M0_M1.md` no se reescribió como una migración completa del cliente porque PR #4 no modificó Flutter.

### Resultado PR #4

```text
PR_4_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DOCUMENTATION_CLOSED = YES
FILES_FIXED = backend/README.md
FIREBASE_NEST_BRIDGE = IMPLEMENTED
ENDPOINT = POST /v1/auth/firebase/exchange
MIGRATION_0005 = PRESENT
DEVELOPMENT_CLOUD_RUN_DEPLOY = PROVEN
PRODUCTION_DEPLOY = NOT_PROVEN_BY_PR4
FLUTTER_FULL_AUTH_MIGRATION = NOT_INFERRED
HISTORICAL_DOCS_REWRITTEN = NO
PROJECT_STATUS.md = UNTOUCHED
PRODUCTION_MUTATIONS = 0
NEXT = PR #5
```

## PR #5 — `fix(backend): prevent PostgreSQL pool self-deadlock`

### Evidencia GitHub

```text
PR = #5
STATE = MERGED
BASE_SHA = dcc322ea42b1128313fb443fc347c59c32079865
HEAD_SHA = 2d7c5a43129669d098dd40bd7039b9436b8db760
MERGE_SHA = af1c0ad8a98f13130af4d93368fa894862c9de80
COMMITS = 6
CHANGED_FILES = 25
CI_RUN = 30585106473
CI = SUCCESS
```

PR #5 no añadió migraciones ni dependencias nuevas. Su núcleo fue corregir la concurrencia del puente Firebase→NestJS/PostgreSQL sin aumentar el tamaño del pool ni esconder el defecto con retries indiscriminados.

### Causa raíz y corrección

La investigación de Fase 4.2.1 demostró que los timeouts observados en las ráfagas sobre la misma identidad no eran simplemente “Postgres lento” ni una necesidad automática de aumentar `DATABASE_POOL_MAX`. El camino de recuperación tras una colisión `23505` retenía un `client` obtenido con `pool.connect()` y, antes de liberarlo, llamaba a `findByFirebaseUid`, que intentaba adquirir **otra** conexión del mismo pool. Con suficientes perdedores concurrentes, todas las conexiones podían quedar retenidas esperando una conexión adicional imposible: un self-deadlock del lado de Node/`pg-pool`.

La corrección reutiliza el mismo `client` ya retenido para consultar al ganador tras el `ROLLBACK`. El árbol exacto del PR #95 conserva ese patrón: `winnerResult = await client.query(...)` y el `client.release()` ocurre en `finally`.

También se unificó la búsqueda inicial de candidatos por `firebase_uid`/email en una sola consulta parametrizada para reducir ventanas entre snapshots.

### Rate limit híbrido y saturación temporal

PR #5 cambió el exchange de un único bucket de 20/15min por IP a un esquema por capas:

```text
CAPA_1_PUBLIC_IP = 60 / 15 min
CAPA_2_VERIFIED_UID = 20 / 15 min (UID hasheado SHA-256)
CAPA_3_VERIFIED_IP = 100 / 15 min
```

La capa por identidad se aplica únicamente después de verificar el ID token. El `firebase_uid` completo no se usa como clave ni se registra en claro.

Los timeouts temporales de adquisición del pool se reconocen de forma estrecha y se traducen a:

```text
HTTP = 503
CODE = DATABASE_TEMPORARILY_UNAVAILABLE
RETRY_AFTER = 2
```

Los errores SQL reales que traen `.code` no se clasifican como ese timeout de `pg-pool`.

### Estabilización E2E final

El último commit del PR resolvió un problema separado: `auth-firebase-exchange-concurrency-existing-user.e2e-spec.ts` podía producir `read ECONNRESET` porque el harness hacía `app.init()` pero no dejaba un listener estable. `createTestApp()` pasó a ejecutar `await app.listen(0)`, usando un puerto efímero una sola vez para evitar carreras de listeners implícitos de `supertest`.

El fix no redujo concurrencia, no añadió sleeps/retries ni saltó tests.

### CI final

GitHub Actions conserva el run `30585106473` sobre el HEAD final exacto `2d7c5a4...` con los tres jobs en verde:

```text
Flutter — analyze + test = SUCCESS
Firestore — reglas de seguridad (A3/A5) = SUCCESS
Backend — migración + e2e (C2) = SUCCESS
```

El job Backend aplicó todas las migraciones, levantó `/v1/health` y terminó los e2e con éxito.

### Persistencia al corte PR #95

Los cambios estructurales de PR #5 siguen presentes en el árbol exacto del corte #95:

- `UsersRepository.upsertByFirebaseUid` conserva `findIdentityCandidates()` en una consulta y la reconsulta del ganador mediante el mismo `client` ya adquirido.
- `AuthService.exchangeFirebaseToken` conserva los buckets por UID hasheado y por IP verificada.
- `ApiExceptionFilter` conserva la traducción del timeout temporal del pool a `503` con `Retry-After`.
- `backend/test/utils/test-app.ts` conserva `await app.listen(0)`.

### Deuda explícita preservada

La revisión independiente de los commits de PR #5 dejó dos gaps no bloqueantes que **no se maquillan como resueltos**:

1. Una carrera muy específica en el `UPDATE` de una identidad Firebase ya existente puede propagar un `23505` como `500` en lugar de traducirlo a `409 FIREBASE_EMAIL_CONFLICT`.
2. El almacenamiento del rate limiter sigue siendo en memoria por instancia y la cardinalidad de claves por UID puede crecer en una instancia de vida larga; un storage distribuido quedó diferido hasta que el volumen real lo justifique.

Además, aunque el self-deadlock fue corregido, la topología medida seguía con margen estrecho: Cloud SQL 25 conexiones máximas / 22 usables y Cloud Run hasta 2 instancias × pool 10. PR #5 deliberadamente no aumentó conexiones sin una decisión de capacidad separada.

### Drift documental detectado y corrección aplicada

Tras cerrar PR #4, nuestro `backend/README.md` todavía describía el agotamiento con 20 concurrentes como un “límite del pool pendiente” y proponía “resolver el límite del pool” como siguiente paso. PR #5 demostró que una parte crítica del síntoma era un self-deadlock de código y lo corrigió; mantener el texto anterior habría dejado una causa raíz equivocada como estado vigente.

Se actualizó `backend/README.md` para registrar:

```text
SELF_DEADLOCK = FIXED_VIA_PR_5
HYBRID_RATE_LIMIT = IMPLEMENTED
POOL_TIMEOUT_503 = IMPLEMENTED
E2E_STABLE_LISTENER = IMPLEMENTED
POOL_SIZE_INCREASE = NO
CI_HEAD_3_OF_3 = SUCCESS
CAPACITY_MARGIN_NARROW = STILL_TRUE
H1_UPDATE_23505 = OPEN_NONBLOCKING_DEBT
H2_RATE_LIMIT_CARDINALITY = OPEN_NONBLOCKING_DEBT
```

Los documentos `docs/audits/AUDITORIA_FINAL/fase_4_2/*` se conservan como evidencia histórica detallada. No se borraron sus hipótesis iniciales: el propio documento 08 contiene la corrección de registro y remite al documento 10 como referencia autoritativa para la causa raíz.

### Resultado PR #5

```text
PR_5_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DOCUMENTATION_CLOSED = YES
FILES_FIXED = backend/README.md
HISTORICAL_DOCS_REWRITTEN = NO
PROJECT_STATUS.md = UNTOUCHED
PRODUCTION_MUTATIONS = 0
PROGRESS_DOCUMENTATION_CLOSED = 5/95
NEXT = PR #6
```

## Estado del recorrido

```text
PR_1_DOCUMENTATION = CLOSED
PR_2_DOCUMENTATION = CLOSED
PR_3_DOCUMENTATION = CLOSED
PR_4_DOCUMENTATION = CLOSED
PR_5_DOCUMENTATION = CLOSED
PROJECT_STATUS.md = UNTOUCHED
PRODUCTION_MUTATIONS = 0
PROGRESS_DOCUMENTATION_CLOSED = 5/95
NEXT = PR #6
```
