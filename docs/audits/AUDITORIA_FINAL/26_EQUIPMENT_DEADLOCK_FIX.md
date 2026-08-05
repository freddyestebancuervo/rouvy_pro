# Korixa — Documento 26: Corrección de deadlock en `EquipmentRepository.applyDefault()`

- **Fecha:** 2026-08-03
- **Rol:** Arquitecto de Software Senior / Auditor Técnico
- **Alcance:** backend (`C2`), módulo `equipment`. **Sin relación con T-F0.2** — hallazgo detectado incidentalmente durante la investigación de un fallo de CI en la PR #26 (T-F0.2 Bloque 6), corregido en una rama completamente independiente por solicitud explícita del propietario, para preservar la trazabilidad de ambos trabajos.
- **SHA base de `main`:** `c3d95bdec56f44aa136387d4335fe0dee59aa966`.
- **Rama y worktree:** `fix/equipment-applydefault-deadlock-20260803`, worktree aislado. `feature/d2` verificada intacta (HEAD `7fe75a6`, 80 líneas locales) antes y después. PR #26 no fue tocada en ningún momento de este trabajo.

---

## 1. Resumen ejecutivo

`EquipmentRepository.applyDefault()` (`backend/src/modules/equipment/equipment.repository.ts`) bloqueaba todas las filas de `equipment` de un `(user_id, category_code)` con `SELECT ... FOR UPDATE` sin `ORDER BY`. Bajo escritura concurrente real (varias requests marcando equipos distintos como default en la misma categoría), transacciones distintas podían adquirir esos locks en orden diferente, produciendo un deadlock genuino de PostgreSQL — confirmado con el log real de CI de la PR #26 (`error: deadlock detected`, SQLSTATE `40P01`). Corregido agregando `ORDER BY id` a esa única consulta.

---

## 2. Diagnóstico (resumen; análisis completo ya revisado y aprobado en las auditorías previas a este bloque)

- **Causa raíz:** el índice que soporta la consulta (`idx_equipment_user_active ON equipment (user_id, category_code) WHERE archived_at IS NULL`) tiene la misma clave para todas las filas de un grupo — un B-tree no define orden secundario entre entradas con clave idéntica, por lo que el orden de recorrido puede variar entre escaneos concurrentes.
- **Auditoría exhaustiva del backend:** confirmó que esta es la única consulta en todo el código que bloquea múltiples filas de `equipment` sin orden determinístico. `RefreshTokensRepository.rotate()` (única otra `FOR UPDATE` del backend) bloquea una sola fila por clave única, sin ambigüedad posible. `archive()` es un `UPDATE` autocommit de una sola fila — probado formalmente que no puede participar en ningún ciclo de deadlock (nunca retiene un lock mientras espera un segundo). No existe ningún `DELETE FROM` en todo el backend, ni triggers/funciones en las migraciones.
- **Demostración formal:** con `ORDER BY id`, toda transacción concurrente adquiere los locks del grupo en el mismo orden absoluto — el grafo de espera resultante es acíclico por construcción (una transacción solo puede esperar un lock de rango mayor al que ya tiene), lo que descarta estructuralmente cualquier ciclo.

---

## 3. Cambio implementado

Único archivo modificado: `backend/src/modules/equipment/equipment.repository.ts`.

```diff
     await client.query(
       `SELECT id FROM equipment
        WHERE user_id = $1 AND category_code = $2 AND archived_at IS NULL
+       ORDER BY id
        FOR UPDATE`,
       [userId, categoryCode],
     );
```

`create()` hereda la corrección automáticamente (invoca el mismo `applyDefault()` privado) — no requiere cambio propio. No se modificó ningún test.

---

## 4. Validaciones ejecutadas

| # | Validación | Resultado |
|---|---|---|
| 1 | `git diff --check` | Limpio |
| 2 | Lint (`eslint`, sin `--fix`) | 0 issues |
| 3 | Pruebas unitarias (`npm test`) | 11 suites, **122/122** en verde |
| 4 | Suite e2e completa (`npm run test:e2e`, Postgres 16 real vía Docker, mismas env vars que CI) | 14 suites, **86/86** en verde |
| 5 | Test de concurrencia original (5 ítems), 15 repeticiones consecutivas | 15/15 en verde |
| 6 | Diff limitado al archivo autorizado | Confirmado — 1 archivo, 1 línea |
| 7 | `feature/d2` intacta | Confirmado, antes y después |

---

## 5. Evidencia empírica directa (antes/después)

El test original (5 ítems concurrentes) no reprodujo el deadlock localmente de forma consistente en 15 intentos — comportamiento esperado, ya que el bug depende del timing real de PostgreSQL bajo concurrencia, y el entorno local (Docker en loopback) tiene características de latencia distintas a los runners de GitHub Actions donde sí se manifestó.

Para obtener una demostración empírica directa además del log de CI ya analizado, se construyó una copia temporal **no rastreada** del test con 25 ítems concurrentes en vez de 5 (mayor contención → mayor probabilidad de colisión de orden), eliminada al finalizar — el test real nunca fue modificado (confirmado con `git status`).

- **Sin el fix** (revertido temporalmente vía `git stash`): **8/8 corridas fallaron** con `deadlock detected` real, idéntico al de CI.
- **Con el fix restaurado:** **10/10 corridas en verde**, cero apariciones de `deadlock detected`, las 25 requests concurrentes completadas con `200`.

---

## 6. Qué no cambia

Comportamiento funcional (resultado final idéntico: exactamente 1 `is_default` por categoría/usuario), consistencia transaccional (mismo nivel de aislamiento, mismo alcance de filas bloqueadas), y el contrato de `applyDefault()`/`create()`/`update()` (misma firma, mismo tipo de retorno). Único cambio: el orden interno, no observable externamente, en que se adquieren los locks.

---

## 7. Estado de integración

Commit funcional `10bd74b04ff1439bad36fb51ad7996076032fe68` (padre `c3d95bdec56f44aa136387d4335fe0dee59aa966`), commit documental de este mismo bloque. **Pendiente de push, PR y fusión** — no ejecutados hasta esta etapa de la tarea. Completamente independiente de la PR #26 (T-F0.2 Bloque 6): ningún archivo en común, sin cherry-pick, sin rebase, sin mezcla de historial.

---

**Detenido aquí. Sin merge — a la espera de autorización explícita.**
