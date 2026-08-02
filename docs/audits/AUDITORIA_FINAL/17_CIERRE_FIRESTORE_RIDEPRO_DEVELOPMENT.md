# RidePro — Documento 17: Cierre de la Sub-fase Firestore — `ridepro-development`
## Fase 1 de la Parte B (`T-F0.2`/`C1`) — Creación del entorno Development

- **Fecha:** 2026-07-25
- **Rol:** Lead Software Engineer / Software Architect / DevOps Engineer / Auditor Técnico / Security Engineer / Release Manager
- **Alcance de este cierre:** únicamente la creación del proyecto Firebase `ridepro-development` y la habilitación/configuración de **Firestore** (base de datos, reglas, índices). **No cierra toda la Fase 1** de `16_PLAN_EJECUCION_FASE1_RIDEPRO_DEV.md` — Storage, Authentication y la verificación final consolidada de esa fase siguen pendientes (ver sección 7).
- **Fuente de verdad del estado del proyecto:** `PROJECT_STATUS.md` (raíz) — este documento se referencia desde ahí, no lo duplica.

---

## 1. Resumen Ejecutivo

Se creó el segundo proyecto Firebase real de RidePro, `ridepro-development` (Project Number `1020003121433`), aislado de producción (`ridepro-dbafe`), y se habilitó Cloud Firestore en la región `southamerica-east1` (São Paulo, decisión D4/D5 y aprobación explícita del propietario). Se desplegaron `firestore.rules` (idénticas al archivo fuente ya auditado en la Auditoría Oficial) y `firestore.indexes.json` (corregido durante esta misma tarea, eliminando un índice redundante que Firestore rechazaba activamente). Todo el proceso quedó documentado paso a paso, con al menos 3 detenciones ante resultados inesperados (nombre de proyecto no disponible, API de Firestore deshabilitada, índice rechazado), cada una resuelta solo tras autorización explícita del propietario — ninguna corrección se aplicó sin presentar evidencia y esperar aprobación primero.

## 2. Cronología completa (trazabilidad total)

| # | Evento | Resultado |
|---|---|---|
| 1 | Intento de crear proyecto `ridepro-dev` | ❌ Falló — ID ya tomado globalmente por un tercero ajeno a esta cuenta |
| 2 | Propietario aprobó nombre de respaldo `ridepro-development` | — |
| 3 | Proyecto `ridepro-development` creado | ✅ Éxito |
| 4 | Intento de determinar región de Firestore de producción (`ridepro-dbafe`) para replicarla | ❌ Reveló que Firestore **nunca fue habilitado en producción** — hallazgo nuevo, documentado, no corregido (fuera de alcance) |
| 5 | Propietario decidió: continuar con Development usando región propia (`southamerica-east1`) | Opción A aprobada |
| 6 | Intento de crear base de datos Firestore en `ridepro-development` | ❌ Falló — API `firestore.googleapis.com` deshabilitada |
| 7 | Investigación técnica de solo lectura sobre la causa | Confirmó `SERVICE_DISABLED`, no un problema de permisos |
| 8 | Propietario habilitó la API manualmente (Console) | — |
| 9 | Base de datos Firestore creada, región `southamerica-east1` confirmada vía JSON de la API | ✅ Éxito |
| 10 | Intento de deploy conjunto de `firestore.rules` + `firestore.indexes.json` | ❌ Falló — índice de `ride_sessions`/`startTime` rechazado por Firestore como innecesario |
| 11 | Auditoría de solo lectura del índice rechazado | Confirmó: índice de un solo campo, redundante con el indexado automático de Firestore |
| 12 | Corrección de `firestore.indexes.json` (0 índices) | Aprobada y aplicada |
| 13 | Deploy final de `firestore.rules` + `firestore.indexes.json` | ✅ Éxito |

## 3. Evidencia — `firestore.rules` desplegado correctamente

```
i  cloud.firestore: checking firestore.rules for compilation errors...
+  cloud.firestore: rules file firestore.rules compiled successfully
i  firestore: uploading rules firestore.rules...
+  firestore: released rules firestore.rules to cloud.firestore
+  Deploy complete!
```

Esta es la evidencia estándar que la propia Firebase CLI provee para confirmar un despliegue exitoso de reglas (mismo criterio de evidencia ya aceptado en cierres anteriores para `flutter analyze`/`flutter test`: el resultado explícito de la herramienta, no una re-verificación manual del contenido). **Limitación de verificación, declarada honestamente:** la Firebase CLI no expone ningún comando de solo lectura para descargar y comparar el contenido de las reglas ya publicadas contra el archivo fuente — esa comparación solo sería posible desde Firebase Console (sin acceso a navegador en este entorno). El archivo desplegado es exactamente `firestore.rules` de la raíz del repositorio, sin ninguna modificación de contenido en esta tarea (solo se corrigió `firestore.indexes.json`).

