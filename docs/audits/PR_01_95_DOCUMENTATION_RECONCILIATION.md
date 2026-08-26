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
