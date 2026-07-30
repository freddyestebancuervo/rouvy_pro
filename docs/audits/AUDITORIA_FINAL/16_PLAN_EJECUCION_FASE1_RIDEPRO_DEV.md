# RidePro — Documento 16: Plan de Ejecución Detallado — Fase 1 de la Parte B
## Creación controlada del proyecto Firebase `ridepro-dev`

- **Fecha:** 2026-07-25
- **Rol:** Lead Software Engineer / Software Architect / DevOps Engineer / Auditor Técnico Principal
- **Estado de esta tarea:** **Planificación exclusivamente. Cero recursos de Firebase creados.** Este documento es el runbook detallado para cuando se autorice la ejecución real — no ejecuta nada por sí mismo.
- **Relación con la serie:** desarrolla, a nivel de micro-pasos ejecutables, la "Fase 1 — Crear el proyecto Firebase de Development" ya descrita en `15_PLAN_PARTE_B_SEPARACION_ENTORNOS_FIREBASE.md` §7, sin alterar su alcance, sus riesgos ni sus criterios de aprobación (D1, D2, D4 — ya resueltos por el propietario).
- **Regla de secuenciación (impuesta explícitamente para esta tarea):** ningún micro-paso de la sección 5 se ejecuta sin que el anterior tenga su checklist de verificación 100% cumplido y su evidencia registrada. Un micro-paso en rojo detiene toda la fase — no se "sigue adelante y se corrige después".

---

## 1. Resumen Ejecutivo

Esta Fase 1 tiene un único objetivo: que exista un proyecto Firebase real, nuevo, aislado de `ridepro-dbafe`, llamado (si el nombre está disponible) `ridepro-dev`, con Authentication/Firestore/Storage habilitados y con las mismas reglas de seguridad que producción — **sin registrar ninguna app todavía** (Android/iOS/Web se registran en la Fase 2-3 de `15_...md`, fuera de alcance aquí) y **sin tocar ningún archivo del repositorio** (confirmado en `15_...md` §7: "el repositorio se toca recién en la Fase 2").

Este documento existe porque la descripción de una sola fila en `15_...md` §7 ("Fase 1 — Crear el proyecto Firebase de Development") es correcta pero no ejecutable de forma segura sin descomponerla en pasos verificables uno por uno — ese es exactamente el pedido de esta tarea.

---

## 2. Alcance exacto — qué incluye y qué NO incluye esta Fase 1

| Incluido en esta Fase 1 | Explícitamente fuera de alcance (pertenece a fases posteriores de `15_...md`) |
|---|---|
| Crear el proyecto Firebase `ridepro-dev` | Registrar app Android (Fase 2) |
| Confirmar que el plan de facturación es Spark (D4) | Registrar app iOS (Fase 3) |
| Habilitar Authentication (proveedores Email/Password, Google, Apple) | Modificar `.firebaserc` con alias nombrados (Fase 4) |
| Habilitar Firestore y desplegar `firestore.rules`/`firestore.indexes.json` | Cualquier cambio en `backend/` (Fase 5) |
| Habilitar Storage y desplegar `storage.rules` | Cualquier cambio en PostgreSQL (Fase 6) |
| Verificación final de que el proyecto está aislado y correctamente configurado | Cualquier cambio en CI/CD (Fase 7) |

**Ningún archivo del repositorio se modifica durante la ejecución real de esta Fase 1** — es 100% infraestructura externa (Firebase Console/CLI). El único artefacto de esta tarea de planificación es este documento.

---

## 3. Checklist de Entrada de la Fase 1 (verificar ANTES de ejecutar el micro-paso 1.1)

| # | Precondición | Estado |
|---|---|---|
| 1 | D1 resuelta (`ridepro-dbafe` = Producción, no se toca en esta fase) | ✅ Cumplido — `PROJECT_STATUS.md` §8, 2026-07-25 |
| 2 | D2 resuelta (3 entornos autorizados) | ✅ Cumplido |
| 3 | D4 resuelta (Development en plan Spark) | ✅ Cumplido |
| 4 | Acceso a la cuenta de Firebase/Google Cloud con permisos para crear proyectos nuevos | ⏳ A verificar en el momento de ejecutar (mismo acceso ya usado exitosamente para `ridepro-dbafe` en la Fase 1 de Firebase iOS) |
| 5 | Firebase CLI autenticado en esta máquina (`firebase login:list`) | ⏳ A verificar en el momento de ejecutar |
| 6 | Cero proyectos llamados `ridepro-dev` ya existentes en la cuenta (evitar duplicar por error) | ⏳ A verificar con `firebase projects:list` como primer comando real, antes de crear nada |
| 7 | Autorización explícita del propietario para iniciar la ejecución real de esta Fase 1 | ⛔ **Pendiente — no se ejecuta ningún comando de creación sin esta autorización, distinta de la autorización de D1-D8** |