## 4. Confirmación — `firestore.indexes.json` con 0 índices

**Antes de esta tarea:**
```json
{
  "indexes": [
    { "collectionGroup": "ride_sessions", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "startTime", "order": "DESCENDING" }] }
  ],
  "fieldOverrides": []
}
```

**Después (contenido real del archivo, y confirmado en vivo contra el proyecto):**
```json
{ "indexes": [], "fieldOverrides": [] }
```

Verificación directa contra el proyecto (`firebase firestore:indexes --project ridepro-development --json`), ejecutada **después** del deploy exitoso:
```json
{ "status": "success", "result": { "indexes": [], "fieldOverrides": [] } }
```

Coincide exactamente. La única consulta real del proyecto contra `ride_sessions` (`ride_session_remote_datasource.dart:50-53`, `orderBy('startTime', descending: true).limit(30)`, sin `where()`) sigue funcionando, servida por el índice automático de campo único de Firestore — confirmado en la auditoría previa (Documento de auditoría del índice, sin ID formal todavía).

## 5. Confirmación — ningún otro servicio de Firebase fue modificado

| Servicio | Verificación | Resultado |
|---|---|---|
| Apps registradas (Android/iOS/Web) | `firebase apps:list --project ridepro-development` (ejecutado 4 veces a lo largo de esta serie de tareas) | "No apps found" — consistente en las 4 verificaciones |
| Authentication | Ningún comando ejecutado contra este servicio | Sin cambios — sigue en estado por defecto de un proyecto nuevo |
| Storage | Ningún comando ejecutado contra este servicio | Sin cambios |
| Hosting | Ningún comando ejecutado contra este servicio | Sin cambios |
| Functions | Ningún comando ejecutado contra este servicio | Sin cambios (tampoco existen en el repositorio) |
| App Check / Analytics | Ningún comando ejecutado | Sin cambios |
| `ridepro-dbafe` (Producción) | Solo 1 llamada de solo lectura en toda la serie (`firestore:databases:list`, para investigar la región) | Sin ninguna escritura, en ningún momento |

El propio flag `--only firestore:rules,firestore:indexes` usado en el deploy es, en sí mismo, una garantía técnica (no solo una promesa) de que ningún otro recurso pudo ser tocado por ese comando.

## 6. Confirmación — el repositorio quedó consistente

`git status --short` / `git diff --stat`, verificado inmediatamente después del deploy final: el único archivo modificado por toda esta serie de tareas (creación del proyecto + Firestore) es **`firestore.indexes.json`** (8 líneas → 3 líneas de contenido neto). Los demás archivos `M`/`??` listados en `git status` corresponden a tareas ya cerradas y reportadas en documentos anteriores (`12`, `13`, `14`), sin relación con esta tarea. Ningún commit fue creado — todos los cambios permanecen en el árbol de trabajo, pendientes de que el propietario decida cuándo confirmar (`git add`/`git commit`), acción que en ningún momento de esta tarea fue autorizada ni ejecutada.

## 7. Checklist de Salida — alcance de ESTA sub-fase (Firestore), no de la Fase 1 completa

| # | Ítem | Estado | Evidencia |
|---|---|---|---|
| 1 | Proyecto `ridepro-development` creado | ✅ Cumplido | Sección 2, evento 3 |
| 2 | Firestore habilitado, región `southamerica-east1` | ✅ Cumplido | Sección 2, evento 9 — JSON con `locationId` |
| 3 | `firestore.rules` desplegadas | ✅ Cumplido | Sección 3 |
| 4 | `firestore.indexes.json` corregido y desplegado (0 índices) | ✅ Cumplido | Sección 4 |
| 5 | Sin efectos secundarios en otros servicios | ✅ Cumplido | Sección 5 |
| 6 | Repositorio consistente | ✅ Cumplido | Sección 6 |
| 7 | Cada desviación del plan original (`16_...md`) documentada antes de corregirse | ✅ Cumplido | Sección 2 — 3 detenciones, 3 autorizaciones explícitas |
| 8 | **Storage habilitado** (parte de la Fase 1 original de `16_...md`) | ⏳ **Pendiente — fuera de alcance de esta tarea** | No ejecutado |
| 9 | **Authentication + proveedores habilitados** (parte de la Fase 1 original) | ⏳ **Pendiente — fuera de alcance de esta tarea** | No ejecutado; recordar además la limitación ya documentada en `16_...md` §Paso 1.4 (posible configuración adicional de OAuth fuera de Firebase) |
| 10 | Verificación final consolidada de toda la Fase 1 (`16_...md` §6) | ⏳ **Pendiente** — depende de los ítems 8-9 | — |

