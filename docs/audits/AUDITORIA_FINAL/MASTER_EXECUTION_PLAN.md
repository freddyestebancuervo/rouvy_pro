# RidePro — Plan Maestro de Ejecución
## MASTER_EXECUTION_PLAN.md

- **Fecha:** 2026-07-24
- **Fuente:** transformación directa de la Auditoría Arquitectónica Oficial v1.1 (`INDICE.md`, `RESUMEN_EJECUTIVO.md`, Documentos 1-9, `HALLAZGOS_CODIGO_Y_ARQUITECTURA.md`, `REVISION_FINAL_AUDITORIA_v1.1.md`) — **no se volvió a inspeccionar código fuente ni se generó ningún hallazgo, conclusión, severidad o prioridad nueva**. Este documento reorganiza lo ya auditado en formato de plan de ejecución.
- **Documento complementario:** `BACKLOG_MAESTRO.md` — contiene cada tarea individual, deduplicada, con dependencias y criterios de aceptación. Este documento da el marco; el backlog da el detalle ejecutable.
- **Convención de trazabilidad:** toda tarea citada aquí conserva su identificador original de la auditoría (`C1`/`C2`, `A1`/`A2`, `M1`-`M10`, `B1`-`B10` de Documento 7; `F0.1`-`F3.4` de Documento 8; `H1`-`H7`, `S1`-`S8`, `R1`-`R5`, `PLAT-1`-`PLAT-4` de sus documentos de origen) — no se inventaron IDs nuevos para evitar repetir el error de colisión de nomenclatura ya corregido en la v1.1 de la auditoría.

---

## 1. Visión general del proyecto

RidePro es una plataforma de ciclismo indoor (Flutter + NestJS/PostgreSQL + Firebase) con la ambición declarada de competir con ROUVY, Zwift, MyWhoosh y TrainerRoad. El stack actual cubre autenticación, perfil, entrenamiento en vivo con sensores BLE, wearables, logros y un backend propio para equipamiento/entrenamientos estructurados. La auditoría (Documentos 1-9) concluye que **la arquitectura y la calidad de código ya están en un nivel competitivo**; lo que falta para operar en producción real es cerrar un conjunto acotado y bien identificado de brechas de infraestructura, no rediseñar el sistema. *(Fuente: `RESUMEN_EJECUTIVO.md`, Documento 1 §1, Documento 9 §2.)*

## 2. Estado actual de RidePro

| Dimensión | Estado | Fuente |
|---|---|---|
| Arquitectura general | Clean Architecture por feature (Flutter) + monolito modular (NestJS), sin ciclos, con una desviación documentada y aceptada (acoplamiento de `presentation` entre 4 pares de features) | Documento 1 |
| Calidad de código | **B+** consolidado — sin duplicación significativa, sin clases "Dios", 9 dependencias muertas a limpiar | Documento 2 §3 |
| Seguridad | Sólida donde está implementada (JWT, Firestore rules, rate limiting, validación); el riesgo real es de infraestructura (entornos), no de código vulnerable | Documento 3 §11 |
| Rendimiento | No medido con herramientas reales; 1 fuga de memoria potencial confirmada por código (streams BLE) | Documento 4 |
| Escalabilidad | Diseño adecuado hasta ~100K usuarios sin cambios; el problema real es que **no hay ningún backend desplegado en ningún entorno** | Documento 5 §1 |
| Multiplataforma | Android/iOS/Web viables; Web tiene un crash confirmado (Wearables); Windows sin proyecto nativo | Documento 6 |
| Riesgos abiertos | 2 críticos, 2 altos, 10 medios, 10 bajos — ninguno es una vulnerabilidad explotable hoy por un tercero | Documento 7 |
| UX | Navegación y manejo de errores consistentes; accesibilidad mínima (solo 4 archivos usan `Semantics`) | Documento 9 §1 |

**Los 3 hechos que más condicionan este plan** *(Documento 9 §2, sin alterar)*:
1. El código es de buena calidad; el producto no está desplegado en ningún lado.
2. Hay dos backends y solo se decidió cuál usar para datos nuevos, no cómo conectarlos.
3. La arquitectura ya tomó las decisiones correctas para escalar el catálogo de features — el trabajo pendiente es de infraestructura y cierre de huecos, no de rediseño.

