# RidePro — Backlog Maestro de Ejecución
## BACKLOG_MAESTRO.md

- **Fecha:** 2026-07-24
- **Fuente:** cada tarea de este backlog es la conversión directa de un riesgo (Documento 7), una acción de roadmap (Documento 8), una recomendación (Documento 9) o un hallazgo específico (Documentos 1-6, `HALLAZGOS_CODIGO_Y_ARQUITECTURA.md`) ya existente en la Auditoría Arquitectónica Oficial v1.1. **No se agregó, quitó ni reclasificó ningún riesgo.**
- **Deduplicación aplicada:** cuando un riesgo de Documento 7 y una acción de Documento 8 describen la misma corrección (p. ej. `M6` y `F0.4`), se fusionaron en una sola tarea con ambos IDs, en vez de listarse dos veces.
- **Formato por tarea:** ID(s) de origen · Título · Fuente · Depende de · Costo · ¿Requiere autorización del propietario? · Criterio de aceptación.

---

## Leyenda de IDs de origen

| Prefijo | Documento de origen | Significado |
|---|---|---|
| `C`, `A`, `M`, `B` | Documento 7 | Crítico / Alto / Medio / Bajo (alcance local a Documento 7) |
| `F` | Documento 8 | Acción de roadmap por fase |
| `H` | Documento 2 / `HALLAZGOS...` | Hallazgo de calidad de código |
| `S` | Documento 3 | Hallazgo de seguridad |
| `R` | Documento 4 | Hallazgo de rendimiento |
| `PLAT` | Documento 6 | Hallazgo de multiplataforma |

---

## FASE 0 — Desbloqueo (sin dependencias entre sí, paralelizable de inmediato)

### T-F0.1 — Corregir crash de Web en Wearables
- **IDs de origen:** `A2`, `F0.1`, `PLAT-1`
- **Fuente:** Documento 6 §3, Documento 7 (Altos), Documento 8 (Fase 0)
- **Descripción:** `HealthPlatformGatewayImpl` usa `dart:io`/`Platform.isX` sin guard; crashea al abrir Wearables en Flutter Web. Implementar stub condicional (`kIsWeb`) igual al patrón ya usado en `core/platform/web_bluetooth_support*.dart` y en la línea 92 de `injection.dart`.
- **Depende de:** — (ninguna)
- **Costo:** S
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** Abrir la pantalla de Wearables en `flutter build web` no lanza excepción; existe un stub que responde "no disponible en esta plataforma"; registro condicional en `injection.dart` con el mismo patrón que `google_sign_in`.

### T-F0.2 — Decisión y ejecución: proyectos Firebase separados por entorno
- **IDs de origen:** `C1`, `F0.2`, `M10` (matriz de entornos, condicionada por esta tarea)
- **Fuente:** Documento 1 §6/§8, Documento 3 §10, Documento 7 (Críticos)
- **Descripción:** Un único proyecto Firebase (`ridepro-dbafe`) sirve como "desarrollo" y "producción" a la vez. Crear al menos 2 proyectos Firebase separados (no-producción / producción), migrar configuración del cliente (`firebase_options.dart` ya soporta múltiples flavors) y del backend. Formalizar como consecuencia una matriz de entornos (dev/QA/staging/prod) documentada.
- **Depende de:** — ninguna técnica; **depende de decisión del propietario** para iniciar la ejecución
- **Costo:** M (decisión) + M (ejecución)
- **¿Requiere autorización del propietario?:** **Sí**
- **Criterio de aceptación:** Al menos 2 proyectos Firebase reales existen, cada uno con su propio `firebase_options.dart`/flavor; matriz de entornos documentada con backend/DB/Firebase/CORS/logs por entorno.

### T-F0.3 — `docker-compose.yml` para desarrollo local
- **IDs de origen:** `B1`, `F0.3`
- **Fuente:** Documento 1 §6/§8, Documento 8 (Fase 0)
- **Descripción:** No existe forma reproducible de levantar backend + Postgres + emulador de Firebase con un solo comando.
- **Depende de:** — (ninguna)
- **Costo:** S-M
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** `docker compose up` deja el backend respondiendo sin pasos manuales adicionales.

