# Korixa — Estado del Proyecto

> **Nombre del producto:** el producto se llama actualmente **Korixa**. El repositorio (`freddyestebancuervo/rouvy_pro`) y varios identificadores técnicos heredados de su nombre anterior, **RidePro**, siguen vigentes y **no han sido renombrados**: nombre de repositorio (`rouvy_pro`), Bundle ID de iOS (`com.ridepro.app`), archivos como `RIDEPRO_DEVELOPMENT_PROTOCOL.md`, y referencias internas en código/configuración/documentación histórica. Este documento usa "Korixa" para referirse al producto y conserva "RidePro"/`rouvy_pro` donde cita un identificador técnico real, sin alterarlo. No se ha ejecutado ni se ha autorizado una migración masiva de nombre — ver `docs/product/PRODUCT_IDEAS_REGISTRY.md` para el ecosistema de nombres de producto (Ride, Studio, Coach, Connect, Receiver, Race, Cloud, Creator) registrado como idea/visión, no como hecho ya implementado.

> Documento vivo. Se actualiza en la Etapa 10 (Cierre) de toda tarea, el mismo día en que se cierra, según `RIDEPRO_DEVELOPMENT_PROTOCOL.md` §6. Nunca se reescribe el historial de cambios — solo se agregan entradas nuevas al final. Fuente de los datos iniciales: `docs/audits/AUDITORIA_FINAL/MASTER_EXECUTION_PLAN.md` y `BACKLOG_MAESTRO.md` — cero hallazgos nuevos generados al crear este documento.