## 3. Arquitectura aprobada

La auditoría **no propone ningún rediseño**. Se aprueba y se congela como base de todo trabajo futuro:

- Clean Architecture por feature en Flutter (`lib/features/<nombre>/{data,domain,presentation}`), sin excepciones. *(Documento 1 §2)*
- Monolito modular en NestJS (`backend/src/modules/<dominio>`), sin ORM, con `pg.Pool` directo. *(Documento 1 §2.3, ADR-0001)*
- Dos fuentes de verdad separadas por diseño: Firestore (identidad/perfil/sesiones de la app principal) y PostgreSQL (Equipment/Workouts del backend propio) — **no se unifican en un solo motor de datos**, se conectan mediante un puente de autenticación (tarea A1/F1.5). *(Documento 1 §5)*
- Patrón Adapter para toda capacidad específica de proveedor o plataforma (wearables, BLE en Web) — es el molde a replicar para ANT+, Health en Web/Windows, y login social en Windows. *(Documento 1 §7, Documento 6 §5)*

### Qué NUNCA debe tocarse sin necesidad comprobada *(Documento 8 §4, sin alterar)*

- No migrar a microservicios.
- No introducir Redis/caché antes de que el rate limiter lo necesite (tarea M6/F0.4 es la primera excepción legítima).
- No adoptar el toolchain de generación de código muerto (`injectable`/`freezed`/`riverpod_generator`) — se elimina (B4/F2.5), no se activa.
- No forzar el desacoplamiento total de `presentation` entre features (M1) — ya resuelto a nivel de documentación, no de refactor de código.
- No construir Administración/Marketplace/Entrenadores antes de tener el núcleo de datos real sobre el que operar.

## 4. Riesgos abiertos (resumen — detalle y tareas ejecutables en `BACKLOG_MAESTRO.md`)

| Severidad | Cantidad | IDs | ¿Requiere autorización del propietario? |
|---|---|---|---|
| Crítico | 2 | C1, C2 | Ambos sí |
| Alto | 2 | A1, A2 | Solo A1 (priorización, no diseño) |
| Medio | 10 | M1-M10 | Solo M9 (reescritura de historial de git) |
| Bajo | 10 | B1-B10 | Solo B10 (nombre final de producto, `applicationId`) |

**Ningún riesgo de esta lista es una vulnerabilidad activamente explotable hoy por un tercero externo.** *(Documento 7 §5, sin alterar)*

## 5. Backlog priorizado

Ver `BACKLOG_MAESTRO.md` para la lista completa, deduplicada, con dependencias. Resumen de la estructura (idéntica a las fases de Documento 8, sin alterar):

- **Fase 0 — Desbloqueo** (5 tareas, sin dependencias entre sí, ejecutables en paralelo)
- **Fase 1 — Backend real en producción** (5 tareas)
- **Fase 2 — Cierre de deuda de calidad** (7 tareas)
- **Fase 3 — Plataforma lista para escalar** (4 tareas)
- **Fase 4 — Evolución de producto** (6 epics, orden técnico no de negocio)
- **Backlog transversal** — tareas de bajo costo sin fase asignada explícita en Documento 8 (M9, M10, B7, B8, B9, B10, verificaciones pendientes, accesibilidad) — insertadas en el orden que minimiza retrabajo (ver `BACKLOG_MAESTRO.md` §5).

## 6. Dependencias entre tareas (vista de alto nivel)

