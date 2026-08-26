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

1. `ROADMAP_M0_M1.md` todavía dice que D2 vive en `feature/d2` y que está **sin mergear a `main` todavía**. Esto contradice el hecho de que PR #1 fue fusionado.
2. `VERIFICATION_GUIDE.md` todavía instruye `git checkout feature/d2` porque afirma que Track 4 no está en `main`. Esa instrucción quedó obsoleta al fusionarse PR #1.
3. `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md` sección 3.10 sigue describiendo D2 como completo en la rama `feature/d2`, sin registrar que el módulo fue integrado por PR #1.

### Acción documental requerida

```text
ROADMAP_M0_M1.md = CORREGIR_ESTADO_DE_MERGE_D2
VERIFICATION_GUIDE.md = ELIMINAR_CHECKOUT_OBSOLETO_FEATURE_D2
TECHNICAL_SPECIFICATION_BLOQUE_D.md = REGISTRAR_D2_MERGED_VIA_PR_1
PROJECT_STATUS.md = NO_REWRITE
```

No se cambian todavía otros estados de D3+ en esta entrada: se reconciliarán al llegar a sus PR correspondientes para evitar adelantar evidencia.

### Resultado PR #1

```text
PR_1_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DRIFT_ITEMS = 3
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

El PR integró el segundo bloque de la historia de `feature/d2` en `main`. Entre los cambios materiales quedaron: configuración Firebase/Crashlytics real, cliente de sesión backend en Flutter, feature Flutter de Workouts, endurecimiento CORS, eliminación de credenciales QA hardcodeadas, mejoras de higiene del repo y corrección del job backend de CI para generar claves JWT efímeras y aplicar todas las migraciones pendientes mediante `npm run migrate:up`.

### Persistencia al corte PR #95

La evidencia del árbol exacto de PR #95 confirma que los cambios estructurales de PR #2 no eran temporales:

- `backend/src/config/cors.config.ts` sigue presente y conserva la política fail-closed: allowlist explícita cuando existe `CORS_ALLOWED_ORIGINS`, localhost únicamente fuera de Production y `origin: false` en Production sin configuración.
- `.github/workflows/ci.yml` sigue generando el par JWT efímero y ejecutando `npm run migrate:up`; esos mecanismos fueron posteriormente ampliados, pero la corrección base introducida en PR #2 permaneció.
- La feature Flutter de Workouts integrada por este bloque forma parte de `main`; por tanto las referencias históricas a trabajo exclusivamente local en `feature/d2` ya no describen el estado del repositorio.

### Drift documental detectado al corte PR #95

`docs/AUDITORIA_FINAL.md` fue escrito como fotografía previa al merge y **no volvió a modificarse después de los commits incorporados por PR #2**. Su encabezado todavía afirma:

```text
Rama = feature/d2
ningún commit fue publicado (push)
ninguna rama fue fusionada (merge)
todo vive en commits locales sin upstream
```

Esas afirmaciones eran válidas en la sesión de auditoría del 2026-07-23, pero quedaron superadas cuando PR #2 fue fusionado a `main`. Como el archivo se titula `Auditoría final del repositorio` y no contiene un aviso de supersesión, puede interpretarse erróneamente como estado vigente.

### Precisión histórica que debe preservarse

No se debe borrar ni reescribir la evidencia técnica de la auditoría original: los 186 tests Flutter, 73 unit backend, 57 e2e, validaciones CORS y las observaciones de ese momento siguen siendo evidencia histórica. La corrección segura es marcar explícitamente el documento como **snapshot histórico previo a PR #2** y enlazar al estado reconciliado posterior, no convertir retrospectivamente sus resultados de 2026-07-23 en resultados actuales.

También se detecta una inconsistencia dentro de la descripción histórica del propio PR #2: el texto advertía que CI seguía en Flutter 3.24.0 y `firebase-tools` sin fijar, mientras el diff final del PR ya contiene `flutter-version: '3.32.0'` y `firebase-tools@14.27.0`. Para la reconciliación del repositorio se toma el **diff/merge final como evidencia autoritativa**; no se modifica la descripción del PR cerrado.

### Acción documental requerida

```text
AUDITORIA_FINAL.md = AGREGAR_BANNER_HISTORICO_SUPERADO_POR_PR_2
AUDITORIA_FINAL.md = CONSERVAR_EVIDENCIA_2026_07_23_SIN_REESCRIBIRLA
PR_BODY_2 = HISTORICAL_METADATA_NO_EDIT
PROJECT_STATUS.md = NO_REWRITE
```

### Resultado PR #2

```text
PR_2_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DRIFT_ITEMS = 1 REPOSITORY_DOC + 1 HISTORICAL_PR_METADATA_INCONSISTENCY
PRODUCTION_MUTATIONS = 0
PROGRESS = 2/95
NEXT = PR #3
```