**Regla:** los ítems 4-6 se verifican con comandos de **solo lectura** (`firebase login:list`, `firebase projects:list`) antes de ejecutar el primer comando que crea algo — esos dos comandos de lectura pueden ejecutarse en cuanto se autorice el inicio de la fase, sin que eso equivalga todavía a "crear un recurso".

---

## 4. Advertencias detectadas en esta planificación granular (nuevas, no cubiertas por D1-D8)

Al descomponer la Fase 1 en pasos ejecutables aparecieron 2 puntos que `15_...md` no necesitaba resolver a su nivel de detalle, pero que sí bloquean la ejecución real si no se deciden antes:

### 4.1 — Disponibilidad del Project ID `ridepro-dev` (no verificable sin intentar crearlo)

Los Project ID de Firebase son **únicos a nivel global** (no solo dentro de la cuenta del propietario) y no existe un comando de "solo verificar disponibilidad" independiente de intentar la creación — `firebase projects:create ridepro-dev` es, a la vez, el primer intento y la única forma real de saber si el nombre está libre. Si `ridepro-dev` estuviera tomado por otra cuenta en el mundo (poco probable pero no descartable), el comando fallaría sin haber creado nada (fallo limpio, sin efecto secundario).

**Plan de contingencia (no una decisión unilateral):** si `ridepro-dev` no está disponible, la propuesta de respaldo es `ridepro-development` (mismo patrón de nombre, sin abreviar) — **esto se te consulta explícitamente antes de usarlo**, no se aplica automáticamente ni siquiera como fallback silencioso, según el micro-paso 5.1.

### 4.2 — Región de Firestore (decisión irreversible, no capturada en D1-D8)

La ubicación de Firestore (`us-central1`, `southamerica-east1`, etc.) se fija **una sola vez por proyecto y no puede cambiarse después** sin recrear el proyecto completo. `15_...md` no registra la región de `ridepro-dbafe` porque no era relevante a su nivel de diseño. **No se puede determinar la región de producción desde este entorno de solo-código** (requiere consultar Firebase Console o `gcloud firestore databases describe --project ridepro-dbafe`, acción de solo lectura contra el proyecto real).

**Esto se resuelve como parte del micro-paso 5.4, no antes** — se consulta la región real de `ridepro-dbafe` (lectura, sin modificar nada) y se usa la misma para `ridepro-dev`, salvo que tengas una razón para preferir otra (p. ej. menor latencia para el equipo de desarrollo). Si no se puede determinar automáticamente, se te pregunta antes de continuar — no se asume ninguna región por defecto.

---

## 5. Plan Paso a Paso — Micro-pasos Ejecutables

Cada micro-paso solo se ejecuta si el anterior está en estado ✅ con evidencia registrada. Formato fijo por paso: Objetivo · Comando/acción exacta · Checklist de entrada del paso · Punto de verificación · Evidencia obligatoria · Rollback · Regla de bloqueo.

### Paso 1.1 — Verificación de acceso (solo lectura)

- **Objetivo:** confirmar sesión de Firebase CLI activa y visibilidad de proyectos existentes, sin crear nada.
- **Comando exacto:** `firebase login:list` seguido de `firebase projects:list`.
- **Checklist de entrada:** ítems 4-5 de la sección 3.
- **Punto de verificación:** la cuenta autenticada coincide con la ya usada para `ridepro-dbafe`; `ridepro-dbafe` aparece en el listado; ningún proyecto llamado `ridepro-dev`/`ridepro-development` aparece todavía.
- **Evidencia obligatoria:** salida completa (texto) de ambos comandos, pegada en el informe de cierre.
- **Rollback:** no aplica — comando de solo lectura, sin efecto.
- **Regla de bloqueo:** si la cuenta autenticada no es la esperada, o si ya existe un proyecto `ridepro-dev` no reconocido, **detener y reportar antes de continuar** (posible ejecución previa no documentada, o cuenta incorrecta).

### Paso 1.2 — Crear el proyecto Firebase

