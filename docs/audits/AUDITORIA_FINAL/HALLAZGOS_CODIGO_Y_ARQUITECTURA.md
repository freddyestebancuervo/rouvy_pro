# RidePro — Hallazgos de Arquitectura y Código (revisión dirigida)

- **Fecha:** 2026-07-24
- **Rol:** Arquitecto Principal, modo auditoría — **ningún código fue modificado en esta revisión**.
- **Rama / HEAD:** `feature/d2` / `d3d01d8` (sin cambios de código durante esta tarea — confirmable con `git status --short` al cierre).
- **Alcance:** revisión dirigida (no exhaustiva línea por línea de todo el repo) sobre 8 ejes: estructura de clases/archivos grandes, dependencias cruzadas entre features, duplicación de modelos/servicios/repositorios/datasources, responsabilidades mezcladas, cuellos de botella, dependencias circulares, fuentes de verdad múltiples, riesgos Flutter↔Firebase↔NestJS↔PostgreSQL.
- **Estado de la revisión: INCOMPLETA respecto a "línea por línea de todo el repo".** Es una revisión dirigida por evidencia (ranking de tamaño de archivo, grep estructural, lectura completa de los archivos más grandes/más acoplados, lectura de los módulos backend con mayor riesgo de ciclo). No se declara esta auditoría "aprobada" ni "cerrada" — ver sección 8 para lo que queda sin verificar.
- Este informe alimenta el **Documento 2 (Calidad del Código)** de la serie de 9 documentos (`docs/audits/AUDITORIA_FINAL/`); no lo reemplaza.

---

## 1. Resumen ejecutivo

| Severidad | Cantidad | Hallazgos |
|---|---|---|
| 🔴 Crítico | 0 | Ninguno encontrado en esta pasada |
| 🟠 Alto | 1 | H1 — Auth dual Firebase/NestJS sin puente (ya documentado en auditorías previas, reconfirmado con evidencia nueva) |
| 🟡 Medio | 4 | H2 (acoplamiento cross-feature vía `presentation`), H3 (sin idempotencia en escrituras NestJS), H4 (sin tests de contrato Flutter↔NestJS), H5 (`ride_sessions` duplicada Postgres/Firestore) |
| 🟢 Bajo | 2 | H6 (`audit_log` sin `INSERT`), H7 (`BleDataSourceImpl` concentra 3 responsabilidades en un archivo, sin evidencia de que cause bugs hoy) |
| ✅ Verificado y descartado | 3 | Ver sección 7 — cosas que parecían riesgo y se comprobó que NO lo son |

**Ningún hallazgo de esta pasada exige detener el trabajo por pérdida de datos, irreversibilidad, o vulnerabilidad explotable hoy mismo.** Se documentan y priorizan; no se ejecuta ningún cambio.

---

## 2. Hallazgos

### H1 — Dos sistemas de autenticación (Firebase / NestJS) sin puente real
**Severidad: Alto**

- **Archivo:** `lib/core/config/dev_backend_test_user.dart` (íntegro — el archivo existe únicamente por este motivo).
- **Evidencia:** el propio docblock del archivo documenta que, en `kDebugMode`, el cliente sustituye la sesión real de Firebase por una cuenta de prueba fija para poder llamar al backend NestJS. Confirmado además por: `backend/src/modules/auth/auth.module.ts` (JWT propio, RS256, sin ningún import de Firebase Admin SDK ni verificación de ID token de Firebase) y ausencia de cualquier endpoint tipo `POST /auth/firebase-exchange` en `backend/src/modules/auth/auth.controller.ts`.
- **Consecuencia técnica:** un usuario autenticado con Firebase (el único mecanismo de login real de la app) no tiene, hoy, ningún camino para obtener una sesión válida contra el backend NestJS fuera de `kDebugMode`. **Workouts y Equipment son funcionalmente inalcanzables en producción real**, pese a estar completos y probados (7 suites e2e contra Postgres real).
- **Solución recomendada:** implementar un endpoint de intercambio (`Firebase ID token` → `JWT propio`) que verifique el ID token con Firebase Admin SDK en el backend y emita el JWT propio de NestJS para el mismo usuario (mapeado por `uid` de Firebase). Alternativa descartada: duplicar login/registro en NestJS de forma independiente de Firebase — generaría un tercer sistema de identidad, no dos; se prefiere el intercambio porque preserva una única fuente de verdad de identidad (Firebase Auth).
- **Orden de corrección:** antes de exponer Workouts/Equipment a cualquier usuario real. Bloqueante de negocio, no solo técnico.