```
Fase 0 (paralelizable)
  F0.1 (A2: crash Web)  ──────────────────────────────────────────► sin dependientes
  F0.2 (C1: Firebase por entorno) ───► F1.1 (hosting) ───► F1.2 (CD)
                                                       └──► F1.3 (staging) ───► F1.5 (A1: puente auth) ─┐
  F0.3 (Docker Compose) ─────────────► F1.2 (CD)                                                        │
                     └──► F0.4 (M6: rate limiter→Redis) ─────────────────────► escalar backend a >1     │
                     └──► F0.5 (M7: paginación) ──────────────────────────────► preparar C2             │
                                                                                                          ▼
Fase 2 (mayoría sin dependencia entre sí, salvo:)                                          F2.2 (M3: tests contrato)
  F2.1 (M2) F2.3 (M5) F2.4 (M4) F2.5 (B4) F2.7 (B2) ── paralelizables ──┐                   F2.6 (B3: integration_test)
                                                                         └── ambos dependen de F1.5 (auth estable)

Fase 3 (requiere staging real, F1.3)
  F3.1 (profiling) F3.2 (carga real) ───► F3.3 (réplicas Postgres, si aplica)
  F3.4 (cola de trabajos) ───► requiere que Fase 4 (Estadísticas/Notificaciones) exista parcialmente

Fase 4 (orden técnico, no de negocio)
  Rutas reales ───► Estadísticas ───► Eventos/Clubes
  Notificaciones (independiente, bajo costo)
  Descargas (requiere Rutas)
  Marketplace/Creadores/Entrenadores/Gimnasios (requiere base de usuarios activa)
```

*(Fuente: Documento 7 §6, Documento 8 §2 — dependencias reorganizadas visualmente, sin alterar ninguna relación de dependencia ya establecida.)*

## 7. Orden exacto de ejecución

**Síntesis única, reconciliando Documento 7 §6 (orden de riesgos) y Documento 8 §2 (fases), sin contradicción entre ambos:**

1. **F0.1 (A2)** — crash Web. Más barato, sin ambigüedad, ejecutable ya, sin dependencias.
2. **F0.2 (C1)** — decisión del propietario sobre Firebase por entorno. No bloquea el resto del trabajo técnico mientras se decide, pero debe iniciarse ya porque tiene el mayor tiempo de espera (decisión + ejecución).
3. **F0.3, F0.4 (M6), F0.5 (M7)** — Docker Compose, rate limiter a Redis, paginación. Preparan el terreno técnico para desplegar el backend.
4. **F1.1-F1.4** — elegir hosting, CD, staging, extender CI. Depende de F0.2 (decisión) y F0.3.
5. **F1.5 (A1)** — puente de autenticación Firebase↔NestJS. El cambio más grande; se beneficia de tener staging (F1.3) resuelto para iterar con confianza.
6. **Fase 2 completa (F2.1-F2.7)** — cierre de deuda de calidad; F2.2 y F2.6 esperan a F1.5, el resto es paralelizable desde ya.
7. **Fase 3 (F3.1-F3.4)** — profiling, carga real, réplicas si aplica, cola de trabajos. Requiere staging (F1.3) y, para F3.4, avance parcial de Fase 4.
8. **Fase 4** — evolución de producto, en el orden técnico ya fijado (Rutas → Estadísticas → Eventos/Clubes; Notificaciones en paralelo; Descargas y Marketplace al final).
9. **Backlog transversal (M9, M10, B7-B10, verificaciones, accesibilidad)** — sin bloquear ninguna fase, ejecutable de forma oportunista según disponibilidad (detalle de cuándo insertar cada uno en `BACKLOG_MAESTRO.md` §5).

## 8. Criterios de aceptación (generales, aplican a toda tarea salvo que el backlog especifique uno más estricto)

- La corrección/feature no rompe ningún test existente: `flutter analyze --fatal-infos` sin issues, `flutter test` 100% verde, `npm run lint` + `npx tsc --noEmit` + `npm test` + `npm run test:e2e` 100% verde.
- Toda tarea que toque un endpoint o contrato de datos incluye al menos un test que cubra el caso nuevo.
- Ninguna tarea introduce una dependencia nueva sin justificar por qué el patrón manual/existente no alcanza (mismo criterio anti-sobreingeniería de toda la auditoría).
- Ninguna tarea marcada "Requiere autorización del propietario" se ejecuta sin esa autorización explícita y registrada.
- Toda tarea que cierre un riesgo de Documento 7 debe poder verificarse contra el "Cómo resolverlo" exacto descrito en ese documento — no una interpretación distinta.

## 9. Puertas de calidad (quality gates entre fases)