### T-F0.4 — Rate limiter en memoria → Redis
- **IDs de origen:** `M6`, `F0.4`, `S3`
- **Fuente:** Documento 3 §6, Documento 5 §3, Documento 7 (Medios), Documento 8 (Fase 0)
- **Descripción:** `ThrottlerStorage` en memoria diluye el límite efectivo con más de una instancia del backend. Migrar a Redis como backend de `ThrottlerStorage` (cambio ya anticipado en el propio código).
- **Depende de:** T-F0.3 (conveniente tenerlo primero, no estrictamente bloqueante)
- **Costo:** M
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** Rate limiting correcto y consistente verificado con más de una instancia del backend corriendo en paralelo.

### T-F0.5 — Paginación real en `equipment`/`workouts`
- **IDs de origen:** `M7`, `F0.5`
- **Fuente:** Documento 5 §2, Documento 7 (Medios), Documento 8 (Fase 0)
- **Descripción:** `EquipmentQueryDto`/`WorkoutQueryDto` no tienen `limit`/`offset`/`page`; los endpoints devuelven todas las filas sin límite. Agregar paginación por cursor con límite máximo del lado servidor (p. ej. 50).
- **Depende de:** — (ninguna)
- **Costo:** S
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** `GET /equipment` y `GET /workouts` nunca devuelven más del límite configurado, con test que lo pruebe; no rompe clientes actuales.

---

## FASE 1 — Backend real en producción

### T-F1.1 — Elegir plataforma de hosting del backend
- **IDs de origen:** `F1.1`, parte de `C2`
- **Fuente:** Documento 7 (Críticos), Documento 8 (Fase 1)
- **Descripción:** Decisión de negocio: Cloud Run, Render, VPS u otra plataforma.
- **Depende de:** T-F0.2 (decisión sobre entornos, para no elegir hosting antes de saber cuántos entornos habrá)
- **Costo:** Decisión (sin costo técnico de por sí)
- **¿Requiere autorización del propietario?:** **Sí**
- **Criterio de aceptación:** Plataforma de hosting seleccionada y documentada.

### T-F1.2 — Pipeline de CD
- **IDs de origen:** `F1.2`, parte de `C2`
- **Fuente:** Documento 8 (Fase 1)
- **Depende de:** T-F1.1, T-F0.3
- **Costo:** M
- **¿Requiere autorización del propietario?:** No (una vez decidido el hosting en T-F1.1)
- **Criterio de aceptación:** Un push a `main` despliega automáticamente al entorno correspondiente sin pasos manuales.

### T-F1.3 — Entorno de staging real
- **IDs de origen:** `F1.3`, parte de `C2`
- **Fuente:** Documento 5 §1, Documento 8 (Fase 1)
- **Depende de:** T-F1.1
- **Costo:** M
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** Backend + Postgres + Firebase de staging accesibles y funcionales, separados de producción.

### T-F1.4 — Extender CI: lint/tsc backend, escaneo de secretos, formato
- **IDs de origen:** `B6`, `F1.4`, `S6`, `S7`
- **Fuente:** Documento 3 §9, Documento 7 (Bajos), Documento 8 (Fase 1)
- **Descripción:** Agregar a `ci.yml`: `npm run lint`/`tsc --noEmit` como pasos explícitos, un paso de escaneo de secretos (`gitleaks`/`git-secrets`/`trufflehog`), y un bloque `permissions:` explícito acotado a `contents: read`.
- **Depende de:** — (ninguna)
- **Costo:** S
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** 3 jobs nuevos en verde en `ci.yml`; ningún secreto detectado en el historial actual.