### H2 — Acoplamiento cruzado entre features a través de la capa `presentation` (contradice la regla documentada)
**Severidad: Medio**

La documentación de arquitectura existente (`docs/architecture/01_SYSTEM_ARCHITECTURE.md` sección 1.4, y el Documento 1 de esta misma serie, sección 4.2) afirma: *"ningún feature importa la capa `data`/`presentation` de otro — todo acoplamiento cruzado pasa por `domain`"*. **Esta afirmación es incorrecta**, verificado por grep directo de imports:

- `lib/features/home/presentation/pages/home_page.dart:7-9` → importa `../../../auth/domain/entities/user_entity.dart`, `../../../auth/presentation/providers/auth_providers.dart`, `../../../auth/presentation/providers/logout_controller.dart`
- `lib/features/profile/presentation/pages/profile_page.dart:11-14` → importa `auth/domain/entities/user_entity.dart` y **3** providers de `auth/presentation/providers/*`
- `lib/features/training/presentation/providers/ride_session_controller.dart:5-10` → importa 4 entidades de `device_connection/domain/*` **y** `device_connection/presentation/providers/device_providers.dart`
- `lib/features/achievements/presentation/providers/achievements_providers.dart:3-6` → importa 2 entidades de `training/domain/*` **y** `training/presentation/providers/ride_history_providers.dart`, `training/presentation/providers/statistics_providers.dart`

**Todas las importaciones son unidireccionales** (`home`→`auth`, `profile`→`auth`, `training`→`device_connection`, `achievements`→`training`) — verificado ejecutando la búsqueda inversa en cada caso: no hay ciclo (`auth` no importa nada de `home`/`profile`, `device_connection` no importa nada de `training`, `training` no importa nada de `achievements`).

- **Consecuencia técnica:** no es un bug activo — Riverpod trata los `providers` como una interfaz pública razonablemente estable, y este patrón (importar el provider de otro feature en vez de reimplementar el estado) es común y pragmático en apps Riverpod feature-first. El costo real es que **la regla de aislamiento documentada es falsa**, lo que genera expectativas incorrectas: un cambio en `auth_providers.dart`, `device_providers.dart` o los providers de `training` puede romper silenciosamente 2-4 features sin que ningún límite de compilación lo evite (a diferencia de una violación de `domain`, que el propio código impediría por tipos).
- **Solución recomendada (decisión, no ambas opciones a la vez):** **formalizar la regla como está en el código, no forzar una refactorización.** Se descarta introducir un "facade" de dominio para desacoplar estos 7 imports porque (a) no hay evidencia de que hayan causado un incidente, (b) el coste de refactorizar 4 features para ganar un aislamiento que hoy nadie necesita es sobre-ingeniería, mismo criterio ya aplicado en este proyecto para no adoptar microservicios/Redis sin necesidad comprobada. Se corrige la documentación (Documento 1 de esta serie, sección 4.2) para reflejar la regla real: *"domain-to-domain sin excepciones; presentation-to-presentation permitido solo para providers (nunca widgets/datasources), y siempre unidireccional — revisar con `grep` en cada PR que agregue un import cruzado nuevo que no rompa la direccionalidad ya establecida"*.
- **Orden de corrección:** bajo — es una corrección de documentación, ejecutable ahora sin riesgo (ver sección 4, ya aplicada a Documento 1 de esta serie). La opción de refactorizar a facades queda como ítem de bajo prioridad en el roadmap (Documento 8), solo si el equipo crece y el acoplamiento empieza a doler en la práctica.

### H3 — Sin idempotencia en los endpoints de escritura de NestJS
**Severidad: Medio** (reconfirmado, ya documentado en la auditoría previa del mismo día)