- **Objetivo:** que exista `ridepro-dev` (o el nombre de respaldo acordado) como proyecto Firebase real.
- **Comando exacto:** `firebase projects:create ridepro-dev --display-name "RidePro Development"`.
- **Checklist de entrada:** Paso 1.1 en ✅.
- **Punto de verificación:** el comando devuelve éxito con el Project ID exacto esperado (sin sufijo numérico añadido automáticamente por Firebase, o documentando ese sufijo si Firebase lo agrega); `firebase projects:list` ahora lo incluye.
- **Evidencia obligatoria:** salida completa del comando de creación + salida de `firebase projects:list` posterior mostrando la fila nueva.
- **Rollback:** eliminar el proyecto desde Firebase Console (Configuración del proyecto → Eliminar proyecto) — acción reversible dentro de la ventana de gracia de Google Cloud (~30 días en "pending deletion"), sin ningún impacto en `ridepro-dbafe` (proyectos completamente aislados).
- **Regla de bloqueo:** si el nombre no está disponible, **no se reintenta automáticamente con el nombre de respaldo** — se reporta el fallo exacto y se pide confirmación antes de intentar `ridepro-development` (sección 4.1).

### Paso 1.3 — Confirmar plan de facturación = Spark

- **Objetivo:** verificar que el proyecto nuevo quedó en el plan gratuito, consistente con D4.
- **Comando/acción:** `firebase projects:list` no muestra el plan directamente — se verifica en Firebase Console → Configuración del proyecto → Uso y facturación, o con `gcloud billing projects describe ridepro-dev` (de solo lectura) si hay acceso a `gcloud` configurado.
- **Checklist de entrada:** Paso 1.2 en ✅.
- **Punto de verificación:** ninguna cuenta de facturación vinculada (plan Spark = sin cuenta de facturación asociada, por diseño de Firebase).
- **Evidencia obligatoria:** captura de pantalla o salida de comando confirmando "Sin cuenta de facturación" / plan Spark.
- **Rollback:** no aplica en este paso (no se modifica nada) — si por error quedara en Blaze, se documentaría como hallazgo y se downgradearía explícitamente antes de continuar, nunca se sigue adelante con un plan no autorizado.
- **Regla de bloqueo:** si aparece vinculado a Blaze sin autorización, **detener la fase completa** hasta resolverlo — es una desviación de D4.

### Paso 1.4 — Habilitar Authentication y proveedores

- **Objetivo:** Authentication activo, con los mismos proveedores que producción (Email/Password, Google, Apple).
- **Acción:** Firebase Console → Authentication → Sign-in method → habilitar cada proveedor. **Advertencia ya señalada:** Google/Apple Sign-In pueden requerir configuración adicional fuera de Firebase (pantalla de consentimiento OAuth en Google Cloud Console, Services ID en Apple Developer Portal) — si esa configuración adicional no está disponible en este entorno, se habilita igualmente el proveedor en Firebase (el proyecto queda correctamente configurado) y se documenta la configuración externa pendiente como una limitación conocida, igual que se hizo con la validación real de iOS en macOS.
- **Checklist de entrada:** Paso 1.2 en ✅.
- **Punto de verificación:** los 3 proveedores aparecen "Habilitado" en la consola.
- **Evidencia obligatoria:** captura de pantalla de la lista de proveedores habilitados.
- **Rollback:** deshabilitar el proveedor desde la misma pantalla — reversible sin efecto en producción.
- **Regla de bloqueo:** ninguna — este paso no tiene forma de fallar de modo que bloquee los siguientes, salvo que Authentication en sí no se pueda habilitar (caso no esperado).

### Paso 1.5 — Determinar la región de Firestore y habilitar Firestore

- **Objetivo:** Firestore activo en la región correcta (ver advertencia 4.2), en modo nativo.
- **Acción previa (solo lectura, contra producción):** verificar la región real de `ridepro-dbafe` vía Firebase Console (Configuración del proyecto → General, o Firestore → Datos) — **sin modificar nada de producción**.
- **Comando/acción de creación:** Firebase Console → Firestore Database → Crear base de datos → seleccionar la región confirmada en el paso anterior → modo producción (reglas propias, no las de prueba por defecto).
- **Checklist de entrada:** Paso 1.2 en ✅; región de producción confirmada (o decisión explícita tuya si no se pudo determinar).
- **Punto de verificación:** Firestore aparece activo, región correcta, en modo "producción" (no "modo de prueba" con reglas abiertas por defecto — evitar quedar expuesto aunque sea temporalmente).
- **Evidencia obligatoria:** captura de pantalla de Firestore activo con la región visible.
- **Rollback:** la región no se puede cambiar sin eliminar el proyecto completo (ver 4.2) — el rollback de este paso específico es el rollback del proyecto completo (Paso 1.2).
- **Regla de bloqueo:** **no proceder sin confirmar la región** — es la única decisión irreversible de toda la Fase 1, se trata con el mismo cuidado que una decisión D1-D8.