| Puerta | Condición para avanzar | Bloquea el avance a |
|---|---|---|
| **QG0** | F0.1-F0.5 cerradas (o F0.2 al menos con decisión tomada, aunque la ejecución de proyectos Firebase siga en curso) | Fase 1 |
| **QG1** | F1.1-F1.5 cerradas; suite completa de tests verde contra el entorno de staging real (no solo local/CI efímero) | Fase 2 (los ítems F2.2/F2.6 específicamente; el resto de Fase 2 no depende de esta puerta) |
| **QG2** | Fase 2 completa; 0 dependencias muertas; `integration_test/` con al menos los 2 flujos críticos (login→home, BLE simulado→HUD→resumen) | Fase 3 |
| **QG3** | Profiling y prueba de carga real ejecutados y documentados, con veredicto explícito (aprobado / requiere réplicas / requiere optimización) | Continuar Fase 4 más allá de los primeros 2 módulos (Rutas, Notificaciones) |
| **QG-Producto** | Cada epic de Fase 4 requiere decisión de negocio explícita del propietario antes de iniciarse (orden técnico ≠ autorización de prioridad) | Inicio de cada epic individual de Fase 4 |

## 10. Módulos terminados

*(Clasificación tomada de Documento 2 §1, sin alterar ninguna nota de calidad ni veredicto — "terminado" significa implementado y evaluado con nota A-/A/B+ sin bloqueo funcional externo, o bloqueado únicamente por A1/riesgo ya identificado, no por trabajo pendiente propio)*

| Módulo | Nota | Nota de cierre |
|---|---|---|
| Backend NestJS (Equipment/Workouts) | A- | Completo y probado (7 suites e2e); inalcanzable en producción real hasta cerrar A1 — no es deuda del módulo en sí |
| Firebase (Auth/Firestore, lo que se usa activamente) | A | Completo donde tiene consumidor de negocio |
| PostgreSQL | B+ | Esquema limpio; deuda menor de limpieza (M4, tabla sin uso) |
| Servicios (capa `services`/`repositories`) | A- | Sin acción pendiente |
| Entrenamientos (`features/training`) | A- | Completo; una pieza sin verificar (`checkForRecoverableSnapshot`, ver backlog transversal) |
| Sensores/Bluetooth (`device_connection`, `core/ble`) | A- | Completo; 1 fuga de memoria menor (B8) |
| Configuración (`core/config`, `features/settings`) | A- | Sin acción pendiente |
| Wearables (patrón Adapter) | Sin nota global (parcial: 2/6 proveedores reales) | Arquitectura terminada y lista para extender (base para ANT+/Garmin/Polar/Coros de Fase 4/futuro) |

## 11. Módulos pendientes

*(Documento 2 §1.18 y Documento 8 §3, sin alterar)*

**No existen todavía, evidencia negativa verificada:** Videos, ANT+, Mapas reales, Notificaciones (funcional), Actualizaciones forzadas, Eventos, Clubes, Estadísticas agregadas, Descargas offline, Creadores, Marketplace, Entrenadores/Gimnasios (como rol operable), IA, Panel de Administración.

**Parcialmente implementados, bloqueados por riesgos ya identificados (no por ausencia de diseño):**
- Autenticación / Usuarios — bloqueados por A1.
- Sincronización — solo Firestore; motor genérico para NestJS depende de M2 (idempotencia) como prerrequisito.
- Perfil — función de subir foto pendiente (dependencia declarada, Storage sin consumidor).

## 12. Decisiones que requieren aprobación del propietario

*(Consolidado de Documento 7, sin agregar ni quitar ninguna)*

| # | Decisión | Vinculada a | Por qué no se ejecuta sin autorización |
|---|---|---|---|
| 1 | Separar proyectos Firebase por entorno (dev/QA/staging/prod) | C1 / F0.2 | Costo real de infraestructura y facturación |
| 2 | Elegir plataforma de hosting del backend (Cloud Run/Render/VPS) | C2 / F1.1 | Decisión de negocio y presupuesto |
| 3 | Priorizar cuándo se ejecuta el puente de autenticación frente a otras features | A1 / F1.5 | Impacto en el roadmap de producto completo |
| 4 | Reescribir el historial de git para eliminar credenciales QA antiguas | M9 | Operación irreversible sobre cualquier clon existente del repositorio |
| 5 | Nombre final de producto / `applicationId` de Android | B10 | Decisión de marca, no técnica |
| 6 | Orden y prioridad de negocio de cada epic de Fase 4 (Rutas, Notificaciones, Estadísticas, Eventos, Descargas, Marketplace) | Fase 4 | El roadmap solo fija el orden técnico de dependencias, no cuál construir primero por valor de negocio |