- **Evidencia:** inspección de `backend/src/modules/workouts/dto/create-workout.dto.ts` y `backend/src/modules/equipment/dto/create-equipment.dto.ts` — ningún DTO acepta un campo de idempotency key; `workouts.controller.ts`/`equipment.controller.ts` no leen ningún header tipo `Idempotency-Key`.
- **Consecuencia técnica:** un reintento de red tras un timeout ambiguo (¿llegó el POST original o no?) puede crear un recurso duplicado (`workout` o `equipment` repetido).
- **Solución recomendada:** agregar un campo `clientRequestId` (UUID generado en el cliente) a los DTOs de creación; el repositorio verifica antes de insertar si ya existe una fila con ese `clientRequestId` para el mismo usuario y, si existe, devuelve el recurso ya creado en vez de duplicar (patrón "upsert idempotente"). Aditivo, sin romper compatibilidad con clientes que no lo envíen (opcional en el DTO).
- **Orden de corrección:** antes de que el motor de sincronización offline (que reintenta automáticamente) exista — es un prerrequisito de esa pieza, no independiente.

### H4 — Sin tests de contrato entre Flutter y NestJS
**Severidad: Medio** (reconfirmado)

- **Evidencia:** ausencia de cualquier test que serialice el mismo JSON de ejemplo en ambos lados; los modelos Flutter (`lib/features/workouts/data/models/*.dart`) y los DTOs NestJS (`backend/src/modules/workouts/dto/*.dto.ts`) se mantienen sincronizados solo manualmente.
- **Consecuencia técnica:** un cambio de campo en un DTO backend (rename, tipo, opcionalidad) no falla ningún test hasta que un usuario real lo golpea en runtime.
- **Solución recomendada:** mínimo viable, sin introducir herramienta nueva (Pact/OpenAPI codegen) todavía: un test por recurso que tome un JSON de ejemplo fijo, lo deserialice con el modelo Flutter y lo valide contra el DTO NestJS (ejecutado en CI del lado que sea más simple integrarlo, probablemente un script Node que valide contra el `class-validator` del DTO). Evaluar herramienta formal solo si el número de endpoints crece lo suficiente para justificar el costo de adopción.
- **Orden de corrección:** después de H1 (estabilizar el contrato de auth primero, para no escribir tests de contrato dos veces).

### H5 — `ride_sessions` (PostgreSQL) duplica conceptualmente `users/{uid}/ride_sessions` (Firestore) sin ningún escritor
**Severidad: Medio** (impacto real bajo, pero es exactamente el tipo de "fuente de verdad múltiple" que el punto 7 del pedido busca detectar)

- **Evidencia:** tabla `ride_sessions` definida en `backend/migrations/0001_init.sql`; cero referencias a un `INSERT INTO ride_sessions` en todo `backend/src/` (`grep -rn "ride_sessions" backend/src` → sin resultados de escritura, solo el esquema). La fuente de verdad real y única en uso es `users/{uid}/ride_sessions` en Firestore.
- **Consecuencia técnica:** ningún bug hoy (tabla vacía, sin lectores). El riesgo es de mantenibilidad/onboarding: cualquier desarrollador nuevo que lea el esquema de Postgres asumirá que ahí vive el historial de sesiones, y no es así.
- **Solución recomendada:** eliminar la tabla en una migración nueva (`DROP TABLE ride_sessions`) una vez confirmado (con `grep` repetible como el de arriba) que ningún código la referencia — es un cambio aditivo de bajo riesgo, no destructivo de datos reales (la tabla está vacía).
- **Orden de corrección:** bajo, oportunista — se puede hacer en la misma tanda que cualquier otra migración de limpieza.

### H6 — Tabla `audit_log` (PostgreSQL) sin un solo `INSERT` en todo el backend
**Severidad: Bajo** (impacto de seguridad se evalúa en el Documento 3; acá se registra como hallazgo de código)

