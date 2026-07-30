# RidePro — Estado del Proyecto

> Documento vivo. Se actualiza en la Etapa 10 (Cierre) de toda tarea, el mismo día en que se cierra, según `RIDEPRO_DEVELOPMENT_PROTOCOL.md` §6. Nunca se reescribe el historial de cambios — solo se agregan entradas nuevas al final. Fuente de los datos iniciales: `docs/audits/AUDITORIA_FINAL/MASTER_EXECUTION_PLAN.md` y `BACKLOG_MAESTRO.md` — cero hallazgos nuevos generados al crear este documento.

- **Fecha de última actualización:** 2026-07-30
- **Actualizado por:** Technical Program Manager / Senior Software Engineer (cierre oficial de v0.5.0)
- **Rama de referencia:** `main` (release v0.5.0) — `feature/d2` continúa como rama de desarrollo activo para el trabajo posterior a v0.5.0 (ver "Próximos bloques")

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
`ridepro-dbafe` sigue siendo el único proyecto de producción real (Auth, Firestore, Android, Web, Windows). La configuración estática de iOS (Bundle ID, App ID, `firebase_options.dart`, `GoogleService-Info.plist`) y la sub-fase Firestore de `ridepro-development` (separación de entornos, decisiones D1-D8 aprobadas) **permanecen como WIP sin commitear en `feature/d2` — no forman parte de v0.5.0**. Hallazgo abierto sin cambios: Cloud Firestore nunca fue habilitado en `ridepro-dbafe` (sin ID de backlog todavía, sin decisión del propietario).

### CI
3 jobs (`Flutter — analyze + test`, `Firestore — reglas de seguridad`, `Backend — migración + e2e`) verdes en cada PR desde el Bloque 0. Alcance de OAuth de GitHub Actions ampliado (`workflow` scope) para permitir PRs que modifican `ci.yml`.

### Tests
Backend: 86/86 e2e verde en la validación final pre-release (sin `ECONNRESET` ni timeouts de pool). Flutter: suite verde en los 5 bloques (166+ tests confirmados desde el Bloque 0, ampliada por Workouts en los Bloques 1-2). Firestore: reglas de seguridad validadas contra emulador en cada PR.

## 4. Backlog abierto

*(Sin cambios respecto a la auditoría oficial salvo lo indicado en la sección 2. Detalle completo, punto-en-el-tiempo, en `docs/audits/AUDITORIA_FINAL/` — no se duplica aquí para evitar que este documento y esos informes diverjan con el tiempo.)*

- **`C1`** — separación completa de entornos Firebase (Development/Staging/Production): no iniciada de forma integrada a `main`, solo como WIP parcial en `feature/d2`.
- **`A2`/`PLAT-1`** — crash de Wearables en Flutter Web: implementado y probado, pendiente de aprobación formal (WIP en `feature/d2`, no integrado a `main`).
- **`M1`-`M10`, `B1`-`B10`** — sin cambios desde la auditoría oficial v1.1 (`docs/audits/AUDITORIA_FINAL/07_RIESGOS_TECNICOS.md`).
- Deuda técnica de la auditoría original (dependencias de codegen sin uso, tabla `ride_sessions` duplicada, `audit_log` sin escritura real, cobertura de accesibilidad mínima, entre otras) — sin cambios, ver `docs/audits/AUDITORIA_FINAL/BACKLOG_MAESTRO.md`.

## Próximos bloques

Con v0.5.0 como línea base estable, el orden priorizado para el trabajo posterior (identificado en la auditoría del WIP de `feature/d2` realizada tras el release) es:

1. **T-F0.1 — Wearables Web**: guarda de plataforma (`kIsWeb`) para el crash de `HealthPlatformGatewayImpl.checkAvailability()` en Flutter Web. Ya implementado y probado en `feature/d2`, pendiente de aprobación formal y traslado a `main`.
2. **Auth test coverage**: cobertura de widgets de Login/Register/ForgotPassword, ya escrita en `feature/d2`, independiente del resto del WIP.
3. **iOS platform validation**: scaffolding de Xcode + registro real de Firebase para iOS, ya presente en `feature/d2`; requiere build/instalación real en macOS (no ejecutable en el entorno Windows actual).
4. **T-F0.2 — Environment separation**: separación de Firebase/backend por entornos (Development/Staging/Production). Prerrequisitos y sub-fase Firestore de `ridepro-development` ya avanzados en `feature/d2`; el resto de la separación no ha comenzado.

**v0.5.0 es la línea base estable sobre la que se apoyan estos 4 bloques** — ninguno de ellos modifica el código ya integrado y liberado; cada uno debe partir de `origin/main` en una rama propia, siguiendo el mismo patrón de bloques aislados ya usado para la integración de v0.5.0.

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

---

## Cómo actualizar este documento (recordatorio operativo, no forma parte del estado en sí)

1. Al cerrar cualquier tarea (Etapa 10 del ciclo de vida), agregar una fila nueva a la sección 5 con la fecha y el ID de la tarea.
2. Recalcular la sección 2 (porcentaje de avance) solo con evidencia directa revalidada — no fabricar un porcentaje global sin revisar cada unidad.
3. Mover el ítem correspondiente en la sección 4 (Backlog abierto) si su estado cambió, o actualizar "Próximos bloques" si se cerró un bloque completo.
4. Actualizar la sección 3 (Estado de infraestructura) si cambió Backend, Flutter, Docker, Firebase, CI o Tests.
5. Actualizar la fecha de última actualización y quién actualiza, en el encabezado.