- **Fecha de última actualización:** 2026-07-31
- **Actualizado por:** Ejecutor técnico documental (sincronización de estado post-PR #16/#17)
- **Commit actual de `main` (`origin/main`):** `cb6f65a4d3f51dc5e1037235fa9bf2216fe81391`
- **Rama de referencia:** `main` — `feature/d2` continúa como rama de desarrollo activo protegida (no se toca fuera de su propio flujo de integración por bloques)

---

## 1. Resumen del proyecto / Estado actual

RidePro publicó su primera línea base estable: **v0.5.0** — tag anotado y GitHub Release oficial sobre el commit `2e8cf132f0e8aa7219803c4879b1f90e2c188dd3` de `origin/main`. v0.5.0 integra, mediante 5 bloques funcionales secuenciales y sus respectivos PRs (merge commit tradicional en cada uno, hashes originales preservados), el trabajo ya construido en `feature/d2`:

- **Bloque 1** (PR #1) — Backend NestJS: módulo Workouts.
- **Bloque 2** (PR #2) — Estabilización Flutter/CI (Flutter 3.32.0 / Dart 3.8.0) + cliente de sesión de backend + feature Workouts en Flutter.
- **Bloque 3** (PR #3) — Imagen Docker de producción del backend.
- **Bloque 4** (PR #4) — Puente de autenticación Firebase↔NestJS.
- **Bloque 5** (PR #5) — Corrección de self-deadlock del pool de PostgreSQL + rate limiting híbrido.

Además: PR #6 (`CHANGELOG.md` de v0.5.0) y PR #7 (documentación de gobernanza — protocolo, ADRs, auditoría histórica, diseño de T-F0.1) también mergeados a `main`.

**Esto fue un proceso de integración/release de código ya construido y auditado en `feature/d2`, no la ejecución de nuevas tareas del backlog de 34 unidades (`docs/audits/AUDITORIA_FINAL/BACKLOG_MAESTRO.md`)** — ese backlog sigue vigente como está documentado, salvo los dos puntos siguientes, verificados con evidencia directa de esta integración:

- **`A1` (puente de autenticación Firebase↔NestJS) — CERRADO.** Código en producción real (`main`), probado end-to-end (suite e2e del backend, 86/86 verde en la validación final del Bloque 5).
- **`C2` (backend sin desplegar en ningún entorno real) — PARCIALMENTE CERRADO.** Existe una imagen Docker de producción validada (multi-stage, usuario no-root, `HEALTHCHECK`, sin código fuente TypeScript ni `devDependencies` en el runtime — Bloque 3). El **despliegue real a un hosting en vivo sigue sin ejecutarse** (`T-F1.1`, sin cambios respecto a la decisión D6 de la Parte B de separación de Firebase, `docs/audits/AUDITORIA_FINAL/15_PLAN_PARTE_B_SEPARACION_ENTORNOS_FIREBASE.md`).

Calidad de código consolidada: **B+** (sin nueva auditoría completa desde la oficial v1.1 — sin motivo para esperar cambio, ya que la integración trasladó código ya evaluado a `main`, no reescribió lógica).

### 1.1 Bloques posteriores a v0.5.0 (post-release, PRs #8-#17, todos con merge commit tradicional a `main`)

Tras v0.5.0, se ejecutó una segunda serie de bloques aislados, cada uno partiendo de `origin/main` en su propia rama, siguiendo el mismo patrón de la integración original:

- **PR #8** — `PROJECT_STATUS.md` reescrito reflejando el estado real posterior a v0.5.0 (corrigió afirmaciones obsoletas de la versión anterior del documento).
- **PR #9** — `T-F0.1` (crash de Wearables en Flutter Web) integrada a `main`: guarda de plataforma (`kIsWeb`) en `HealthPlatformGatewayImpl.checkAvailability()`, con test de regresión nuevo.
- **PR #10** — cobertura de tests de widgets para Login/Register/ForgotPassword (Auth) integrada a `main`.
- **PR #11** — scaffold base de Xcode para iOS (regenerado desde cero con Flutter 3.32.0, no copiado del WIP de `feature/d2`).
- **PR #12** — configuración de cliente Firebase iOS integrada (`GoogleService-Info.plist`, `firebase_options.dart`, Bundle ID `com.ridepro.app`, App ID real en `ridepro-dbafe`), excluyendo deliberadamente los cambios de `T-F0.2` que venían mezclados en el WIP original.
- **PR #14** — `IPHONEOS_DEPLOYMENT_TARGET` elevado a iOS 14 (requerido por una dependencia nativa) + workflow estable de validación de compilación iOS sin firma en runner macOS.
- **PR #15** — workflow experimental de smoke test en simulador iOS: compila para simulador, instala, lanza la app y confirma ausencia de crash inmediato (con captura de screenshot como evidencia adicional).
- **PR #17** — corrección: `GoogleService-Info.plist` (añadido en PR #12) no estaba referenciado en `ios/Runner.xcodeproj/project.pbxproj`, por lo que no se empaquetaba dentro de `Runner.app`. Se añadió su `PBXFileReference`/`PBXBuildFile`/entrada en `PBXResourcesBuildPhase` del target `Runner`.
- **PR #16** — extensión del smoke test de simulador con captura y clasificación de logs de inicialización de Firebase en runtime (`FIREBASE_RUNTIME_STATUS`). Actualizado con el fix de PR #17 y **fusionado después de #17** — su propio run de CI confirmó `FIREBASE_RUNTIME_STATUS=initialized` con `GoogleService-Info.plist` ya presente dentro de `Runner.app`.

**Estado de iOS al cierre de este bloque:** la app compila para dispositivo (sin firma) y para simulador, se instala, arranca, renderiza su pantalla de bienvenida sin crash inmediato, y Firebase se inicializa correctamente en runtime en un simulador real de GitHub Actions (conexión de red confirmada a `firebaseinstallations.googleapis.com` y `firebase-settings.crashlytics.com`, señales de arranque de `FirebaseAnalytics`/`FirebaseMessaging` presentes, sin el patrón de error "no se pudo localizar `GoogleService-Info.plist`"). Esto **no constituye** validación de Auth/Firestore/Analytics funcional real, ni de HealthKit, ni de APNs — sigue pendiente.

## 2. Porcentaje de avance

El backlog original de 34 unidades (Fase 0-3) + 6 epics de Fase 4 + 8 transversales **no se recalculó exhaustivamente** en este cierre — la integración de v0.5.0 no ejecutó esas tareas bajo el protocolo de 10 etapas de `RIDEPRO_DEVELOPMENT_PROTOCOL.md`, solo consolidó en `main` código ya evaluado en la auditoría oficial. Único cambio verificado con evidencia directa:

| Ítem | Severidad | Estado anterior | Estado actual |
|---|---|---|---|
| `A1` | Alto | Abierto | **Cerrado** — código en `main`, suite e2e verde |
| `C2` | Crítico | Abierto | **Parcialmente cerrado** — artefacto de despliegue listo (imagen Docker), hosting real pendiente |
| Resto del backlog (32/34 unidades + 6 epics + 8 transversales) | — | Sin cambios | Sin revalidar en este cierre — ver sección 4 |

*(Se evita publicar un nuevo porcentaje global fabricado sin revalidar cada unidad individualmente. Ver "Próximos bloques" para el trabajo que reabrirá esta sección con evidencia nueva.)*

## 3. Estado de infraestructura

### Backend
NestJS + PostgreSQL. Módulos Equipment y Workouts completos y probados. Puente de autenticación Firebase↔NestJS operativo en `main` (Bloque 4). Corrección de self-deadlock del pool de conexiones bajo concurrencia aplicada y validada (Bloque 5). Suite e2e: 86/86 verde en la validación final pre-release. Despliegue real a un entorno de hosting en vivo: **pendiente** (`T-F1.1`).

### Flutter
CI estabilizado en Flutter 3.32.0 / Dart 3.8.0 (Bloque 0/2). Feature Workouts completa (catálogo público + entrenamientos propios del usuario). Cliente de sesión de backend (`backend_auth_service`, `backend_dio_client`) integrado. `flutter analyze` 0 issues; suite de tests verde en cada uno de los 5 bloques.

### Docker
Imagen de producción del backend validada (Bloque 3): build multi-stage, usuario no-root, `HEALTHCHECK` contra `/v1/health`, sin código fuente TypeScript ni `devDependencies` en el runtime.

### Firebase
`ridepro-dbafe` sigue siendo el único proyecto de producción real (Auth, Firestore, Android, Web, Windows-placeholder). La configuración de cliente iOS (Bundle ID `com.ridepro.app`, App ID, `firebase_options.dart`, `GoogleService-Info.plist`) ya está integrada en `main` (PRs #12/#17) y **el plist ya se empaqueta dentro de `Runner.app`**, con inicialización de Firebase confirmada en runtime en simulador (PR #16 — ver sección 1.1). La separación completa de entornos (`T-F0.2`/`C1`: proyectos Firebase separados dev/staging/prod) **sigue sin iniciarse en `main`** — solo existe como WIP parcial en `feature/d2` (prerrequisitos + sub-fase Firestore de `ridepro-development`, decisiones D1-D8 aprobadas por el propietario, sin trasladar a `main` todavía). Hallazgo abierto sin cambios: Cloud Firestore nunca fue habilitado en `ridepro-dbafe` (sin ID de backlog todavía, sin decisión del propietario).

### iOS
Compila para dispositivo (sin firma) y para simulador en runner macOS de GitHub Actions; se instala, arranca y renderiza su pantalla de bienvenida sin crash inmediato; Firebase se inicializa correctamente en runtime (evidencia de PR #16, ver sección 1.1). **No validado:** Auth/Firestore/Analytics funcional real, HealthKit, APNs, Apple Sign-In en dispositivo real, firma de código real.

### Windows
Directorio nativo `windows/` **no existe todavía** en `main` (`T-F2.7` sigue abierta en el backlog — "generar proyecto nativo + validar plugins de riesgo"). Es una plataforma objetivo declarada (ver `README.md` y `docs/product/PRODUCT_IDEAS_REGISTRY.md`), no una plataforma ya construida.

### CI
3 jobs base (`Flutter — analyze + test`, `Firestore — reglas de seguridad`, `Backend — migración + e2e`) verdes en cada PR desde el Bloque 0, más 2 workflows experimentales no obligatorios para iOS (`iOS — build validation`, `iOS — simulator smoke test`), verdes desde su integración (PRs #14/#15/#16). Alcance de OAuth de GitHub Actions ampliado (`workflow` scope) para permitir PRs que modifican `ci.yml`.

### Tests
Evidencia directa verificada en el run de CI del PR #16 (`30670032910`/`30670032915`, 2026-07-31): **Flutter — 205 pruebas aprobadas** ("🎉 205 tests passed."), **Firestore — 28 pruebas aprobadas** (reglas de seguridad contra emulador), **Backend — 86 pruebas aprobadas** ("Tests: 86 passed, 86 total") contra PostgreSQL real, sin `ECONNRESET` ni timeouts de pool.

## 4. Backlog abierto

*(Detalle completo, punto-en-el-tiempo, en `docs/audits/AUDITORIA_FINAL/` — no se duplica aquí para evitar que este documento y esos informes diverjan con el tiempo. `BACKLOG_MAESTRO.md` es una auditoría congelada y no se modifica; este documento solo refleja el estado de ejecución encima de él.)*

### Estado de Fase 0 (`T-F0.1`-`T-F0.5`)

- **`T-F0.1`/`A2`/`PLAT-1` (crash de Wearables en Flutter Web) — implementación integrada a `main` (PR #9), con evidencia automatizada aprobada** (`flutter analyze` 0 issues, test de regresión en verde). El protocolo (`RIDEPRO_DEVELOPMENT_PROTOCOL.md` §1, Etapa 5/Puerta 3) contempla además una validación manual en navegador real — esa comprobación adicional **sigue sin ejecutarse** por la misma limitación de infraestructura ya documentada (sin navegador real disponible en este entorno). Esto no significa que el código no esté integrado: el código y su test automatizado sí están en `main`; lo pendiente es exclusivamente esa verificación manual complementaria.
- **`T-F0.2`/`C1`** — separación completa de entornos Firebase (Development/Staging/Production): **abierta**. No iniciada de forma integrada a `main`; prerrequisitos y sub-fase Firestore de `ridepro-development` avanzados solo como WIP en `feature/d2` (decisiones D1-D8 ya aprobadas por el propietario, sin ejecutar sobre `main`).
- **`T-F0.3`** — `docker-compose.yml` para desarrollo local: **abierta**, sin iniciar.
- **`T-F0.4`** — rate limiter en memoria → Redis: **abierta**, sin iniciar.
- **`T-F0.5`** — paginación real en `equipment`/`workouts`: **abierta**, sin iniciar.

### Resto del backlog

- **`M1`-`M10`, `B1`-`B10`** — sin cambios desde la auditoría oficial v1.1 (`docs/audits/AUDITORIA_FINAL/07_RIESGOS_TECNICOS.md`).
- Deuda técnica de la auditoría original (dependencias de codegen sin uso, tabla `ride_sessions` duplicada, `audit_log` sin escritura real, cobertura de accesibilidad mínima, entre otras) — sin cambios, ver `docs/audits/AUDITORIA_FINAL/BACKLOG_MAESTRO.md`.

**Sin evidencia de despliegue productivo activo** (backend, Firebase separado por entornos, o release pública de Korixa) — el estado actual es de integración/validación técnica en `main`, no de operación en producción.

## Próximos bloques

Con `T-F0.1`, la cobertura de tests de Auth, y la validación de plataforma iOS (scaffold + Firebase + bundling del plist + inicialización en runtime) ya integrados a `main` (PRs #9-#17), el orden priorizado para el trabajo posterior es:

1. **Cierre documental**: sincronizar `PROJECT_STATUS.md`/`README.md` con el estado real post-PR #16/#17 y registrar el ecosistema de ideas de producto (este bloque).
2. **`T-F0.2` — separación de entornos Firebase**: crear al menos 2 proyectos Firebase reales (no-producción/producción), migrar configuración de cliente y backend, formalizar matriz de entornos. Requiere decisión/autorización explícita del propietario antes de ejecutarse (ver `BACKLOG_MAESTRO.md`).
3. **Continuar `T-F0.3`, `T-F0.4` y `T-F0.5`**: `docker-compose.yml` de desarrollo local, migración del rate limiter a Redis, paginación real en `equipment`/`workouts` — paralelizables entre sí, sin dependencias técnicas bloqueantes.

**`main` (`cb6f65a`) es la línea base estable sobre la que se apoyan estos bloques** — cada uno debe partir de `origin/main` en una rama propia, siguiendo el mismo patrón de bloques aislados ya usado en toda la integración hasta ahora.

## 5. Historial de cambios

| Fecha | Evento |
|---|---|
| 2026-07-24 | Auditoría Arquitectónica Oficial v1.0 completada (9 documentos + informe de soporte + resumen ejecutivo + índice). |
| 2026-07-24 | Revisión independiente v1.0 (`REVISION_FINAL_AUDITORIA.md`) — identificó defectos de citación/nomenclatura, ninguno técnico. |
| 2026-07-24 | Corrección documental v1.1 (`REVISION_FINAL_AUDITORIA_v1.1.md`) — 8 archivos corregidos, 0 hallazgos técnicos alterados. Auditoría aprobada como documentación oficial. |
| 2026-07-24 | `MASTER_EXECUTION_PLAN.md` y `BACKLOG_MAESTRO.md` generados — transformación de la auditoría en plan de ejecución (34 tareas, 0 riesgos nuevos). |
| 2026-07-24 | `RIDEPRO_DEVELOPMENT_PROTOCOL.md` emitido (v1.0) — estándar operativo permanente para todo desarrollo futuro. |
| 2026-07-24 | Creación de este documento (`PROJECT_STATUS.md`) — estado inicial ("día cero"), 0/34 tareas ejecutadas. |
| 2026-07-24 | `T-F0.1` implementada (`lib/core/health/health_platform_gateway_impl.dart`, guarda de plataforma Web) + test de regresión nuevo. `flutter analyze` (0 issues), `flutter test` (189/189 verde) y `flutter build web --release` confirmados. Validación manual en navegador real no completada por limitación de infraestructura del entorno — tarea en revisión final, no cerrada formalmente. Hallazgo nuevo `H-WEARABLES-NEW-1` documentado, no corregido. |
| 2026-07-24 | `T-F0.2`/`C1`: inventario completo + plan reversible de separación de Firebase por entornos, modo auditoría/solo lectura. Hallazgo: iOS lanza `UnsupportedError` en `Firebase.initializeApp()`. |
| 2026-07-24 | `T-F0.2`/`C1`, Fase 1 de prerrequisitos ejecutada parcialmente: `.gitignore` fortalecido — ✅ Aprobado. `storage.rules` creado — ✅ Aprobado. Estructura de proyecto Xcode de iOS generada por primera vez — ⚠ Requiere revisión, detenida a propósito antes de fijar Bundle ID. |
| 2026-07-24 | Firebase para iOS completado a nivel estático: Bundle ID `com.ridepro.app` confirmado, app iOS registrada en `ridepro-dbafe`, `firebase_options.dart`/`GoogleService-Info.plist`/`Info.plist` reales. Veredicto: aprobado con observaciones — build/instalación real pendiente en macOS. |
| 2026-07-25 | Fase 1 de Firebase (iOS) declarada oficialmente cerrada. Decisiones D1-D8 de la Parte B (separación de entornos) aprobadas por el propietario. |
| 2026-07-25 | Fase 1 de la Parte B iniciada — sub-fase Firestore de `ridepro-development` completada y aprobada. Hallazgo nuevo: Cloud Firestore nunca fue habilitado en `ridepro-dbafe`, documentado y no corregido. |
| 2026-07-30 | **v0.5.0 publicado.** Integración de `feature/d2` en `main` vía 5 bloques funcionales secuenciales (PRs #1-#5, merge commit tradicional, hashes originales preservados): Workouts backend+Flutter (Bloque 1), estabilización Flutter/CI + cliente de sesión de backend (Bloque 2), imagen Docker de producción (Bloque 3), puente de autenticación Firebase↔NestJS (Bloque 4), corrección de self-deadlock del pool de PostgreSQL (Bloque 5). `CHANGELOG.md` agregado (PR #6). Tag `v0.5.0-rc1` validado exhaustivamente (backend, Flutter, Firestore, Docker, smoke funcional) y promovido a tag estable `v0.5.0` sobre el mismo commit `2e8cf132f0e8aa7219803c4879b1f90e2c188dd3`, sin commits intermedios. GitHub Release oficial publicado. |
| 2026-07-30 | Documentación de gobernanza (protocolo, ADRs, auditoría histórica, diseño de T-F0.1) trasladada desde el WIP de `feature/d2` a `main` (PR #7) como registro histórico punto-en-el-tiempo, con la sanitización de un dato personal menor (correo del propietario reemplazado por una referencia neutral). Este documento (`PROJECT_STATUS.md`) fue excluido deliberadamente de ese PR por requerir esta reescritura propia. |
| 2026-07-30 | Este documento actualizado por primera vez desde su creación — refleja el cierre oficial de v0.5.0, corrige las afirmaciones ya falsas de la versión anterior (0% completado, backend sin desplegar, puente Firebase inexistente) y define el orden priorizado de los 4 próximos bloques de trabajo. |
| 2026-07-30 | `T-F0.1` integrada a `main` (PR #9): guarda de plataforma (`kIsWeb`) en `HealthPlatformGatewayImpl.checkAvailability()`, con test de regresión nuevo. |
| 2026-07-30 | Cobertura de tests de widgets de Auth (Login/Register/ForgotPassword) integrada a `main` (PR #10). |
| 2026-07-30 | Scaffold base de Xcode para iOS integrado a `main` (PR #11), regenerado desde cero con Flutter 3.32.0. |
| 2026-07-30 | Configuración de cliente Firebase iOS integrada a `main` (PR #12): `GoogleService-Info.plist`, `firebase_options.dart`, Bundle ID `com.ridepro.app`, App ID real en `ridepro-dbafe`; excluidos deliberadamente los cambios de `T-F0.2` mezclados en el WIP original. |
| 2026-07-31 | `IPHONEOS_DEPLOYMENT_TARGET` elevado a iOS 14 (PR #14) + workflow estable de validación de compilación iOS sin firma en runner macOS. |
| 2026-07-31 | Workflow experimental de smoke test en simulador iOS integrado a `main` (PR #15): build, boot, instalación, lanzamiento y verificación de ausencia de crash inmediato, con captura de screenshot como evidencia. |
| 2026-07-31 | Corrección: `GoogleService-Info.plist` no estaba referenciado en `ios/Runner.xcodeproj/project.pbxproj` y no se empaquetaba en `Runner.app` (PR #17) — añadidas las 4 entradas mínimas (`PBXFileReference`, `PBXBuildFile`, grupo `Runner`, `PBXResourcesBuildPhase` del target `Runner`). |
| 2026-07-31 | Workflow de smoke test extendido con captura y clasificación de logs de inicialización de Firebase en runtime (PR #16), actualizado con el fix de PR #17 y fusionado después de este. Run de CI propio del PR confirmó `FIREBASE_RUNTIME_STATUS=initialized`. |
| 2026-07-31 | Producto renombrado a **Korixa** a nivel de marca/documentación — sin migración de identificadores técnicos heredados (repositorio, Bundle ID, nombres de archivo). Este documento y `README.md` sincronizados con el estado real de `main` (`cb6f65a`); creado `docs/product/PRODUCT_IDEAS_REGISTRY.md` como registro vivo y permanente de ideas de producto, separado de `BACKLOG_MAESTRO.md` (que permanece congelado, sin modificar). |

---

## Cómo actualizar este documento (recordatorio operativo, no forma parte del estado en sí)

1. Al cerrar cualquier tarea (Etapa 10 del ciclo de vida), agregar una fila nueva a la sección 5 con la fecha y el ID de la tarea.
2. Recalcular la sección 2 (porcentaje de avance) solo con evidencia directa revalidada — no fabricar un porcentaje global sin revisar cada unidad.
3. Mover el ítem correspondiente en la sección 4 (Backlog abierto) si su estado cambió, o actualizar "Próximos bloques" si se cerró un bloque completo.
4. Actualizar la sección 3 (Estado de infraestructura) si cambió Backend, Flutter, Docker, Firebase, CI o Tests.
5. Actualizar la fecha de última actualización y quién actualiza, en el encabezado.
