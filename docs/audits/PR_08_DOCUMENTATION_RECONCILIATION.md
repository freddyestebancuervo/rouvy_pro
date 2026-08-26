# PR #8 — Reconciliación documental

## Identidad

```text
PR = #8
TITLE = docs(status): update project status after v0.5.0 release
STATE = MERGED
BASE_SHA = b7de233a48147009901b8fe5f7f9f270fe4886dd
HEAD_SHA = 7eaaead7959bdb4726273913250d4ddd45757ed9
MERGE_SHA = 976996c4f93b673c48cd92d9bed6665cfb8999d7
COMMITS = 1
CHANGED_FILES = 1
FILE = PROJECT_STATUS.md
CI_RUN = 30590725908
CI = 3/3 SUCCESS
```

## Qué estableció realmente PR #8

PR #8 creó/actualizó el estado oficial posterior a v0.5.0 y fue exclusivamente documental. El tag anotado `v0.5.0` y el GitHub Release existen y apuntan al commit `2e8cf132f0e8aa7219803c4879b1f90e2c188dd3`.

El propio `PROJECT_STATUS.md` fijó desde su creación una regla de integridad histórica: no reescribir el historial, sino agregar entradas posteriores. Esta reconciliación respeta esa regla.

## Drift documental identificado

El snapshot de PR #8 contiene formulaciones que no deben usarse como estado vigente sin contexto:

1. `A1` aparece como "código en producción real (main)". Estar integrado en `main` prueba integración de código, no un despliegue real del backend a Production.
2. `C2` dice que el despliegue real a un hosting en vivo seguía sin ejecutarse. Esa frase era demasiado amplia: PR #4 ya conservaba evidencia de un despliegue real de **Development** a Cloud Run (`ridepro-backend-dev`). Lo que seguía sin probarse era el despliegue del backend a **Production**.
3. La sección CI afirma que los tres jobs estuvieron verdes en cada PR desde el Bloque 0. La evidencia del HEAD final de PR #4 contradice esa generalización: Flutter y Firestore pasaron, pero Backend e2e terminó en `FAILURE` antes del merge. PR #5 sí cerró después con los tres jobs en verde.
4. "Imagen Docker de producción" describe un contenedor orientado a runtime de producción; no constituye evidencia independiente de un Production deploy.
5. Las referencias a `feature/d2`, WIP de Firebase y próximos bloques son estado punto-en-el-tiempo de 2026-07-30 y quedan sujetas a supersesión por PR posteriores.

## Persistencia y tratamiento al corte PR #95

Al corte exacto PR #95, `PROJECT_STATUS.md` ya contiene una sección superior `ESTADO VIGENTE — LEER PRIMERO` que establece explícitamente que las entradas históricas se preservan y que cualquier afirmación histórica contradicha por evidencia posterior queda `SUPERADA`.

Por tanto, la corrección adecuada para PR #8 **no es reescribir `PROJECT_STATUS.md`**. Hacerlo rompería la regla append-only y borraría el contexto histórico que esta reconciliación intenta proteger. Las precisiones se registran aquí y en la reconciliación secuencial, mientras el estado vigente se interpreta desde la sección actual del documento y la evidencia GitHub correspondiente.

## Resultado

```text
PR_8_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DOCUMENTATION_CLOSED = YES
PROJECT_STATUS.md = PRESERVED_APPEND_ONLY
PROJECT_STATUS_REWRITTEN = NO
CORRECTIONS_RECORDED_EXTERNALLY = YES
V0_5_0_TAG_RELEASE = VERIFIED
DEVELOPMENT_DEPLOY_AT_PR4 = PROVEN
PRODUCTION_DEPLOY_AT_PR8 = NOT_PROVEN
PR4_BACKEND_E2E_PREMERGE = FAILURE_PRESERVED
CI_PR8 = 3_OF_3_SUCCESS
PRODUCTION_MUTATIONS = 0
PROGRESS_DOCUMENTATION_CLOSED = 8/95
NEXT = PR #9
```