### Paso 1.6 — Desplegar `firestore.rules` y `firestore.indexes.json`

- **Objetivo:** mismas reglas de seguridad que producción, en `ridepro-dev`.
- **Comando exacto:** `firebase deploy --only firestore:rules,firestore:indexes --project ridepro-dev` (usando el Project ID directo, ya que los alias nombrados de `.firebaserc` se agregan recién en la Fase 4 de `15_...md` — sin depender de ellos aquí).
- **Checklist de entrada:** Paso 1.5 en ✅.
- **Punto de verificación:** el comando confirma el despliegue exitoso; `firebase firestore:rules:get --project ridepro-dev` (o la consola) muestra el mismo contenido que el `firestore.rules` del repositorio — diff textual, no solo "se desplegó algo".
- **Evidencia obligatoria:** salida del comando de deploy + resultado de la comparación textual reglas-desplegadas vs. `firestore.rules` del repo (deben ser idénticas, byte a byte).
- **Rollback:** redeploy de una versión anterior de las reglas (Firestore mantiene historial de versiones en la consola) — sin pérdida de datos, ya que no hay datos todavía en un proyecto recién creado.
- **Regla de bloqueo:** si el diff no es idéntico al archivo fuente, **no continuar** — investigar la causa (¿se usó el proyecto equivocado? ¿el archivo local está desactualizado?) antes de seguir.

### Paso 1.7 — Habilitar Storage y desplegar `storage.rules`

- **Objetivo:** mismo patrón que el paso anterior, aplicado a Storage.
- **Comando exacto:** habilitar Storage desde la consola (primer uso requiere confirmar región, debería heredar/coincidir con la de Firestore) → `firebase deploy --only storage --project ridepro-dev`.
- **Checklist de entrada:** Paso 1.6 en ✅.
- **Punto de verificación:** reglas desplegadas idénticas a `storage.rules` (mismo patrón deny-by-default ya verificado en la Fase 1 de Firebase original).
- **Evidencia obligatoria:** salida del comando + confirmación de reglas deny-all activas (intento de lectura anónima real contra el bucket debe fallar — prueba positiva de que deny-by-default funciona, no solo que "algo se desplegó").
- **Rollback:** redeploy de reglas anteriores, mismo mecanismo que Firestore.
- **Regla de bloqueo:** si el bucket no queda deny-by-default por defecto, **no continuar** — es el mismo riesgo ya mitigado preventivamente en la Fase 1 de Firebase original, no se repite el hallazgo 2 de `11_PLAN_SEPARACION_FIREBASE.md`.

### Paso 1.8 — Verificación final consolidada de la Fase 1

- **Objetivo:** confirmar el estado completo antes de declarar la fase cerrada.
- **Checklist de entrada:** Pasos 1.1-1.7 todos en ✅.
- **Punto de verificación:** ver Checklist de Salida (sección 6) completo, sin ítems pendientes.
- **Evidencia obligatoria:** el informe de cierre consolidado (plantilla en sección 7).
- **Rollback:** rollback completo = eliminar el proyecto `ridepro-dev` (Paso 1.2), sin ningún residuo en el repositorio porque ningún archivo fue tocado.
- **Regla de bloqueo:** no se solicita autorización para la Fase 2 de `15_...md` hasta que este paso esté 100% ✅.

---

## 6. Checklist de Salida de la Fase 1 (se completa al ejecutar, con evidencia — no solo casillas)

