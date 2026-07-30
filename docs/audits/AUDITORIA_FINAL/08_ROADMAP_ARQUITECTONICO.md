# RidePro — Documento Maestro de Arquitectura
## Documento 8 de 9: Roadmap Arquitectónico

- **Fecha:** 2026-07-24 · **Rama/HEAD:** `feature/d2` / `d3d01d8`
- **Alcance:** roadmap **arquitectónico** (infraestructura, deuda técnica, capacidades de plataforma) — no un roadmap de producto/negocio (qué feature lanzar primero es una decisión de negocio fuera del alcance de este documento). Incluye la evaluación de "Futuro" pedida (IA, VR/AR, eventos, marketplace, wearables) contra la arquitectura actual.
- **No se modifica código en este documento.**

---

## 1. Principio del roadmap

**Ningún ítem de este roadmap propone reescribir nada existente.** Es incremental sobre la arquitectura ya validada en el Documento 1 (Clean Architecture por feature, monolito modular NestJS, Firestore + Postgres con fuentes de verdad separadas). El criterio de priorización es: **infraestructura y deuda que bloquea negocio real, antes que features nuevas** — coherente con la instrucción explícita del propietario de operar en este modo (ver memoria de reglas de operación de este proyecto).

## 2. Fases

### Fase 0 — Desbloqueo (antes de cualquier otra cosa)

| ID | Acción | Depende de | Costo | Fuente del riesgo |
|---|---|---|---|---|
| F0.1 | Corregir crash de Web en Wearables (A2) | — | S | Documento 6/7 |
| F0.2 | Decisión del propietario: proyectos Firebase separados por entorno (C1) | — | M (decisión) + M (ejecución) | Documento 7 |
| F0.3 | `docker-compose.yml` para desarrollo local | — | S-M | Documento 1 §6/§8 |
| F0.4 | Rate limiter → Redis (prerequisito de escalar el backend, M6) | F0.3 (conveniente tenerlo primero, no estrictamente bloqueante) | M | Documento 5/7 |
| F0.5 | Paginación real en `equipment`/`workouts` (M7) | — | S | Documento 5/7 |

### Fase 1 — Backend real en producción

| ID | Acción | Depende de | Costo |
|---|---|---|---|
| F1.1 | Elegir plataforma de hosting del backend (decisión de negocio) | F0.2 | — (decisión) |
| F1.2 | Pipeline de CD | F1.1, F0.3 | M |
| F1.3 | Entorno de staging real | F1.1 | M |
| F1.4 | Extender CI: lint/tsc backend, escaneo de secretos, formato (B6) | — | S |
| F1.5 | **Puente de autenticación Firebase↔NestJS (A1)** | F1.3 (para probar contra un entorno real antes de exponerlo) | L |

### Fase 2 — Cerrar deuda de calidad antes de escalar el catálogo de módulos

| ID | Acción | Depende de | Costo |
|---|---|---|---|
| F2.1 | Idempotencia en endpoints de escritura NestJS (M2) | — | S-M |
| F2.2 | Tests de contrato Flutter↔NestJS (M3) | F1.5 (contrato de auth estabilizado primero) | M |
| F2.3 | Escritura real en `audit_log` (M5) | — | S-M |
| F2.4 | Eliminar `ride_sessions` sin uso en Postgres (M4) | — | S |
| F2.5 | Eliminar 9 dependencias muertas (B4) | — | S |
| F2.6 | `integration_test/` para flujos críticos (B3) | F1.5 (evita reescribir si el flujo de auth cambia) | M |
| F2.7 | Windows: generar proyecto nativo + validar plugins de riesgo (B2, Documento 6 §4) | — | S (generar) + M (validar/arreglar plugins) |

### Fase 3 — Plataforma lista para escalar (100K+ usuarios reales)