## 8. Riesgos y hallazgos abiertos (sin resolver en esta tarea, registrados para trazabilidad)

| Hallazgo | Severidad | Estado |
|---|---|---|
| Cloud Firestore nunca fue habilitado en `ridepro-dbafe` (Producción) — contradice la caracterización de "Firestore activo" en varios documentos de la Auditoría Oficial | A determinar por el propietario | Abierto, documentado en el turno anterior a este cierre, sin ID de backlog todavía |
| `firestore.indexes.json` tenía un índice redundante (corregido en esta tarea) | Baja, ya resuelta | ✅ Cerrado |
| Storage/Authentication de `ridepro-development` sin habilitar | Bloquea el cierre completo de la Fase 1 de `16_...md` | Abierto, siguiente paso natural (ver sección 9) |

## 9. Veredicto

**Sub-fase Firestore de `ridepro-development`: ✅ APROBADA.**

Esta sub-fase específica —creación del proyecto, habilitación de Firestore, despliegue de reglas e índices— está completa, verificada con evidencia en cada paso, y sin ningún efecto secundario fuera de su alcance. **La Fase 1 completa de `16_PLAN_EJECUCION_FASE1_RIDEPRO_DEV.md` permanece abierta** — Storage, Authentication y la verificación final consolidada siguen pendientes; no se declara cerrada para evitar el mismo tipo de sobre-declaración que este protocolo ha evitado consistentemente en tareas anteriores (p. ej. `T-F0.1`, nunca cerrada formalmente mientras faltara la validación en navegador real).

## 10. Próximo módulo recomendado (propuesta, no una decisión unilateral)

Dos caminos razonables, sin que uno sea objetivamente superior sin tu criterio de negocio:

| Opción | Qué implica | Cuándo tiene sentido |
|---|---|---|
| **A — Completar la Fase 1 ya en curso** (Storage + Authentication de `ridepro-development`, siguiendo los Pasos 1.4/1.7 de `16_...md`) | Cierra por completo el entorno Development antes de pasar a otra cosa — coherente con D8 ("Development completo, probado, auditado y aprobado antes de Staging") | Si quieres terminar Development de punta a punta antes de tocar cualquier otro módulo del backlog |
| **B — Pausar la Parte B aquí** (Firestore de Development es suficiente por ahora) y retomar otra tarea del `BACKLOG_MAESTRO.md` (p. ej. `T-F0.3` Docker Compose, o `T-F0.5` paginación, ambas sin dependencias y sin autorización especial requerida) | Deja Storage/Auth de Development para más adelante | Si prefieres avanzar en paralelo en otro frente mientras decides algo sobre Storage/Auth (p. ej. proveedores OAuth) |

**Mi recomendación técnica:** Opción A — dado que ya definiste explícitamente (D8) que Development debe quedar completo antes de Staging, y que Storage/Authentication son los únicos 2 pasos que faltan para eso, tiene sentido terminarlos ahora mientras el contexto y las credenciales de esta sesión siguen frescos, en vez de retomarlo después. Pero la decisión es tuya.

---

**Detenido aquí. A la espera de tu autorización para el siguiente paso.**

---

## 11. Revalidación posterior al PR #19 — 2026-08-02

Revalidación de solo lectura de la infraestructura de `ridepro-development`, ejecutada después de que **PR #19** (`fix/tf02-sync-firestore-storage-config`) se integró a `main` (commit `253f2ce57461c70b6bdadb48b7ed517512c890be`). Este bloque no ejecutó ningún comando de escritura contra la infraestructura ni contra `feature/d2` — reutiliza evidencia ya obtenida en rondas de revalidación previas de la misma sesión de trabajo.

### PR #19 — contenido integrado a `main`

- `firestore.indexes.json` con **cero índices** (`{ "indexes": [], "fieldOverrides": [] }`), consistente con la corrección ya documentada en la sección 4 de este mismo documento.
- `storage.rules` nuevo, **deny-by-default** (`allow read, write: if false` para todos los paths) — mismo principio ya aplicado en `firestore.rules`.
- `firebase.json` actualizado para enlazar `storage.rules` (`"storage": { "rules": "storage.rules" }`).
- **Estas reglas están presentes en el repositorio (`main`) pero no fueron desplegadas contra ningún proyecto Firebase real** en este bloque — su existencia en el árbol de trabajo no equivale a un `firebase deploy` ejecutado.

