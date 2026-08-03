# Korixa — Documento 25: Alias nombrados en `.firebaserc` (T-F0.2 / C1, Bloque 6)

- **Fecha:** 2026-08-03
- **Rol:** Arquitecto de Software Senior / Auditor Técnico
- **Alcance de esta tarea:** puramente aditivo, un solo archivo. Cero cambios de código Dart/Gradle, cero cambios de infraestructura Firebase/GCP en ejecución.
- **SHA base de `main`:** `c3d95bdec56f44aa136387d4335fe0dee59aa966` (confirmado con `git fetch origin` antes de iniciar; verificado de nuevo sin cambios en cada etapa posterior).
- **Rama y worktree:** `docs/tf02-firebaserc-aliases-20260803`, worktree aislado. `feature/d2` verificada intacta (HEAD `7fe75a6`, 80 líneas locales) antes y después de todo el bloque.

---

## 1. Resumen ejecutivo

Cierra la Puerta B del Documento 15 §12 para Development y Production: `.firebaserc` gana los alias nombrados `development` → `ridepro-development` y `production` → `ridepro-dbafe`, exigidos por el diseño original (Documento 15 §3.2) y por el Documento 23 §9 como uno de los 6 pendientes para reconsiderar el cierre de `C1`. El alias `default` (`demo-ridepro-security-tests`) permanece exactamente igual — no se modificó, no se eliminó, no se re-mapeó.

---

## 2. Auditoría previa (solo lectura, antes de escribir el archivo)

Revisados: `.firebaserc`, `firebase.json`, los 3 workflows de `.github/workflows/` (`ci.yml`, `ios-build.yml`, `ios-simulator-smoke.yml`), y cualquier script del repositorio con referencias a `firebase use`, `--project` o `.firebaserc`.

**Hallazgos:**
- Ningún workflow de CI usa `firebase use` ni lee `.firebaserc` directamente.
- El único job de CI que toca Firebase (`firestore-rules-tests` en `ci.yml`) delega en `firebase/rules-tests/package.json`, cuyo script `test` ejecuta `firebase emulators:exec --config ../../firebase.json --project=demo-ridepro-security-tests --only firestore "jest --runInBand"` — pasa el `projectId` de forma **explícita** vía `--project=`, sin depender de la resolución de ningún alias.
- `firebase/seed/seed_emulator.js` solo menciona `.firebaserc` en comentarios explicativos, no lo lee programáticamente.
- `firebase.json` ya referencia `ridepro-development`/`ridepro-dbafe` explícitamente por `projectId` en `flutter.platforms.android`/`flutter.dart` (desde el Bloque 5A) — no depende de `.firebaserc` para resolver esos proyectos.

**Conclusión de la auditoría:** agregar alias nuevos es seguro — ningún flujo existente depende de la forma actual del archivo, y el único consumidor real bypassa la resolución de alias por completo.

---

## 3. Cambio implementado

Único archivo modificado: `.firebaserc`.

```diff
 {
   "projects": {
-    "default": "demo-ridepro-security-tests"
+    "default": "demo-ridepro-security-tests",
+    "development": "ridepro-development",
+    "production": "ridepro-dbafe"
   }
 }
```

---

## 4. Validaciones ejecutadas

| # | Prueba | Resultado |
|---|---|---|
| 1 | Sintaxis JSON | Válida |
| 2 | `firebase use development` | Resuelve `ridepro-development` |
| 3 | `firebase use production` | Resuelve `ridepro-dbafe` |
| 4 | `firebase use default` | Falla — **comportamiento preexistente**, no una regresión. Confirmado ejecutando la misma prueba contra una copia del `.firebaserc` original sin tocar (extraída de `origin/main`): el error es idéntico antes y después. Causa raíz: `demo-ridepro-security-tests` es un `projectId` ficticio, exclusivo del emulador (nunca existió como proyecto Firebase real en la API de gestión), por lo que `firebase use` interactivo —que sí valida existencia real— siempre falló para él, incluso antes de este bloque. |
| 5 | `git diff --check` | Limpio |
| 6 | Diff limitado a `.firebaserc` | Confirmado |
| 7 | `feature/d2` intacta | Confirmado, antes y después |

---

## 5. Riesgos

Ninguno nuevo. El cambio es puramente aditivo y no fue consumido por ningún flujo existente antes de este bloque (verificado en la sección 2). El único riesgo teórico —que algún flujo futuro empiece a depender de `firebase use` sin `--project` explícito— queda mitigado por la existencia de los alias correctos ahora disponibles.

---

## 6. Estado de la Puerta B (Documento 15 §12)

**Antes de este bloque:** no cumplida — `.firebaserc` sin alias nombrados, ni siquiera para Production.
**Después de este bloque:** cumplida para Development y Production. Staging permanece "no iniciado" (ningún proyecto existe todavía) — consistente con el resto de la documentación, sin alias fabricado para un entorno inexistente.

---

## 7. Próximo pendiente

De los 6 puntos originales del Documento 23 §9, con Bloque 5A (Puerta E, parcial) y Bloque 6 (Puerta B, cumplida) ya ejecutados, quedan: SHA-1/SHA-256 de Android Development (completa Puerta E), Puerta H (CI/CD), desviación D4 (Spark/Blaze), prueba de reglas contra el proyecto real (Puerta D), y ensayo de rollback (Puerta J). Ninguno autorizado a ejecutarse en este documento.

---

**Detenido aquí. Sin push, sin PR, sin fusión — a la espera de autorización explícita para el commit documental.**