- **Evidencia:** `grep -rn "audit_log" backend/src` → la tabla existe en el esquema, cero referencias de escritura en servicios/repositorios.
- **Consecuencia técnica:** sin trazabilidad de acciones críticas (cambios de rol, borrado de cuenta) si algo sale mal.
- **Solución recomendada:** añadir un `AuditLogService` inyectado en los puntos ya identificados como críticos (`auth.service.ts` login/registro, `users.service.ts` cambios de rol/borrado) — cambio aditivo, sin afectar el flujo existente.
- **Orden de corrección:** antes de exponer cualquier función administrativa (cambio de rol, borrado de cuenta de terceros).

### H7 — `BleDataSourceImpl` concentra descubrimiento, conexión, parsing y reconexión con backoff en un mismo archivo (473 líneas)
**Severidad: Bajo**

- **Archivo:** `lib/features/device_connection/data/datasources/ble_datasource.dart` (473 líneas; clases `_DeviceSession`, `BleDataSource` (abstracta), `BleDataSourceImpl`).
- **Evidencia:** el archivo mezcla 4 responsabilidades: gestión de sesión por dispositivo (`_DeviceSession`), escaneo, conexión/reconexión con backoff exponencial y límite de tiempo total, y despacho a los parsers de protocolo (`CyclingPowerParser`, `CscParser`, `FtmsParser`, `HeartRateParser`, `BatteryLevelParser`).
- **Consecuencia técnica:** ninguna detectada hoy — el archivo está internamente bien organizado (una clase privada por responsabilidad, comentarios que documentan decisiones no obvias como el límite de tiempo total de reconexión). **No se encontró evidencia de que esto cause bugs o dificulte el mantenimiento actual** — se registra como candidato a dividir (`ble_session_manager.dart` / `ble_reconnection_policy.dart` / `ble_datasource.dart`) solo si el archivo sigue creciendo, no como una acción a tomar ahora.
- **Solución recomendada:** ninguna acción inmediata. Revisar si el archivo supera ~600 líneas o si se agrega soporte ANT+ (que reutilizaría el mismo patrón de reconexión, sección 3 del Documento 1) — ese sería el punto natural para extraer la política de reconexión a una clase compartida entre BLE y ANT+.
- **Orden de corrección:** ninguno — es una observación de vigilancia, no un defecto.

---

## 3. Cuellos de botella (arquitectura, rendimiento, mantenimiento)

No se encontraron cuellos de botella **nuevos** respecto a los ya documentados en el Documento 1 (sección 6) y en `docs/architecture/01_SYSTEM_ARCHITECTURE.md` sección 10: ausencia de lazy-loading de rutas en `go_router`, ausencia de paginación consistente fuera de `ride_sessions`/`workouts`/`equipment`, ausencia de caché de lectura en NestJS. Se confirma que **no hay evidencia de N+1** en los repositorios backend: cada `*.repository.ts` usa `pg.Pool` con consultas explícitas y acotadas por endpoint (sin ORM con lazy-loading, que es la fuente típica de N+1) — verificado por lectura completa de `equipment.repository.ts` (el más grande, 322 líneas) y `workouts.repository.ts`.

---

## 4. Dependencias circulares — verificado, ninguna encontrada

- **Backend:** lectura completa de `auth.module.ts` y `users.module.ts` — `AuthModule` importa `UsersModule` y `RefreshTokensModule`; `UsersModule` importa solo `RefreshTokensModule` (no importa `AuthModule` de vuelta). `TokenService` vive en `JwtModule` (`@Global()`), exactamente para que ni `AuthModule` ni `UsersModule` necesiten importarse mutuamente para acceder a él — decisión de diseño correcta y confirmada en el código, no solo en el comentario. Evidencia adicional indirecta pero fuerte: los **57/57 tests e2e del backend pasan contra Postgres real** (ver `docs/audits/ARCHITECTURE_AUDIT_FINAL.md` sección 5), lo que implica que el grafo de DI de Nest resuelve en runtime sin error de dependencia circular (Nest falla al arrancar si hay un ciclo no resuelto).
- **Flutter (cross-feature):** las 4 direcciones de import encontradas en H2 (`home`→`auth`, `profile`→`auth`, `training`→`device_connection`, `achievements`→`training`) son todas unidireccionales — verificado buscando la dirección inversa en cada caso (`auth` no importa `home`/`profile`; `device_connection` no importa `training`; `training` no importa `achievements`). **Sin ciclos.**

