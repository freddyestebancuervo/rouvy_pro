# Korixa — Documento 23: Matriz Formal de Entornos (T-F0.2 / C1, Bloque 3)

- **Fecha:** 2026-08-03
- **Rol:** Arquitecto de Software Senior / Auditor Técnico
- **Alcance de esta tarea:** exclusivamente documental. **Cero cambios ejecutados** — sin código, sin Firebase/GCP/Cloud Run/Cloud SQL/Hosting/IAM/CORS/facturación/secretos modificados, sin despliegues, sin `.firebaserc`/`firebase.json`/dependencias tocados.
- **SHA base de `main` auditado:** `078dc52df4a36be17d66f844df64427c0d9f6bd7` (confirmado con `git fetch origin` antes de iniciar).
- **Declaración de evidencia:** toda afirmación de "estado actual" en este documento proviene de una auditoría de solo lectura ejecutada el 2026-08-03 (comandos `gcloud`/`firebase` de consulta, lectura de `origin/main` vía `git show`) — nunca de una suposición. Donde no hay evidencia directa, se declara explícitamente "no verificado" en vez de asumirse.
- **Fuente de verdad del estado del proyecto:** `PROJECT_STATUS.md` (raíz del repositorio) — este documento es su referencia detallada para la matriz de entornos, no la duplica ni la reemplaza.

---

## 1. Resumen ejecutivo

`T-F0.2`/`C1` exige, según `docs/audits/AUDITORIA_FINAL/BACKLOG_MAESTRO.md`, "al menos 2 proyectos Firebase reales... y una matriz de entornos documentada con backend/DB/Firebase/CORS/logs por entorno". Ese primer requisito ya está cumplido (`ridepro-development`, `ridepro-dbafe`); este documento entrega el segundo. La auditoría confirma que **Development tiene infraestructura base real y funcional** (Firestore, Storage, Authentication, backend Cloud Run/Cloud SQL ya conectado en código desde el Bloque 2), que **Staging no existe en ningún nivel**, y que **Production carece de Firestore/backend/base de datos propios**, manteniendo únicamente su configuración de cliente Firebase histórica. Se aplicó además el estándar de "10 puertas obligatorias" del Documento 15 §12 — bajo ese criterio más estricto, ningún entorno cumple las 10 puertas simultáneamente, por lo que **`T-F0.2`/`C1` permanece abierta** (ver veredicto, sección 11), aunque el criterio literal más simple de `BACKLOG_MAESTRO.md` esté sustancialmente cubierto.

---

## 2. Matriz formal de entornos