### T-F1.5 — Puente de autenticación Firebase↔NestJS
- **IDs de origen:** `A1`, `F1.5`, `H1`
- **Fuente:** Documento 1 §4.3/§8, Documento 2 §1.6, `HALLAZGOS...` H1, Documento 7 (Altos), Documento 8 (Fase 1)
- **Descripción:** Implementar endpoint de intercambio Firebase ID token → JWT propio, verificado con Firebase Admin SDK del lado del backend (ya definido en ADR-0003).
- **Depende de:** T-F1.3 (probar contra staging real antes de exponer)
- **Costo:** L
- **¿Requiere autorización del propietario?:** No para diseñar (ya diseñado en ADR-0003); **sí** para priorizar cuándo se ejecuta frente a otras features
- **Criterio de aceptación:** Un usuario autenticado con Firebase (no la cuenta QA) puede usar Workouts/Equipment de punta a punta, con al menos un test e2e que lo pruebe.

---

## FASE 2 — Cierre de deuda de calidad

### T-F2.1 — Idempotencia en endpoints de escritura NestJS
- **IDs de origen:** `M2`, `F2.1`, `H3`
- **Fuente:** Documento 2, Documento 3 §11, Documento 5 §7, Documento 7 (Medios), Documento 8 (Fase 2)
- **Descripción:** Agregar `clientRequestId` (UUID del cliente) a los DTOs de creación de `workouts`/`equipment`; el repositorio verifica antes de insertar si ya existe una fila con ese ID.
- **Depende de:** — (ninguna)
- **Costo:** S-M
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** Un POST repetido con el mismo `clientRequestId` no crea un recurso duplicado, con test e2e que lo pruebe.

### T-F2.2 — Tests de contrato Flutter↔NestJS
- **IDs de origen:** `M3`, `F2.2`, `H4`
- **Fuente:** Documento 2, Documento 1 §9, Documento 7 (Medios), Documento 8 (Fase 2)
- **Depende de:** T-F1.5 (contrato de auth estabilizado primero, para no reescribir tests dos veces)
- **Costo:** M
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** Un cambio de DTO backend rompe un test de contrato antes de llegar a runtime del cliente.

### T-F2.3 — Escritura real en `audit_log`
- **IDs de origen:** `M5`, `F2.3`, `H6`
- **Fuente:** Documento 2, Documento 3 §11, Documento 7 (Medios), Documento 8 (Fase 2)
- **Descripción:** Tabla `audit_log` definida sin ningún `INSERT`. Agregar `AuditLogService` inyectado en login/registro, cambios de rol, borrado de cuenta.
- **Depende de:** — (ninguna)
- **Costo:** S-M
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** Al menos las acciones de `auth`/`users` quedan auditadas, con test que lo verifique.

### T-F2.4 — Eliminar `ride_sessions` sin uso en Postgres
- **IDs de origen:** `M4`, `F2.4`, `H5`
- **Fuente:** Documento 2, Documento 7 (Medios), Documento 8 (Fase 2)
- **Depende de:** — (ninguna)
- **Costo:** S
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** Migración que elimina la tabla, confirmando primero (por búsqueda repetible) que ningún código la referencia.

### T-F2.5 — Eliminar dependencias muertas
- **IDs de origen:** `B4`, `F2.5`
- **Fuente:** Documento 2 §2.6, Documento 7 (Bajos), Documento 8 (Fase 2)
- **Descripción:** Eliminar de `pubspec.yaml`: `logger`, `injectable`, `injectable_generator`, `riverpod_generator`, `riverpod_annotation`, `freezed`, `freezed_annotation`, `json_serializable`, `json_annotation` (9 paquetes, 0 usos confirmados).
- **Depende de:** — (ninguna)
- **Costo:** S
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** `pubspec.yaml` sin las 9 dependencias; `flutter analyze`/`flutter test` siguen en verde.

### T-F2.6 — `integration_test/` para flujos críticos
- **IDs de origen:** `B3`, `F2.6`
- **Fuente:** Documento 1 §6/§8, Documento 7 (Bajos), Documento 8 (Fase 2)
- **Depende de:** T-F1.5 (evita reescribir si el flujo de auth cambia)
- **Costo:** M
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** Al menos 2 flujos críticos cubiertos: login→home, BLE simulado→HUD→resumen.