### Facturación

- `billingEnabled: true` confirmado vía `gcloud billing projects describe ridepro-development`.
- Existe una cuenta de Cloud Billing vinculada y **abierta/activa** (confirmado vía `gcloud billing accounts describe`, sin exponer su identificador).
- Esto **confirma técnicamente el plan Blaze**, porque la documentación oficial de Firebase establece que vincular una cuenta de Cloud Billing actualiza automáticamente el proyecto al plan Blaze (pago por uso) — referencia: `https://firebase.google.com/docs/projects/billing/firebase-pricing-plans`.
- La etiqueta visual del plan en Firebase Console **no fue inspeccionada** en este bloque (sin acceso a navegador en este entorno); la confirmación anterior es técnica/API, no una lectura directa de la interfaz.

### Presupuestos y alertas

- **Estado desconocido / no verificable.** La API `Cloud Billing Budget` está deshabilitada en el proyecto (`SERVICE_DISABLED` al intentar `gcloud billing budgets list`).
- No se afirma que existan cero presupuestos — solo que no pudieron listarse por esta vía sin habilitar la API, y la API **no fue habilitada**.
- Aunque existieran presupuestos y alertas configurados, se aclara explícitamente que **las alertas de presupuesto no constituyen un límite automático de gasto** — son notificaciones, no un corte de facturación.

### Storage

- **Cero buckets físicos** encontrados en el proyecto (`gcloud storage buckets list --project=ridepro-development` → lista vacía).
- No se infiere de este resultado el texto ni el estado visual que mostraría la pantalla de Firebase Console → Storage (no inspeccionada por falta de acceso a navegador).
- No se afirma que el servicio Storage esté deshabilitado — solo que no existe físicamente un bucket verificable por esta vía en este momento.

### Authentication

- Los proveedores de sign-in **no son verificables** mediante la sesión CLI actual: las consultas administrativas a Identity Toolkit (`config`, `defaultSupportedIdpConfigs`) devolvieron `403 Forbidden` con la sesión actual; esta evidencia no permite aislar si la causa fue un rol IAM, alcance OAuth, configuración o estado de la API, u otra restricción. No se modificó IAM en ningún momento de esta revalidación.
- No se afirma que Email/Password, Google, Apple, Teléfono, Anónimo u otro proveedor estén habilitados ni deshabilitados — el estado permanece indeterminado por esta vía.
- Para Apple en particular: incluso si apareciera habilitado en Firebase, eso **no confirma** que la configuración en Apple Developer (Services ID, Key, Team ID, dominios asociados) esté completa — son sistemas independientes.

### App Web

- Existe una app registrada, plataforma **WEB**, nombre visible `RidePro Web (Development)` (confirmado vía `firebase apps:list --project ridepro-development`).
- Esta app constituye una **excepción cronológica autorizada** por el propietario, posterior al plan inicial documentado en este mismo Documento 17 — no es una anomalía ni una decisión pendiente de tomar.
- Queda pendiente, como trabajo futuro, **renombrar únicamente su nombre visible** a `Korixa Web (Development)` — este renombrado **no se ejecutó** en este bloque ni en ninguno de los bloques de revalidación de esta sesión.

### Nota sobre la Sección 5 de este documento

La afirmación original de la Sección 5 ("No apps found" — verificado en 4 ocasiones) fue **evidencia histórica válida al 2026-07-25**, fecha de cierre de esta sub-fase. La app Web descrita arriba apareció en una fecha posterior, fuera del alcance temporal de esa verificación original. Ambas afirmaciones son correctas para su respectivo momento — no hay contradicción, solo una evolución del estado del proyecto entre el 2026-07-25 y el 2026-08-02.

### Veredicto de esta revalidación

- La **sub-fase Firestore** de `ridepro-development` (Secciones 1-9 de este documento) **continúa aprobada** — nada en esta revalidación la contradice o la reabre.
- La **revalidación post-PR #19** queda documentada en esta sección, con evidencia de solo lectura para facturación, Storage, Authentication y apps registradas.
- **La Fase 1 completa y `T-F0.2`/`C1` siguen abiertas de forma parcial.** Los pendientes concretos, sin cambios respecto a la Sección 7, son: Storage (reglas presentes en `main` pero no desplegadas, sin bucket físico), Authentication (proveedores no verificables vía CLI actual), la matriz completa de entornos (Development/Staging/Production) y trabajo aún no integrado a `main` desde `feature/d2`. No se declara cerrada la Fase 1 ni `T-F0.2`/`C1` en su totalidad.

---

**Detenido aquí. Revalidación documental cerrada, sin ninguna acción sobre infraestructura.**