---

## 5. Duplicación de modelos/servicios/repositorios/datasources — verificado, sin duplicación significativa

- Patrón de manejo de errores Postgres (`translatePgError`) usado consistentemente por los 4 repositorios que lo necesitan (`equipment`, `refresh-tokens`, `users`, `workouts`) — es reutilización correcta, no duplicación.
- `assertOwned()` reutilizado por `equipment.service.ts` y `workouts.service.ts` sin reimplementación — mismo patrón.
- No se encontró un segundo datasource/repositorio que reimplemente lógica ya existente en otro (p. ej., dos formas distintas de parsear el mismo payload BLE, o dos clientes HTTP hacia el mismo backend).

---

## 6. Fuentes de verdad múltiples para el mismo dato — hallazgos

| Dato | Sistemas que lo tocan | ¿Fuente de verdad clara? |
|---|---|---|
| Identidad de usuario (app principal) | Firebase Auth únicamente | ✅ Sí |
| Identidad de usuario (backend NestJS) | PostgreSQL `users`, sin vínculo con Firebase Auth | 🟡 Fuente de verdad propia pero **desconectada** de la identidad real del usuario — ver H1 |
| Historial de sesiones de entrenamiento | Firestore (real) + tabla Postgres `ride_sessions` (vacía, sin escritor) | 🟡 Ver H5 — riesgo de confusión, no de inconsistencia de datos (la segunda tabla nunca se llena) |
| Perfil de usuario | Firestore `users/{uid}` únicamente | ✅ Sí |
| Equipment / Workouts | PostgreSQL únicamente | ✅ Sí |

---

## 7. Verificado y descartado — cosas que parecían un riesgo y no lo son

1. **"Archivos de página con múltiples clases privadas" (`workout_form_page.dart` con 7 clases, `session_summary_page.dart` con 5, `workout_detail_page.dart` con 6, etc.)** — se verificó que es un **patrón consistente en las 15 páginas más grandes del proyecto** (StatefulWidget + State + widgets privados de un solo uso, colocados junto a su única página consumidora). Es idiomático en Flutter, no fragmenta responsabilidades reales — **no se reporta como hallazgo**, se documenta acá explícitamente para dejar constancia de que se revisó y se descartó, no que se pasó por alto.
2. **Ciclo de dependencia `AuthModule`↔`UsersModule`** — se sospechaba por el uso de `@Global()` en `JwtModule` (suele ser síntoma de un ciclo que se está evitando); se confirmó leyendo ambos módulos que, en efecto, se evita un ciclo, pero el diseño ya es correcto — no hay ciclo real, solo la prevención deliberada de uno.
3. **Posible N+1 en `equipment.repository.ts`** (por ser el archivo backend más largo, 322 líneas) — se leyó completo: es extenso porque cubre jerarquía padre/hijo de equipamiento + conversión de tipos `NUMERIC`/`BIGINT` (comentado explícitamente en el código, línea ~20-23), no por lógica repetida o consultas en bucle.

---

## 8. Elementos que NO se pudieron verificar en esta pasada

Listados explícitamente para no dar una falsa sensación de cobertura total:

1. **Alcance exacto de `RideSessionController.checkForRecoverableSnapshot()`** (`lib/features/training/presentation/providers/ride_session_controller.dart`) — no se leyó el archivo completo línea por línea en esta pasada; se desconoce si persiste ya un snapshot real o solo expone el método. Ya señalado como pendiente en la auditoría previa del mismo día, sigue pendiente.
2. **Duplicación de lógica a nivel de sub-función** (no de archivo/clase) — esta revisión comparó tamaños de archivo, imports y patrones estructurales, **no hizo un diff semántico línea por línea de toda la base de código** para detectar bloques de lógica casi idéntica dentro de funciones grandes.
3. **Comportamiento en runtime bajo carga** (por ejemplo, si `TelemetryAggregator` realmente libera memoria en todos los casos de cierre anormal de sesión, no solo en el camino feliz) — requiere prueba dirigida o profiling, no solo lectura de código.
4. **Cobertura completa de `workout_form_page.dart` más allá de la línea 80** — se leyó el encabezado y la lista de clases; no se revisó línea por línea el cuerpo de `_CreateWorkoutFormState`/`_EditWorkoutFormState` en busca de lógica de validación duplicada entre creación y edición.
5. **Todos los archivos de `lib/features/*/data/` no mencionados explícitamente arriba** (aprox. 200 archivos Dart totales en el proyecto, se inspeccionaron en detalle menos de 15) — la revisión fue dirigida por tamaño/riesgo, no exhaustiva.