### T-F2.7 — Windows: generar proyecto nativo + validar plugins de riesgo
- **IDs de origen:** `B2`, `F2.7`, `PLAT-2`, `PLAT-3`, `PLAT-4`, `M8`
- **Fuente:** Documento 1 §6, Documento 6 §1/§4, Documento 7 (Bajos/Medios), Documento 8 (Fase 2)
- **Descripción:** Ejecutar `flutter create --platforms=windows`; validar `flutter build windows`; verificar comportamiento real de `google_sign_in`/`sign_in_with_apple` (`PLAT-3`, sin implementación oficial de escritorio) y de Firebase con la config de Web reutilizada como placeholder (`PLAT-4`/`M8`).
- **Depende de:** — (ninguna)
- **Costo:** S (generar) + M (validar/arreglar plugins)
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** `flutter build windows` compila sin errores; login social y Firebase verificados en el build real (no solo en teoría).

---

## FASE 3 — Plataforma lista para escalar (100K+ usuarios reales)

### T-F3.1 — Profiling real de rendimiento
- **IDs de origen:** `F3.1`, `R5`
- **Fuente:** Documento 4 §8, Documento 8 (Fase 3)
- **Descripción:** Sesión de entrenamiento en vivo con telemetría BLE a frecuencia realista — mayor riesgo de jank identificado en toda la auditoría.
- **Depende de:** — (ninguna, pero de mayor valor una vez QG2 cumplida)
- **Costo:** M
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** Sesión de 3+ horas simulada, con medición de FPS/RAM vía Flutter DevTools, documentada con veredicto explícito.

### T-F3.2 — Prueba de carga real contra staging
- **IDs de origen:** `F3.2`
- **Fuente:** Documento 5, Documento 8 (Fase 3)
- **Depende de:** T-F1.3
- **Costo:** M
- **¿Requiere autorización del propietario?:** No
- **Criterio de aceptación:** Prueba de carga ejecutada (`k6`/`autocannon` u otra) con resultados documentados contra staging real, no proyecciones.

### T-F3.3 — Réplicas de lectura Postgres (condicional)
- **IDs de origen:** `F3.3`
- **Fuente:** Documento 8 (Fase 3)
- **Depende de:** T-F3.2, **solo si la prueba de carga lo justifica**
- **Costo:** M-L
- **¿Requiere autorización del propietario?:** No (técnica), pero condicionada a evidencia de T-F3.2
- **Criterio de aceptación:** Solo aplica si T-F3.2 documenta la necesidad; de lo contrario, tarea cerrada como "no requerida por ahora".

### T-F3.4 — Cola de trabajos en segundo plano (condicional)
- **IDs de origen:** `F3.4`
- **Fuente:** Documento 8 (Fase 3)
- **Depende de:** avance parcial de Fase 4 (Estadísticas/Notificaciones)
- **Costo:** M
- **¿Requiere autorización del propietario?:** No (técnica), sujeta a que Fase 4 avance
- **Criterio de aceptación:** Solo aplica cuando exista un consumidor real (Estadísticas o Notificaciones); no se construye antes.

---

## FASE 4 — Evolución de producto (orden técnico, no de prioridad de negocio)

Cada epic requiere autorización explícita del propietario para iniciarse (ver `MASTER_EXECUTION_PLAN.md` §9, QG-Producto) y su propio criterio de aceptación, a definir cuando se priorice — **este backlog no inventa criterios de producto que la auditoría no definió**.

### T-F4.1 — Rutas reales (D3)
- **Fuente:** Documento 8 (Fase 4, ítem 1)
- **Depende de:** — (ninguna técnica)
- **Desbloquea:** T-F4.3 (Estadísticas), T-F4.5 (Descargas)

### T-F4.2 — Notificaciones
- **Fuente:** Documento 8 (Fase 4, ítem 2), Documento 2 §1.16
- **Depende de:** — (ninguna; `firebase_messaging` ya declarado, bajo costo relativo)
- **Nota:** Independiente del resto de Fase 4, paralelizable con T-F4.1.

### T-F4.3 — Estadísticas agregadas
- **Fuente:** Documento 8 (Fase 4, ítem 3)
- **Depende de:** T-F4.1 (Rutas real) + volumen de datos de Entrenamientos/Workouts ya fluyendo