| ID | Acción | Depende de | Costo |
|---|---|---|---|
| F3.1 | Profiling real de rendimiento (sesión de entrenamiento en vivo — mayor riesgo de jank, Documento 4 §8) | — | M |
| F3.2 | Prueba de carga real contra staging (Documento 5) | F1.3 | M |
| F3.3 | Réplicas de lectura Postgres si la prueba de carga lo justifica | F3.2 | M-L |
| F3.4 | Cola de trabajos en segundo plano (si Estadísticas/Notificaciones ya existen, ver Fase 4) | Fase 4 (parcial) | M |

### Fase 4 — Evolución de producto (módulos nuevos, sección 3 del Documento 1/2)

Orden sugerido por dependencia técnica, **no por prioridad de negocio** (esa decisión es del propietario):

1. **Rutas reales** (D3, hoy mock) — desbloquea Eventos y Estadísticas con datos reales.
2. **Notificaciones** (`firebase_messaging` ya declarado, sin consumidor — Documento 2 §1.16) — bajo costo relativo porque la dependencia ya está.
3. **Estadísticas agregadas** — requiere Rutas real + volumen de datos de Entrenamientos/Workouts ya fluyendo.
4. **Eventos/Clubes** — requiere Estadísticas para tener sentido competitivo (rankings, retos).
5. **Descargas offline** (rutas/contenido) — requiere que exista contenido real que descargar (Rutas, y eventualmente Video).
6. **Marketplace/Creadores/Entrenadores/Gimnasios** — explícitamente diferido en la spec ya existente (`docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md`), consistente con este roadmap: son módulos de monetización que dependen de tener primero una base de usuarios y contenido activos.

---

## 3. Futuro — evaluación de la arquitectura actual contra capacidades avanzadas

| Capacidad futura | ¿La arquitectura actual la soporta? | Qué falta |
|---|---|---|
| **IA (entrenador inteligente, recomendaciones)** | 🟡 Parcialmente — el principio de que ningún módulo core debe depender de una capacidad opcional (mismo criterio ya aplicado en el patrón Adapter de wearables, Documento 1 §7, y en la decisión de no introducir infraestructura sin necesidad comprobada, Documento 1 §2.3) es el diseño correcto de partida: IA debería ser 100% opcional/desactivable | Necesita una fuente de datos agregados real (Estadísticas, Fase 4) antes de que cualquier recomendación tenga datos sobre los que operar — construir IA antes que Estadísticas sería invertir el orden de dependencia de datos |
| **Eventos masivos / carreras en vivo** | 🔴 No — requiere infraestructura de tiempo real (WebSocket + pub/sub) que **hoy no existe y está correctamente diferida** (mismo criterio anti-sobreingeniería de Documento 1 §2.3 y ADR-0001: no introducir infraestructura nueva sin necesidad comprobada — no hay hoy caso de uso de alta frecuencia/múltiples suscriptores que lo justifique) | Diseño de infraestructura de tiempo real completo — no es una extensión del backend actual, es una pieza nueva (fan-out a N suscriptores por evento, algo que el monolito REST actual no está diseñado para hacer) |
| **Entrenamientos grupales** | 🟡 Parcialmente — el dominio de `training` ya está desacoplado del transporte de datos (Documento 2 §1.7), lo que ayuda, pero la sesión hoy es 100% local a un dispositivo | Requiere el mismo tipo de infraestructura de tiempo real que Eventos |
| **Marketplace / Creadores / Licencias** | 🟡 El principio de datos (Documento 1 §5, una fuente de verdad por dato) es compatible | Requiere integración de pasarela de pago (fuera del alcance técnico de este documento — es una decisión de proveedor + cumplimiento regulatorio), y los módulos Creadores/Marketplace en sí (Documento 2 §1.18, no existen) |
| **Wearables ampliados (Garmin, Polar, Coros)** | ✅ Sí, bien soportada — el patrón Adapter de wearables (`WearableAdapter`, Documento 2 §1.9) está diseñado exactamente para agregar un proveedor nuevo sin modificar el código existente (principio Open/Closed, verificado en Documento 2 §2.5) | Cada proveedor nuevo es un adapter nuevo — bajo costo incremental, no una reescritura |
| **Apple Health / Google Fit** | ✅ Ya implementado (`health` package) — con el defecto de Web a corregir primero (A2) | Nada estructural — ya es el patrón correcto |
| **ANT+** | ✅ Bien soportada — el dominio de `training`/`device_connection` ya está desacoplado del transporte BLE específico (verificado línea por línea en `ride_session_controller.dart`, Documento 2 §1.7) | Un datasource nuevo + parsers de protocolo ANT+, sin tocar el dominio de entrenamiento |
| **Video (rutas en video/3D)** | 🔴 No — requiere una pieza de infraestructura completamente nueva (streaming, CDN, transcodificación, almacenamiento de contenido pesado) | Dimensionar como proyecto de infraestructura propio cuando se priorice (Documento 5 §9) — no es una extensión incremental de nada existente hoy |
| **Realidad Virtual / Aumentada** | 🔴 No evaluable con la información actual — depende completamente de qué se construya (¿RV como visualización 3D del HUD? ¿AR para mostrar datos sobre video real?) | Fuera del alcance de este documento sin una definición de producto concreta — no se puede evaluar "arquitectura para RV" en abstracto |