| Dimensión | **Development** | **Staging** | **Production** |
|---|---|---|---|
| **1. Nombre** | `development` | `staging` | `production` |
| **2. Proyecto Firebase/GCP** | `ridepro-development` (existe, confirmado con `gcloud projects list --filter="projectId~ridepro"`) | **No iniciado** — ningún proyecto GCP/Firebase con este nombre existe (mismo comando, sin resultado) | `ridepro-dbafe` (existe) |
| **3. App / entry point** | `lib/main_development.dart` → `bootstrapRideProApp(developmentEnvironment)` (PR #22) | **No iniciado** — no existe `main_staging.dart` ni `environment_staging.dart` | `lib/main.dart` → `bootstrapRideProApp(productionEnvironment)` |
| **4. Firebase options** | `lib/firebase_options_development.dart` (`DefaultFirebaseOptionsDevelopment`) — únicamente plataforma Web | **No iniciado** | `lib/firebase_options.dart` (`DefaultFirebaseOptions`) — Android, iOS, Web, Windows-placeholder |
| **5. Backend y URL** | Cloud Run `ridepro-backend-dev`, `Ready=True` (`gcloud run services list --project ridepro-development`). URL conectada en código desde el Bloque 2 (`environment_development.dart`, PR #23) | **No iniciado** | **No iniciado** — Cloud Run Admin API deshabilitada en el proyecto (`gcloud run services list --project ridepro-dbafe` → `SERVICE_DISABLED`); `productionEnvironment.backendBaseUrl` sigue en el default local, sin URL real |
| **6. Base de datos** | Cloud SQL `ridepro-backend-dev-pg`, `POSTGRES_16`, tier `db-f1-micro`, `RUNNABLE`, `southamerica-east1` (`gcloud sql instances list`) | **No iniciado** | **No iniciado** — Cloud SQL Admin API deshabilitada en el proyecto |
| **7. Firestore** | Creado, `FIRESTORE_NATIVE`, `southamerica-east1` (`gcloud firestore databases list`); `firestore.indexes.json` con 0 índices desplegado | **No iniciado** | **Nunca habilitado** — Firestore API deshabilitada (`SERVICE_DISABLED`); hallazgo ya documentado el 2026-07-25, reconfirmado hoy sin cambios |
| **8. Storage** | Bucket `ridepro-development.firebasestorage.app` existe, `SOUTHAMERICA-EAST1`, clase Standard (`REGIONAL` en la API), 0 objetos; `storage.rules` deny-by-default desplegadas y verificadas con una prueba de lectura anónima real (`403`) | **No iniciado** | **No verificado en este bloque** — fuera de las fuentes de evidencia solicitadas para esta auditoría |
| **9. Authentication** | Email/Password, Google y Apple habilitados (verificación visual reportada por el propietario en Console); Teléfono y Anónimo no figuraban habilitados; MFA por SMS no figuraba habilitado; Apple Developer no confirmado como completo | **No iniciado** | 4 apps cliente registradas (Android, iOS, Web, Windows-placeholder, `firebase apps:list --project ridepro-dbafe`); proveedores exactos de Auth **no re-verificados** en este bloque (fuera de las fuentes solicitadas) |
| **10. Hosting** | **No configurado** — `.firebaserc` sin alias `development`; `firebase.json` sin sección `hosting` (Documento 20, Fase 3, sin ejecutar) | **No iniciado** | Sin evidencia de Firebase Hosting activo (ya documentado en Documento 20) |
| **11. CORS** | `CORS_ALLOWED_ORIGINS` del servicio Cloud Run **ya configurado** para los dominios de Hosting Preview de Development — que todavía no existen (ver contradicción §4.4) | **No iniciado** | No aplica — sin backend desplegado |
| **12. Logs/observabilidad** | Cloud Logging nativo de Cloud Run (por defecto de la plataforma); sin dashboards ni alertas personalizadas documentadas | **No iniciado** | No aplica — sin backend desplegado |
| **13. Política de secretos** | JWT/`DATABASE_URL` provistos como variables de entorno del servicio Cloud Run (nombres de variable confirmados por `gcloud run services describe`, sin exponer valores); mecanismo exacto de almacenamiento (Secret Manager vs. variable de entorno plana) **no verificado** en esta auditoría sin exponer valores | **No iniciado** | No aplica — sin backend desplegado |
| **14. Estado actual** | **Parcial** — Firebase, Firestore, Storage, Authentication y backend implementados y funcionales; Hosting y alias de `.firebaserc` no iniciados | **No iniciado** | **Parcial** — configuración de cliente Firebase implementada (4 apps); Firestore/backend/base de datos propios no iniciados (`T-F1.1`) |
| **15. Evidencia verificable** | `gcloud run services list/describe`, `gcloud sql instances list`, `gcloud firestore databases list`, `gcloud storage buckets list`, `firebase apps:list` — todos ejecutados 2026-08-03, solo lectura | `gcloud projects list --filter="projectId~ridepro"` sin resultado para `staging` | `gcloud run/sql/firestore` → `SERVICE_DISABLED`; `gcloud billing projects describe ridepro-dbafe` → `billingEnabled: false`; `firebase apps:list` → 4 apps |
| **16. Riesgos / decisiones pendientes** | Ver contradicciones §4.2 (Spark vs. `billingEnabled: true`) y §4.4 (CORS adelantado a Hosting inexistente) | Ninguna decisión técnica pendiente — Documento 15, decisión D8, ya determinó posponerlo hasta que Development esté completo | Firestore nunca habilitado, sin decisión del propietario sobre cómo proceder; `T-F1.1` (plataforma de hosting) sigue sin decidirse |

---

## 3. Nota de alcance sobre "Development, Staging y Production siempre presentes"

Por instrucción explícita, los tres entornos aparecen en cada fila de la matriz aunque Staging no tenga ningún dato — se usa consistentemente **"No iniciado"** para Staging en toda la tabla, nunca una celda vacía ni un dato inventado.

---

## 4. Contradicciones documentales encontradas

### 4.1 `PROJECT_STATUS.md` — Bloque 2 declarado "pendiente de fusión" cuando ya está fusionado
La última entrada del historial de `PROJECT_STATUS.md` (previa a este bloque) describe el Bloque 2 como "implementado y validado... pendiente de push, PR y fusión". En realidad, **PR #23 ya fue fusionada** (merge commit `078dc52df4a36be17d66f844df64427c0d9f6bd7`). Se corrige en este mismo bloque (sección 6 de este documento y el commit documental de `PROJECT_STATUS.md`).

### 4.2 Decisión D4 (Documento 15) — "Spark para Development" vs. `billingEnabled: true`
El Documento 15, decisión D4, aprobada por el propietario el 2026-07-25, estableció explícitamente "Spark para Development". La verificación de esta auditoría (`gcloud billing projects describe ridepro-development --format='value(billingEnabled)'`) confirma `billingEnabled: true` — una cuenta de Cloud Billing está vinculada al proyecto. Según la documentación oficial de Firebase, vincular una cuenta de Cloud Billing actualiza automáticamente el proyecto al plan Blaze. **Esta es una desviación real y no resuelta de D4** — ninguna tarea posterior la formalizó ni la revirtió. No se determina en este documento si fue una decisión consciente posterior (p. ej. necesaria para desplegar Cloud Run, que sí requiere Blaze) o un desvío no documentado; se deja registrada para decisión del propietario.

### 4.3 Documento 15 §3.2/§3.3 (flavors nativos) vs. implementación real (entry points Dart)
El diseño original de separación de entornos para Android/iOS (Documento 15, aprobado con D1-D8) especifica *product flavors* de Android y Xcode Configurations de iOS, cada uno con su propio `applicationId`/Bundle ID y archivo de configuración nativo. La implementación real (PR #22/#23, Bloques 1-2) usa exclusivamente **entry points Dart** (`main.dart`/`main_development.dart`, seleccionados por `--target`) — mecanismo diseñado en el Documento 20 específicamente para Web, nunca formalmente extendido ni registrado como reemplazo del diseño de Android/iOS. Esto es consistente con la realidad actual (Development solo tiene una app Web registrada, nunca Android/iOS), pero el cambio de mecanismo respecto al diseño original nunca quedó documentado como una decisión explícita hasta este documento.

### 4.4 CORS del backend configurado para un Hosting que no existe
`CORS_ALLOWED_ORIGINS` del servicio Cloud Run `ridepro-backend-dev` ya incluye los dominios exactos que usaría un canal Preview de Firebase Hosting de Development (Documento 20, D20-4) — pero ese Hosting **no está desplegado**: `.firebaserc` no tiene el alias `development` y `firebase.json` no tiene sección `hosting` (Documento 20, Fase 3, sin ejecutar). El CORS fue configurado en anticipación a un recurso que todavía no existe, sin que exista un documento que registre esa secuencia como decisión deliberada.

### 4.5 Documento 22 desactualizado respecto a Cloud Run/Cloud SQL ya desplegados
El Documento 22 (2026-07-26) presenta sus Fases 3 (Cloud SQL) y 4 (Cloud Run) como "no ejecutadas, requieren autorización explícita". La evidencia de esta auditoría y de la anterior (Bloque 2) confirma que ambos recursos fueron desplegados el 2026-07-27/28 — un día después de escrito el Documento 22 — y quedaron documentados retroactivamente en `docs/audits/AUDITORIA_FINAL/fase_4_1`/`fase_4_2`, pero el propio Documento 22 nunca se actualizó para reflejar que su plan ya se ejecutó. `PROJECT_STATUS.md` ya corrigió esta omisión a nivel de resumen (Bloque 2); el Documento 22 en sí permanece desactualizado.

---

## 5. Matriz de riesgos

| ID | Riesgo | Probabilidad | Impacto | Severidad | Mitigación | Contingencia |
|---|---|---|---|---|---|---|
| MR1 | Desviación de D4 (Spark→Blaze de facto) sin decisión formal del propietario | Alta (ya ocurrió) | Bajo-Medio (costo, no seguridad) | **Medio** | Documentado en §4.2 — requiere decisión explícita: ratificar Blaze o investigar por qué se vinculó Cloud Billing | Si se decide revertir a Spark, requeriría desvincular la cuenta de facturación — acción de infraestructura fuera del alcance de este bloque documental |
| MR2 | CORS apuntando a un Hosting inexistente podría ocultar un error de configuración real si el Hosting se despliega sin revisar el valor ya configurado | Baja | Bajo | **Bajo** | Ya identificado en §4.4; verificar el valor exacto contra los dominios reales del canal Preview cuando se ejecute el Documento 20 Fase 3 | Corregir `CORS_ALLOWED_ORIGINS` si no coincide, redeploy solo de esa variable |
| MR3 | Ningún test automatizado corre contra el proyecto Firebase real de Development (solo contra el emulador) | Media | Medio | **Medio** | Puerta D (§6) — gap ya identificado, sin mitigación implementada todavía | Diseñar un job de CI opcional contra el proyecto real antes de declarar la Puerta D cumplida |
| MR4 | Firestore nunca habilitado en Producción — contradice cualquier caracterización futura de "Firestore activo en Producción" si no se revisa antes de asumirlo | Baja (hallazgo ya conocido y estable) | Alto si se asume sin verificar | **Medio** | Redocumentado en cada auditoría desde 2026-07-25 sin cambio — mantiene la trazabilidad | Verificar de nuevo antes de cualquier tarea que dependa de Firestore de Producción |
| MR5 | Sin entorno Staging, cualquier cambio de infraestructura se valida directamente en Development antes de Producción, sin una etapa intermedia con datos/configuración más realista | Media (mientras Staging no exista) | Medio | **Medio** | Documento 15, D8, ya aceptó este trade-off deliberadamente — no es un riesgo no gestionado, es una decisión ya tomada | Iniciar Staging cuando el propietario lo priorice (Documento 15, Fase 8) |

---

## 6. Revisión formal de las puertas A–J (Documento 15 §12)

Aplicadas a **Development**, el único entorno con infraestructura suficiente para evaluarlas con evidencia real. Staging no es evaluable (no iniciado). Production se marca "fuera del criterio mínimo" en las puertas que dependen de un backend que Producción nunca tuvo intención de tener en esta fase (`T-F1.1` es una tarea separada).

| Puerta | Criterio | Desarrollo — estado | Evidencia |
|---|---|---|---|
| **A. Arquitectura** | El diseño ejecutado coincide exactamente con lo documentado, sin desviación no justificada y no registrada | **Parcial** | El mecanismo de selección de entorno (entry points Dart) difiere del diseño original de Android/iOS del Documento 15 §3.2/3.3 (ver §4.3) — funcionalmente justificado, pero no estaba formalmente registrado como decisión hasta este documento |
| **B. Configuración** | `firebase_options_<flavor>.dart`, `google-services.json`, `GoogleService-Info-<Flavor>.plist` y `.firebaserc` consistentes entre sí (mismo `projectId`) | **Pendiente** | `.firebaserc` no tiene ningún alias nombrado (ni siquiera para Production) — sigue solo con `"default": "demo-ridepro-security-tests"`. No existen `google-services.json`/`GoogleService-Info.plist` de Development porque no hay apps Android/iOS registradas ahí |
| **C. Seguridad** | Ninguna credencial de un entorno alcanzable desde otro; reglas de Firestore/Storage desplegadas y verificadas contra el proyecto correcto | **Cumplida (para Development)** | Verificado en Bloques 1-2: bundles de Web compilados con 0 referencias cruzadas entre `ridepro-dbafe`/`ridepro-development`; `storage.rules` desplegadas y verificadas con prueba `403` real |
| **D. Pruebas** | `flutter analyze`/`flutter test` en verde; suite de `firebase/rules-tests` pasa **contra el proyecto real del entorno, no solo contra el emulador** | **Parcial** | `flutter analyze`/`flutter test` en verde de forma consistente (confirmado en cada bloque); la suite de reglas de Firestore en CI corre **únicamente contra el emulador** — ningún test automatizado corre contra `ridepro-development` real |
| **E. Multiplataforma** | Android y Web (mínimo) verificados con build real del flavor correspondiente; iOS/Windows declarados explícitamente pendientes si aplica | **Pendiente — no cumplida, sin suavizar** | Web: verificado (`flutter build web -t lib/main_development.dart` exitoso, bundle auditado). **Android: no verificado — no existe ninguna app Android registrada en `ridepro-development`, ningún flavor, ningún build.** Esta puerta exige Android como mínimo junto con Web; con Android ausente, la puerta no se cumple |
| **F. Backend** | Arranca correctamente contra el entorno esperado; sin cruce de `DATABASE_URL` | **Cumplida** | Cloud Run `ridepro-backend-dev` con `Ready=True`; validado extensamente con pruebas de concurrencia reales documentadas en `fase_4_1`/`fase_4_2` (corrección de race condition, capacidad de pool, rate limiting) |
| **G. Base de datos** | Migraciones aplicadas limpiamente contra la base del entorno; sin residuos de otra base | **Cumplida** | Cloud SQL `ridepro-backend-dev-pg`, `RUNNABLE`; migraciones y pruebas de concurrencia documentadas en `fase_4_1`/`fase_4_2` contra esta instancia específica |
| **H. CI/CD** | Pipeline del entorno verifica el `projectId` antes de publicar; sin secretos en texto plano | **No iniciada** | El Documento 15, Fase 7 (pipeline de despliegue automático a Development) nunca se ejecutó — no existe ningún workflow de CI que despliegue a `ridepro-development` |
| **I. Documentación** | `PROJECT_STATUS.md` actualizado; informe de cierre en el formato obligatorio | **Cumplida (tras este bloque)** | Este mismo documento + la actualización de `PROJECT_STATUS.md` en el mismo commit |
| **J. Rollback** | Procedimiento de la sección 9 (Documento 15) verificado como ejecutable, al menos revisado | **Parcial** | El procedimiento está documentado (Documento 15 §9) pero nunca fue ensayado contra la infraestructura real de Development en ninguna tarea hasta ahora |

**Resultado:** de las 10 puertas, **3 cumplidas** (C, F, G — más I tras este bloque, 4 cumplidas), **4 parciales** (A, D, I-previo-a-este-bloque, J) y **2 sin cumplir** (B, E, H). Bajo la regla explícita del Documento 15 §12 ("o cumple las 10, o permanece en estado 'en progreso'/'bloqueado'"), Development **no puede declararse "listo"** bajo este estándar.

---

## 7. Checklist de salida (20 puntos, estándar Documento 15 §15)

| # | Ítem | Estado | Evidencia |
|---|---|---|---|
| 1 | Arquitectura aprobada | ✅ Cumplido | D1-D8 aprobadas 2026-07-25; desviación de D4 registrada en §4.2 |
| 2 | Alcance cumplido | ✅ Cumplido | Las 16 dimensiones solicitadas están cubiertas en la matriz (§2) |
| 3 | Archivos modificados revisados | ✅ Cumplido | Exactamente 2 archivos: este documento y `PROJECT_STATUS.md` |
| 4 | `git diff` auditado | ✅ Cumplido | Ver validaciones, sección 12 del informe final |
| 5 | `flutter analyze` en verde | N/A | Sin cambios de código en este bloque |
| 6 | `flutter test` en verde | N/A | Sin cambios de código en este bloque |
| 7 | Pruebas específicas del módulo en verde | N/A | Módulo documental, sin pruebas de código aplicables |
| 8 | Seguridad revisada | ✅ Cumplido | Matriz de riesgos §5; Puerta C evaluada explícitamente |
| 9 | Secretos protegidos | ✅ Cumplido | Ningún valor sensible expuesto en este documento (ver escaneo silencioso en el informe final) |
| 10 | Multiplataforma verificada | ⚠️ Declarado sin suavizar | Puerta E: Android de Development **no cumplida**, declarado explícitamente, no silenciado |
| 11 | Backend verificado | ✅ Cumplido | Puerta F — Cloud Run de Development, evidencia real |
| 12 | Base de datos verificada | ✅ Cumplido | Puerta G — Cloud SQL de Development, evidencia real |
| 13 | Rendimiento revisado | N/A | Fuera del alcance de un bloque documental |
| 14 | Rollback documentado | ⚠️ Parcial | Documentado (Documento 15 §9), nunca ensayado — Puerta J |
| 15 | Documentación actualizada | ✅ Cumplido | Este documento + `PROJECT_STATUS.md` |
| 16 | `PROJECT_STATUS.md` actualizado | ✅ Cumplido | En el mismo commit de este bloque |
| 17 | Riesgos pendientes registrados | ✅ Cumplido | Sección 5 (5 riesgos nuevos identificados en este bloque) |
| 18 | Deuda técnica registrada | ✅ Cumplido | Puertas B, E, H sin cumplir, registradas explícitamente |
| 19 | Validación manual completada o declarada pendiente | ✅ Cumplido | Declarado pendiente donde aplica (Android, Hosting, CI/CD) |
| 20 | Auditoría independiente completada | ⏳ Pendiente | Este documento es autoauditado (sección 8) — una revisión independiente real queda para cuando se autorice |

---

## 8. Autoauditoría de este documento

| Pregunta | Resultado |
|---|---|
| ¿Se inventó algún dato para Staging o Production? | No — toda celda de Staging es "No iniciado"; toda celda de Production sin evidencia directa se marca "no verificado" o "no aplica", nunca asumida |
| ¿Se suavizó la Puerta E (multiplataforma)? | No — se declara explícitamente que Android de Development no está verificado, sin matizarlo como "aceptable" |
| ¿Hay contradicciones entre este documento y `PROJECT_STATUS.md` tras la actualización de este bloque? | No — `PROJECT_STATUS.md` se actualiza en el mismo commit para referenciar este documento y corregir el estado de la PR #23 |
| ¿Se expuso algún secreto, correo, billing account ID, App ID completo, `DATABASE_URL`, JWT o credencial? | No — verificado mediante escaneo silencioso antes del commit (ver informe final) |
| ¿Las 5 contradicciones documentales exigidas están todas cubiertas? | Sí — PR #23 fusionada (§4.1), Spark vs. `billingEnabled` (§4.2), flavors vs. entry points (§4.3), CORS adelantado (§4.4), Documento 22 desactualizado (§4.5) |
| ¿El veredicto se basa en evidencia verificable o en una preferencia? | En evidencia — cada puerta cita el comando o la fuente exacta que la respalda |

---

## 9. Veredicto explícito

**`T-F0.2`/`C1` permanece ABIERTA — no se declara su cierre formal en este bloque.**

**Razón:** bajo el estándar de las 10 puertas obligatorias del Documento 15 §12 (regla explícita: "o cumple las 10, o permanece en estado 'en progreso'/'bloqueado'"), Development —el único entorno con evidencia suficiente para evaluarse— cumple 4 de 10 puertas (C, F, G, I), tiene 3 parciales (A, D, J) y 2 sin cumplir (B, E, H). Ningún entorno cumple las 10.

**Lo que sí queda establecido con este documento:**
- El criterio literal más simple de `BACKLOG_MAESTRO.md` para `C1` ("al menos 2 proyectos Firebase reales, cada uno con su `firebase_options.dart`; matriz de entornos documentada") queda **sustancialmente cubierto** — 2 proyectos reales existen, y esta es la matriz formal exigida.
- Development tiene infraestructura base real, funcional y validada (Firestore, Storage, Authentication, backend, base de datos).

**Lo que falta exactamente para poder reconsiderar el cierre bajo el estándar de las 10 puertas:**
1. Puerta B — alias nombrados en `.firebaserc` (`development`/`production`, y `staging` cuando exista).
2. Puerta E — verificación de Android para Development (registrar la app o declarar formalmente que Development se mantiene Web-only por decisión, no por omisión).
3. Puerta H — al menos un primer paso de CI/CD hacia Development, o una decisión explícita de posponerlo.
4. Resolver la desviación de D4 (§4.2) — ratificar Blaze o investigar la vinculación de facturación.
5. Puerta D — al menos una validación de reglas contra el proyecto real, no solo el emulador (o aceptar formalmente el emulador como suficiente).
6. Puerta J — ensayar el procedimiento de rollback al menos una vez.

**No se declara el cierre de `T-F0.2`/`C1` en este documento.**

---

## 10. Próximo subbloque recomendado

Dado que este Bloque 3 es puramente documental, el subbloque mínimo siguiente natural es **decidir, con el propietario, cuál de los 6 puntos pendientes de la sección 9 se aborda primero** — ninguno requiere trabajo técnico complejo (el más simple es la Puerta B, un cambio aditivo a `.firebaserc`; el de mayor impacto de producto es la Puerta E, que depende de si Development necesita Android pronto o puede permanecer Web-only por decisión explícita del propietario). No se recomienda ejecutar ninguno de estos sin autorización explícita, dado que varios tocan Firebase/GCP.

---

**Detenido aquí. Documento de auditoría/matriz entregado, sin ninguna acción sobre infraestructura.**