### T-F4.4 — Eventos/Clubes
- **Fuente:** Documento 8 (Fase 4, ítem 4)
- **Depende de:** T-F4.3 (Estadísticas, para rankings/retos con sentido competitivo)

### T-F4.5 — Descargas offline
- **Fuente:** Documento 8 (Fase 4, ítem 5)
- **Depende de:** T-F4.1 (Rutas), eventualmente Video (fuera de alcance actual)

### T-F4.6 — Marketplace/Creadores/Entrenadores/Gimnasios
- **Fuente:** Documento 8 (Fase 4, ítem 6), `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md`
- **Depende de:** base de usuarios y contenido activos (implícitamente, todo lo anterior de Fase 4)

---

## BACKLOG TRANSVERSAL — sin fase asignada explícita en Documento 8, insertado para minimizar retrabajo

Estas tareas provienen de riesgos/hallazgos/recomendaciones reales de la auditoría que Documento 8 no ató a un ID de fase específico. Se insertan aquí con la recomendación de cuándo ejecutarlas para no bloquear ni duplicar trabajo de las Fases 0-4.

### T-TRANS.1 — Reescribir historial de git (credenciales QA antiguas)
- **ID de origen:** `M9`
- **Fuente:** Documento 3 §8, Documento 7 (Medios)
- **Depende de:** — (ninguna técnica)
- **Costo:** M (alto cuidado operacional — operación irreversible)
- **¿Requiere autorización del propietario?:** **Sí**
- **Cuándo insertarla:** en cualquier momento una vez autorizada — no bloquea ni es bloqueada por ninguna otra tarea; cuanto antes se autorice, menor la ventana de exposición histórica.

### T-TRANS.2 — Dividir `BleDataSourceImpl` (monitoreo, no programado)
- **ID de origen:** `B7`, `H7`
- **Fuente:** Documento 2 §H7, Documento 7 (Bajos)
- **Depende de:** — (ninguna)
- **Costo:** M si se decide dividir
- **¿Requiere autorización del propietario?:** No
- **Cuándo insertarla:** **no programar** — solo si el archivo supera ~600 líneas o se agrega soporte ANT+ (momento natural para extraer la política de reconexión compartida). Se mantiene en el backlog como vigilancia, no como tarea a ejecutar ahora.

### T-TRANS.3 — Cerrar `telemetryController` en `_DeviceSession`
- **ID de origen:** `B8`, `R1`
- **Fuente:** Documento 4 §4, Documento 7 (Bajos)
- **Depende de:** — (ninguna)
- **Costo:** S
- **¿Requiere autorización del propietario?:** No
- **Cuándo insertarla:** oportunista, junto con T-TRANS.4 (mismo archivo) — recomendado agruparlas en un mismo cambio para no tocar `ble_datasource.dart` dos veces.
- **Incluye verificación pendiente:** confirmar que `forgetDevice()` remueve efectivamente `_DeviceSession` del mapa interno (Documento 4 §8, punto 5).

### T-TRANS.4 — Límite de tamaño de caché de Firestore
- **ID de origen:** `B9`, `R3`
- **Fuente:** Documento 4 §1, Documento 7 (Bajos)
- **Depende de:** — (ninguna)
- **Costo:** S
- **¿Requiere autorización del propietario?:** No
- **Cuándo insertarla:** oportunista, baja urgencia — a vigilar con el tiempo de uso real.

### T-TRANS.5 — `applicationId`/`package_name` Android final
- **ID de origen:** `B10`
- **Fuente:** Documento 7 (Bajos), Documento 1
- **Depende de:** decisión de producto (nombre final)
- **Costo:** S técnico
- **¿Requiere autorización del propietario?:** **Sí** (nombre de marca)
- **Cuándo insertarla:** antes de cualquier build de release firmable; sin urgencia mientras no exista una fecha de publicación.

### T-TRANS.6 — Actualizar `CI_CD_GUIDE.md`
- **ID de origen:** `B5`
- **Fuente:** Documento 1, Documento 7 (Bajos)
- **Depende de:** T-F1.2 (pipeline de CD real) — se actualiza junto con esa tarea para describir lo que existe, no lo que existía antes del primer push
- **Costo:** S
- **¿Requiere autorización del propietario?:** No