**Fortaleza estructural a favor del futuro:** el criterio ya aplicado consistentemente en este proyecto (Clean Architecture por feature, patrón Adapter para todo lo específico de proveedor/plataforma, dominio desacoplado del transporte) es exactamente el que hace baratas las extensiones de la lista de arriba que dependen de "agregar un proveedor" (Wearables, ANT+) y caras las que requieren infraestructura nueva de cero (tiempo real, video, RV/AR) — no por una limitación de diseño, sino porque son categorías de problema genuinamente distintas a lo que el proyecto resuelve hoy.

---

## 4. Qué NUNCA debería tocarse (sin necesidad comprobada)

Reafirmando decisiones ya tomadas y correctas, para que no se reviertan sin razón:

- **No migrar a microservicios** — ADR-0001, sigue siendo correcto hasta que un dominio concreto (probablemente Estadísticas o Eventos) muestre una necesidad real de escalar/desplegarse por separado.
- **No introducir Redis/caché antes de necesitarlo** — el primer consumidor legítimo es el rate limiter (F0.4), no una optimización prematura de lecturas.
- **No adoptar el toolchain de generación de código muerto** (`injectable`, `freezed`, `riverpod_generator`) — se recomienda eliminarlo (F2.5), no activarlo, salvo que `injection.dart` cruce el umbral ya documentado (~300 líneas).
- **No forzar el desacoplamiento total de `presentation` entre features (M1)** — es un costo de refactor sin beneficio medido hoy.
- **No construir Administración/Marketplace/Entrenadores antes de tener el núcleo de datos real sobre el que operar** — ya decidido en `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md`, reafirmado acá.

## 5. Qué necesita pruebas / documentación (transversal a todas las fases)

- **Pruebas:** integración Flutter end-to-end (F2.6), contratos de API (F2.2), carga real (F3.2) — los 3 huecos reales de la pirámide de pruebas (Documento 1 §6/§8).
- **Documentación:** `CI_CD_GUIDE.md` desactualizado (B5) — actualizar en Fase 1 junto con el pipeline de CD real, para que el documento describa lo que existe, no lo que existía antes del primer push.

---

## 6. Criterios de aprobación de este documento

- [x] Roadmap por fases con dependencias explícitas, no una lista plana.
- [x] Distingue roadmap arquitectónico de roadmap de producto.
- [x] Evalúa explícitamente las 10 capacidades futuras pedidas contra la arquitectura actual, con veredicto individual.
- [x] Sección explícita de "qué no tocar" (para prevenir regresión de decisiones ya tomadas y justificadas).
- [x] Cada acción con costo relativo y dependencias.

**Siguiente documento:** Documento 9 — Recomendaciones Finales y Plan de Acción.