| # | Ítem | Estado (a completar en la ejecución) | Evidencia requerida |
|---|---|---|---|
| 1 | Proyecto `ridepro-dev` (o nombre de respaldo acordado) existe | ⏳ | Salida de `firebase projects:list` |
| 2 | Plan de facturación = Spark | ⏳ | Captura de Console / `gcloud billing` |
| 3 | Authentication habilitado, 3 proveedores activos | ⏳ | Captura de Console |
| 4 | Firestore activo, región confirmada e igual (o justificadamente distinta) a producción | ⏳ | Captura + comando de confirmación de región |
| 5 | `firestore.rules`/`firestore.indexes.json` desplegadas, idénticas al repo | ⏳ | Diff textual reglas desplegadas vs. archivo fuente |
| 6 | Storage habilitado, `storage.rules` desplegadas, deny-by-default verificado con una prueba real | ⏳ | Salida del intento de lectura anónima fallido |
| 7 | Cero apps registradas (Android/iOS/Web) — confirmando el límite de alcance de esta fase | ⏳ | Captura de Console → "Tus apps" vacío |
| 8 | Cero archivos del repositorio modificados | ⏳ | `git status --short` idéntico al de antes de iniciar la fase |
| 9 | Rollback ensayado mentalmente (no ejecutado) — el equipo confirma que sabe cómo revertir cada paso | ⏳ | Referencia a la sección 5 de este documento |
| 10 | Informe de cierre generado con el formato de la sección 7 | ⏳ | El informe mismo |

**Ningún ítem puede quedar "Cumplido" sin su evidencia adjunta** — mismo estándar ya vigente desde el Documento 15.

---

## 7. Plantilla del Informe Ejecutivo de Cierre (para usar en la ejecución real)

Cuando la Fase 1 se ejecute, el informe de cierre reutiliza esta estructura (no se redacta ahora porque no hay nada que reportar todavía):

```markdown
## Informe de Cierre — Fase 1 de la Parte B (ridepro-dev)

### Resumen ejecutivo
[1-2 frases: qué se creó, resultado]

### Evidencia por micro-paso (1.1 a 1.8)
[Tabla con el resultado real de cada punto de verificación de la sección 5]

### Checklist de salida (sección 6) — completo con evidencia
[Tabla de la sección 6, todos los ítems resueltos]

### Desviaciones respecto al plan
[Cualquier punto donde la ejecución real difirió de este documento, y por qué]

### git diff / git status
[Confirmación de que el repositorio no cambió]

### Auditoría independiente
[Autoauditoría de la ejecución, mismo formato que Documento 15 §13]

### Veredicto
[✅ Aprobado / ⚠️ Aprobado con observaciones / ❌ Rechazado]

### Próximo paso
[Solicitud de autorización para la Fase 2 de 15_...md — solo si el veredicto es ✅ o ⚠️ sin bloqueos]
```

---

## 8. Autoauditoría de este documento (planificación, no ejecución)

| Pregunta | Resultado |
|---|---|
| ¿Cada micro-paso tiene objetivo, comando, checklist de entrada, verificación, evidencia, rollback y regla de bloqueo? | ✅ Verificado — los 8 micro-pasos (1.1-1.8) cumplen la estructura completa, sin ninguno abreviado |
| ¿Se introdujo alguna decisión nueva sin flagear como pendiente? | Se detectaron 2 (disponibilidad del Project ID, región de Firestore) — **ambas documentadas explícitamente en la sección 4, ninguna resuelta unilateralmente** |
| ¿Hay contradicción con `15_...md`? | No — el alcance (sección 2) es un subconjunto exacto de la Fase 1 ya descrita ahí, sin agregar ni quitar nada de su criterio de aprobación (D1/D2/D4) |
| ¿Algún paso requiere tocar `ridepro-dbafe`? | Solo lectura, una vez (confirmar región de Firestore en el Paso 1.5) — sin ninguna escritura, consistente con el principio de "Producción nunca se toca de forma no aditiva sin aprobación explícita" |
| ¿El plan permite ejecutar sin supervisión punto por punto? | No por diseño — la regla de secuenciación (encabezado del documento) obliga a validar cada paso antes del siguiente |

---

## 9. Estado y Próximo Paso

**Estado de este documento:** ✅ Plan completo, listo para ejecutarse en cuanto se autorice.
**Estado de la Fase 1 (ejecución real):** ⛔ **No iniciada.** Cero comandos de Firebase ejecutados, cero recursos creados.
**Qué falta para empezar a ejecutar:** tu autorización explícita para iniciar el Paso 1.1 (que es de solo lectura) — la creación real del proyecto (Paso 1.2) queda además sujeta a que el Paso 1.1 confirme que todo está en orden.

**No se solicita autorización para la Fase 2 en este documento** — eso solo corresponde una vez que la Fase 1 se ejecute realmente y su Checklist de Salida (sección 6) esté 100% cumplido con evidencia, tal como pediste explícitamente ("antes de solicitar autorización para la Fase 2").