### T-TRANS.7 — Verificaciones pendientes de la auditoría (agrupadas)
- **Fuente:** Documento 3 §13, Documento 4 §8, Documento 6 §6, Documento 9 §5 (consolidado)
- **Descripción:** Conjunto de comprobaciones puntuales, de bajo costo individual, que la auditoría dejó explícitamente como "no verificado":
  1. `npm audit` / escaneo de CVEs en dependencias (backend y pub.dev) — recomendado antes de cualquier release público.
  2. Confirmar existencia real de la Cloud Function de borrado de cuenta (soft delete de 30 días) mencionada en `firestore.rules`.
  3. Verificar valores exactos de `@Throttle()` por ruta más allá de `/auth/refresh`.
  4. Confirmar alcance exacto de `checkForRecoverableSnapshot()` (Documento 2 §1.7).
  5. Confirmar si `statistics_page.dart` tiene una lista acotada por diseño o requiere `ListView.builder`.
  6. Medir tamaño de bundle/APK.
- **Depende de:** — (ninguna, todas independientes entre sí)
- **Costo:** S cada una
- **¿Requiere autorización del propietario?:** No
- **Cuándo insertarla:** distribuidas oportunísticamente durante Fase 1-2; el punto 1 (`npm audit`) se recomienda antes de T-F1.1 (elegir hosting) por ser el más barato y de mayor valor preventivo.

### T-TRANS.8 — Auditoría de accesibilidad dedicada
- **Fuente:** Documento 9 §1.4/§3 (recomendación #5, "Tratar accesibilidad como requisito de release, no como mejora posterior")
- **Descripción:** Solo 4 archivos en todo `lib/` usan `Semantics`/`semanticLabel`. Ejecutar una auditoría de accesibilidad dedicada (fuera del alcance técnico de la auditoría arquitectónica), con foco inicial en el HUD de entrenamiento y los formularios de auth/registro.
- **Depende de:** — (ninguna)
- **Costo:** No estimado por la auditoría original (fuera de su alcance) — se recomienda dimensionar como una tarea propia antes de fijar costo
- **¿Requiere autorización del propietario?:** No para iniciar el diagnóstico; sí para priorizar frente a otras tareas de Fase 2-3
- **Cuándo insertarla:** antes de cualquier release público — mismo criterio que T-TRANS.7.1.

---

## Orden de ejecución consolidado (resumen numerado, sin duplicados)

1. T-F0.1, T-F0.2 (iniciar decisión), T-F0.3, T-F0.4, T-F0.5 — paralelizables
2. T-F1.1 → T-F1.2, T-F1.3 (paralelizables entre sí una vez T-F1.1 resuelto) → T-F1.4 (independiente, cualquier momento desde ya)
3. T-F1.5
4. T-F2.1, T-F2.3, T-F2.4, T-F2.5, T-F2.7 (paralelizables, sin esperar T-F1.5) + T-F2.2, T-F2.6 (esperan T-F1.5)
5. T-F3.1, T-F3.2 → T-F3.3 (condicional) ; T-F3.4 (condicional a Fase 4)
6. T-F4.1 y T-F4.2 (paralelizables) → T-F4.3 → T-F4.4 ; T-F4.5 (tras T-F4.1) ; T-F4.6 (al final)
7. Backlog transversal (T-TRANS.1 a T-TRANS.8) — sin bloquear ni ser bloqueado por 1-6, insertado oportunísticamente según las notas de "cuándo insertarla" de cada una.

**Total de tareas en este backlog: 20 tareas de Fase 0-3 + 6 epics de Fase 4 + 8 tareas transversales = 34 unidades ejecutables, cubriendo el 100% de los riesgos (`C1`-`C2`, `A1`-`A2`, `M1`-`M10`, `B1`-`B10`) y hallazgos citados en Documento 7, sin ninguno sin tarea asociada (M1 se documenta como ya cerrado — corrección de documentación aplicada en v1.1, sin tarea de ejecución pendiente).**
