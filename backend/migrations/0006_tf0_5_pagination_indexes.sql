-- Up Migration
-- 0006_tf0_5_pagination_indexes.sql
-- T-F0.5 (docs/tasks/TF0_5_PAGINATION_CONTRACT.md, Tarea #14) —
-- paginación keyset opt-in de `GET /equipment` y `GET /workouts`,
-- fusionada en `main` sin índices (Task15 Fase A los evaluó
-- explícitamente como hipótesis diferida, no como hecho). Estos tres
-- índices son exactamente los que Task15 Fase A midió con evidencia
-- real contra un dataset sintético de 100050 filas por tabla
-- (EXPLAIN ANALYZE, no estimación de producción) — ningún índice
-- adicional, ninguna columna extra, ningún WHERE distinto al medido.
--
-- Equipment: cubre el keyset `user_id = $1 [AND category_code = $N]
-- ORDER BY created_at DESC, id DESC` para AMBOS caminos,
-- `includeArchived=false` e `includeArchived=true` — deliberadamente
-- NO parcial (`WHERE archived_at IS NULL`) porque el candidato parcial
-- equivalente (`task15_tmp_equipment_b`) no ayudó en absoluto al
-- camino `includeArchived=true` (Seq Scan sin cambios, ~10-13ms),
-- mientras que este índice no-parcial resolvió ambos caminos
-- (E1 -95.7%, E2 -76.9%, E5 -98.7%, E6 -96.0%; Sort eliminado en los
-- casos aplicables).
CREATE INDEX idx_equipment_user_created_id
    ON equipment (user_id, created_at DESC, id DESC);

-- Workouts, camino `mine=true`: mismo criterio que
-- `idx_equipment_user_created_id` pero SÍ parcial (`archived_at IS
-- NULL`) porque el repositorio SIEMPRE filtra `archived_at IS NULL` en
-- la ruta paginada de Workouts (a diferencia de Equipment, donde
-- `includeArchived=true` es un modo real y soportado) — no hay ningún
-- camino real que necesite incluir filas archivadas acá, así que un
-- índice parcial es estrictamente más chico sin perder cobertura
-- (W1 -96.6%, W2 -76.9%; Sort eliminado).
CREATE INDEX idx_workouts_owner_created_id
    ON workouts (owner_id, created_at DESC, id DESC)
    WHERE archived_at IS NULL;

-- Workouts, camino `mine=false` (catálogo + públicos de otros
-- usuarios): cubre la porción del `OR` de visibilidad
-- (`owner_id IS NULL OR is_public = TRUE`) que NINGÚN índice existente
-- soportaba — el planner lo combina con `idx_workouts_owner`
-- (histórico) vía BitmapOr para la porción `owner_id = $1` de ese
-- mismo `OR`. Elimina el Seq Scan sobre la tabla completa
-- (W3 -19.6%, W4 -33.7%; buffers compartidos ~1636→555). El `Sort`
-- residual documentado en Task15 (combinar dos bitmaps pierde el
-- orden) es una limitación estructural del predicado `OR` tal como
-- está escrito hoy en el repositorio — corregirla requeriría cambiar
-- el SQL de `WorkoutsRepository.findPageForUser`, explícitamente fuera
-- de alcance de esta migración (solo índices, sin tocar código).
CREATE INDEX idx_workouts_visible_created_id
    ON workouts (created_at DESC, id DESC)
    WHERE archived_at IS NULL
      AND (owner_id IS NULL OR is_public = TRUE);

-- Down Migration
DROP INDEX IF EXISTS idx_workouts_visible_created_id;
DROP INDEX IF EXISTS idx_workouts_owner_created_id;
DROP INDEX IF EXISTS idx_equipment_user_created_id;
