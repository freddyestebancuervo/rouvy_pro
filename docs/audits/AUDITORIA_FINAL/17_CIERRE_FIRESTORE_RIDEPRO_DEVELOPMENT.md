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

---

## 12. Estado posterior a la creación manual del bucket y despliegue de Storage Rules — 2026-08-02

### Cronología correcta

La documentación de la Sección 11 (y su reflejo en `PROJECT_STATUS.md`) fue **correcta en el momento en que se fusionó** — no una afirmación errónea ni retirada:

- **PR #20 fusionado:** `2026-08-02T17:50:48Z`. En ese momento, las verificaciones de solo lectura registraban **cero buckets físicos** en `ridepro-development` — evidencia confirmada dos veces de forma independiente antes de esa fusión.
- **Posteriormente**, el propietario creó de forma **manual y autorizada** el bucket desde Firebase Console — una acción explícita fuera de la terminal de Claude Code, no una modificación desconocida ni una anomalía.
- **Creación del bucket:** `2026-08-02T19:01:57Z`, aproximadamente 71 minutos después de la fusión del PR #20.

Ambas afirmaciones (cero buckets al fusionar el PR #20; un bucket existente después) son correctas para su respectivo momento — la misma lógica de trazabilidad cronológica ya aplicada en la Sección 11 para la app Web.

### Estado actual de Storage

- **Bucket:** `ridepro-development.firebasestorage.app`
- **URI:** `gs://ridepro-development.firebasestorage.app`
- **Ubicación:** `SOUTHAMERICA-EAST1`
- **Clase:** mostrada como **Standard** en Firebase Console; `gcloud`/la API de Cloud Storage devuelven `REGIONAL` — una **denominación heredada equivalente a Standard** para almacenamiento ubicado en una única región, no una clase distinta ni una discrepancia (referencia: `https://cloud.google.com/storage/docs/storage-classes#additional-classes`).
- **Objetos:** `0`.
- **Creado inicialmente en modo de producción** (Uniform Bucket-Level Access no forzado por defecto en ese modo, consistente con lo observado).
- **Reglas activas:** `allow read, write: if false;` (deny-by-default, sin excepciones).
- **Compilación local mediante emulador:** exitosa, contra un proyecto ficticio `demo-*`, sin conexión remota.
- **Despliegue controlado ejecutado:** `firebase deploy --only storage --project ridepro-development --non-interactive`.
- **Firebase CLI:** `14.27.0`.
- **Resultado del despliegue:** reglas compiladas y publicadas correctamente contra `ridepro-development`; ningún otro servicio (Firestore, Authentication, Functions, Hosting, índices) fue desplegado ni tocado por ese comando.
- **Prueba anónima real** sobre `prueba-denegada.txt` (sin token, `curl` solo capturando el código HTTP): **`403`** — confirma en producción que el deny-by-default está efectivamente aplicado.
- **No se subieron archivos ni se realizaron escrituras de prueba** en ningún momento de esta verificación.

### Presupuesto y facturación

Verificación visual realizada por el propietario directamente en Google Cloud Console (reportada para este registro — esta sesión de Claude Code no tiene acceso a navegador y no pudo confirmarlo de forma independiente):

- Facturación habilitada y cuenta de Cloud Billing vinculada.
- Existe un presupuesto llamado **"presupuesto mensual korixa"**.
- **Alcance:** proyecto `ridepro-development`, todos los servicios.
- **Importe:** `50.000` en la moneda mostrada por la cuenta de facturación — la moneda exacta no quedó demostrada en esta verificación y no se asume ni se inventa aquí.
- **Alertas configuradas** por gasto real en **50%, 90% y 100%** del presupuesto.
- **Notificaciones** dirigidas a administradores/usuarios de facturación y a los propietarios del proyecto.
- Es un **presupuesto de alertas** — no representa un límite automático de gasto ni detiene la facturación por sí solo.
- No se incluye aquí ID de cuenta de facturación, correos electrónicos ni otros identificadores personales.
- La etiqueta comercial exacta **"Blaze" permanece no confirmada**: la verificación visual reportada no incluyó evidencia explícita de esa palabra en Console: se mantiene la misma postura de la Sección 11 (confirmación técnica por vinculación de Cloud Billing, sin lectura directa de la etiqueta), sin deducirla únicamente de `billingEnabled: true`.

### Authentication

Verificación visual realizada por el propietario en Firebase Console → Authentication → Sign-in method (reportada para este registro, no confirmada de forma independiente por esta sesión):

| Proveedor | Estado reportado |
|---|---|
| Email/Password | Habilitado |
| Google | Habilitado |
| Apple | Habilitado en Firebase |
| Teléfono | No figuraba habilitado |
| Anónimo | No figuraba habilitado |
| MFA por SMS | No figuraba habilitado |

- **"Apple habilitado en Firebase" no demuestra que Apple Developer esté configurado completamente** — son sistemas independientes, misma aclaración ya hecha en la Sección 11.
- **No se modificó IAM** en ningún momento de este subbloque ni de los anteriores.
- **No se modificó ningún proveedor de Authentication** durante este subbloque — es un registro de lo observado, no una acción ejecutada.
- No se incluyen aquí correos, App IDs completos ni otros identificadores personales.

### Veredicto de esta sección

La infraestructura base de `ridepro-development` (Firestore, bucket regional vacío con reglas deny-by-default desplegadas, facturación vinculada con presupuesto de alertas, Authentication configurada visualmente) avanzó sustancialmente desde la Sección 11. **No se declara aquí el cierre total de `T-F0.2`/`C1` ni de la Fase 1** — quedan como salvedades separadas, sin resolver en este subbloque: la configuración integral de Apple Developer (fuera del alcance de Firebase Console), la matriz completa de entornos (Staging/Production), y cualquier otro criterio de cierre formal que no pueda demostrarse todavía con la evidencia disponible. El estado se refleja en `PROJECT_STATUS.md` como "abierta — infraestructura base completada; cierre formal pendiente de revisión de criterios".

---

**Detenido aquí. Registro documental cerrado, sin ninguna acción adicional sobre infraestructura.**