## 13. Métricas de avance

*(Métricas de seguimiento de ejecución — no son hallazgos técnicos nuevos, son la forma de medir el progreso del backlog ya definido)*

| Métrica | Cómo se mide | Meta por puerta de calidad |
|---|---|---|
| % de riesgos Críticos/Altos cerrados | Tareas C1, C2, A1, A2 completadas / 4 | 100% antes de considerar el backend listo para usuarios reales |
| % de riesgos Medios cerrados | Tareas M1-M10 completadas / 10 | 100% antes de QG2 |
| % de riesgos Bajos cerrados | Tareas B1-B10 completadas / 10 | No bloqueante; se rastrea como higiene continua |
| Cobertura de pirámide de pruebas | `integration_test/` con ≥2 flujos críticos, tests de contrato activos | Cumplido en QG2 |
| Suite de CI en verde | 3 jobs actuales + lint/tsc backend + escaneo de secretos (F1.4/B6) | 100% en cada PR desde Fase 1 |
| Entornos reales activos | Firebase (dev/QA/staging/prod) + backend desplegado | 2/2 antes de QG1 |
| Dependencias muertas en `pubspec.yaml` | Conteo actual: 9 (B4) | 0 al cierre de Fase 2 |
| Cobertura de accesibilidad (`Semantics`/`semanticLabel`) | Conteo actual: 4 archivos (Documento 9 §1.4) | Auditoría dedicada completada antes de cualquier release público |

## 14. Definición de "Done" por módulo

**Definición de "Done" general (aplica a toda tarea salvo excepción explícita):**
1. Implementado según el "Cómo resolverlo" exacto del riesgo de origen (Documento 7) o la acción exacta del roadmap (Documento 8) — sin alcance añadido ni reducido.
2. Toda la suite de pruebas relevante (Flutter y/o backend según corresponda) en verde.
3. Sin nueva deuda técnica introducida sin documentar (si se introduce una, se agrega al backlog transversal, no se deja implícita).
4. Revisado contra los criterios de aceptación de la sección 8.
5. Si la tarea cierra un riesgo de Documento 7, el riesgo se marca como cerrado con referencia al commit/PR que lo resolvió — no se re-audita desde cero.

**Definición de "Done" específica por módulo/epic:**

| Módulo/Tarea | "Done" significa específicamente |
|---|---|
| A2 (crash Web) | Abrir Wearables en `flutter build web` no lanza excepción; stub condicional visible y probado |
| C1 (Firebase por entorno) | Al menos 2 proyectos Firebase reales (no-producción / producción) con `firebase_options.dart` por flavor |
| C2 (backend desplegado) | Backend accesible en una URL real, con CD funcionando, fuera de cualquier laptop de desarrollo |
| A1 (puente de auth) | Un usuario autenticado con Firebase (no la cuenta QA) puede usar Workouts/Equipment de punta a punta, con test e2e que lo pruebe |
| Cada epic de Fase 4 | Criterio de aceptación propio, definido cuando el propietario autorice su inicio (Documento 8 §2, "cada uno con su propio criterio, definido cuando se priorice") — este plan no inventa criterios de producto que la auditoría no definió |

---

## 15. Notas de alcance de este documento

Este plan **no introduce ningún riesgo, hallazgo, conclusión, prioridad o severidad que no estuviera ya en la Auditoría Arquitectónica Oficial v1.1**. Las métricas (sección 13) y las puertas de calidad (sección 9) son la única adición de naturaleza distinta a la auditoría original — son mecanismos de seguimiento de ejecución, no afirmaciones técnicas sobre el estado del código, y se derivan directamente de los criterios de aceptación ya expresados en cada documento fuente.

**Ver `BACKLOG_MAESTRO.md` para la ejecución tarea por tarea.**