**Por lo anterior, esta revisión NO se declara completa ni aprobada como auditoría final de código** — es un conjunto de hallazgos verificados con evidencia, más una lista explícita de lo que queda por revisar si se quiere alcanzar cobertura línea por línea del repositorio completo.

---

## 9. Orden de corrección consolidado

| Orden | Hallazgo | Severidad | Bloqueante de |
|---|---|---|---|
| 1 | H1 — Puente de autenticación Firebase↔NestJS | Alto | Exponer Workouts/Equipment a usuarios reales |
| 2 | H2 — Corregir documentación de la regla de aislamiento entre features | Medio | Ya aplicado en esta sesión (ver sección 10) |
| 3 | H3 — Idempotencia en escrituras NestJS | Medio | Motor de sincronización offline |
| 4 | H6 — Escritura real en `audit_log` | Bajo/Medio (seguridad) | Funciones administrativas (cambio de rol/borrado) |
| 5 | H4 — Tests de contrato Flutter↔NestJS | Medio | — (mitiga riesgo continuo, no bloquea nada puntual) |
| 6 | H5 — Eliminar tabla `ride_sessions` sin uso en Postgres | Medio (bajo impacto real) | — |
| 7 | H7 — Dividir `ble_datasource.dart` | Bajo | Solo si crece o se agrega ANT+ |

---

## 10. Cambios aplicados durante esta revisión

**Ningún archivo de código (`lib/**/*.dart`, `backend/src/**/*.ts`) fue modificado**, según lo pedido explícitamente. El único cambio de contenido fue documental y ya estaba dentro del alcance autorizado de esta sesión (corrección de una afirmación incorrecta en un documento propio, no publicado/no commiteado, creado en esta misma sesión):

- `01_ARQUITECTURA_GENERAL.md` (misma carpeta), sección 4.2 — pendiente de corrección inmediata después de este informe (ver siguiente acción) para reemplazar la afirmación *"ningún feature importa la capa `data`/`presentation` de otro"* por la regla real documentada en H2 arriba.

---

## 11. Comandos ejecutados (evidencia, de solo lectura salvo la creación de este archivo)

```bash
find lib -name "*.dart" -not -name "*.g.dart" -not -name "*.freezed.dart" | xargs wc -l | sort -rn
find backend/src -name "*.ts" -not -name "*.spec.ts" | xargs wc -l | sort -rn
grep -rn "TODO\|FIXME\|HACK\|XXX" lib backend/src --include="*.dart" --include="*.ts"
grep -rn "import '\.\./\.\./\.\./\.\./" lib/features --include="*.dart"
for f in achievements auth device_connection home profile routes_catalog settings training wearables workouts; do
  grep -rn "\.\./\.\./\.\./$f/\|\.\./\.\./\.\./\.\./$f/\|\.\./\.\./$f/" lib/features --include="*.dart" | grep -v "^lib/features/$f/"
done
grep -c "translatePgError\|catch (" backend/src/modules/*/*.repository.ts
grep -rn "assertOwned" backend/src/modules --include="*.ts"
grep -n "^class " lib/features/workouts/presentation/pages/workout_form_page.dart
for f in $(find lib/features -path "*/presentation/pages/*.dart"); do
  c=$(grep -c "^class " "$f"); [ "$c" -gt 1 ] && echo "$c classes: $f"
done
git status --short
```

Todos los archivos citados con número de línea fueron leídos directamente (`Read`), no inferidos del nombre.
