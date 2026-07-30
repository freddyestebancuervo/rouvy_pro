# RidePro — Documento Maestro de Arquitectura
## Documento 7 de 9: Riesgos Técnicos

- **Fecha:** 2026-07-24 · **Rama/HEAD:** `feature/d2` / `d3d01d8`
- **Método:** consolidación de todos los hallazgos de los Documentos 1-6 y de `HALLAZGOS_CODIGO_Y_ARQUITECTURA.md` en una lista única, priorizada, sin duplicados — cada riesgo cita el documento fuente en vez de repetir la evidencia completa. Costos estimados en **esfuerzo relativo** (S/M/L/XL), no en horas exactas — no se ejecutó ninguna estimación formal de sprint/story points, se declara así explícitamente.
- **No se modifica código en este documento.**
- **Nota de nomenclatura (v1.1):** los identificadores `C1`/`C2` (Críticos), `A1`/`A2` (Altos), `M1`-`M10` (Medios) y `B1`-`B10` (Bajos) de este documento son propios de esta tabla consolidada, con alcance local a este documento. No deben confundirse con los identificadores `H1`-`H7` (Documento 2 / `HALLAZGOS_CODIGO_Y_ARQUITECTURA.md`), `S1`-`S8` (Documento 3), `R1`-`R5` (Documento 4) o `PLAT-1`-`PLAT-4` (Documento 6), que pertenecen a otros documentos y se citan explícitamente por su documento de origen cuando corresponde.

---

## 1. Críticos

### C1 — Un único proyecto Firebase para todos los entornos
- **Por qué existe:** el proyecto se creó (`ridepro-dbafe`) sin planificar separación dev/QA/staging/producción desde el inicio — decisión razonable cuando no había datos reales, riesgosa ahora que se acerca a tenerlos.
- **Impacto:** datos de prueba y datos reales conviven en el mismo proyecto; sin forma de purgar QA sin riesgo de tocar producción; cualquier bug de un flujo de prueba puede escribir sobre datos reales.
- **Cómo resolverlo:** crear proyectos Firebase separados por entorno (mínimo: uno de desarrollo/QA, uno de producción), migrar la configuración del cliente (`firebase_options.dart` ya soporta múltiples flavors vía `DefaultFirebaseOptions`) y del backend.
- **Costo:** **M** — no es complejidad técnica (es un procedimiento conocido de Firebase), es tiempo de configuración + decisión de negocio (nombres, facturación por proyecto adicional).
- **Requiere autorización del propietario:** sí — tiene costo real de infraestructura.
- **Fuente:** Documento 1 §6/§8, Documento 3 §10.

### C2 — No hay backend desplegado en ningún entorno real
- **Por qué existe:** el proyecto nunca llegó a la etapa de despliegue — todo el desarrollo y las pruebas e2e corren localmente o en CI efímero.
- **Impacto:** es, en la práctica, el bloqueador más grande de todo el documento de Escalabilidad — no importa cuánto se optimice el código si no hay dónde correrlo de forma reproducible y accesible.
- **Cómo resolverlo:** `docker-compose.yml` para desarrollo local (ya identificado en Documento 1 §6/§8) → elegir plataforma de hosting (Cloud Run/Render/VPS, decisión de negocio) → pipeline de CD.
- **Costo:** **L** — requiere decisiones de infraestructura fuera del alcance puramente técnico (elección de proveedor, presupuesto).
- **Requiere autorización del propietario:** sí — elección de proveedor y presupuesto.
- **Fuente:** Documento 1 §6/§8, Documento 5 §1.

---

## 2. Altos

### A1 — Dos sistemas de autenticación (Firebase / NestJS) sin puente real
- **Por qué existe:** Workouts/Equipment se construyeron como un backend nuevo (Bloque C/D) antes de resolver cómo se conecta con la identidad ya establecida en Firebase.
- **Impacto:** Workouts/Equipment son funcionalmente inalcanzables para un usuario real en producción — solo accesibles hoy vía una cuenta de prueba fija en modo debug.
- **Cómo resolverlo:** endpoint de intercambio Firebase ID token → JWT propio (verificado con Firebase Admin SDK del lado del backend) — ya definido como decisión en ADR-0003 (`docs/architecture/adr/0003-estrategia-autenticacion.md`) y como hallazgo H1 en `HALLAZGOS_CODIGO_Y_ARQUITECTURA.md`.
- **Costo:** **L** — toca autenticación, el área donde menos margen de error hay; requiere tests e2e nuevos y migración cuidadosa de cualquier usuario ya usando la cuenta QA.
- **Requiere autorización del propietario:** no para diseñar (ya diseñado); sí para priorizar cuándo se ejecuta frente a otras features.
- **Fuente:** Documento 1 §4.3/§8, Documento 2 §1.6, `HALLAZGOS...` H1.

### A2 — `HealthPlatformGatewayImpl` crashea en Flutter Web
- **Por qué existe:** se implementó el gateway de salud usando `dart:io`/`Platform.isX` sin replicar el patrón de adapter condicional ya usado para BLE en Web (`core/platform/web_bluetooth_support*.dart`).
- **Impacto:** el feature Wearables es inutilizable (crash) en la plataforma Web, una de las 4 plataformas objetivo declaradas.
- **Cómo resolverlo:** stub condicional (`kIsWeb`) que devuelva "no disponible en esta plataforma" en vez de dejar que `dart:io` lance la excepción — mismo patrón ya usado en la línea 92 de `injection.dart` para `google_sign_in`.
- **Costo:** **S** — 1-2 archivos nuevos + un cambio de una línea en el registro de DI.
- **Requiere autorización del propietario:** no — cambio aditivo, sin ambigüedad de producto, de bajo riesgo (mismo patrón ya validado en el proyecto).
- **Fuente:** Documento 6 §3 (hallazgo PLAT-1).

---

## 3. Medios

| # | Riesgo | Impacto resumido | Costo | Fuente |
|---|---|---|---|---|
| M1 | Acoplamiento cross-feature vía `presentation`/providers contradice la regla documentada (H2) | Mantenibilidad — un cambio en un provider puede romper 2-4 features sin aviso del compilador | **S** (ya corregido a nivel de documentación; refactor a facades sería **L**, no recomendado sin necesidad) | Documento 1 §4.2 (corregido), Documento 2 §2.5 |
| M2 | Sin idempotencia en endpoints de escritura NestJS (H3) | Reintentos de red pueden duplicar recursos | **S-M** | Documento 2, Documento 3 §11, Documento 5 §7 |
| M3 | Sin tests de contrato Flutter↔NestJS (H4) | Un cambio de DTO rompe el cliente en runtime, no en CI | **M** | Documento 2, Documento 1 §9 |
| M4 | `ride_sessions` duplicada sin uso en Postgres (H5) | Confusión de esquema para desarrolladores nuevos | **S** | Documento 2 §H5 |
| M5 | `audit_log` sin escritura real (H6) | Sin trazabilidad forense de acciones críticas | **S-M** | Documento 2, Documento 3 §11 |
| M6 | Rate limiter en memoria — se diluye con >1 instancia de backend | Bloquea escalar horizontalmente el backend con seguridad | **M** (requiere Redis) | Documento 3 §6, Documento 5 §3 |
| M7 | Endpoints `equipment`/`workouts` sin paginación real | Respuestas sin límite de tamaño a mayor volumen de datos por usuario | **S** | Documento 5 §2 |
| M8 | Firebase en Windows usa config de Web como placeholder, sin probar | Riesgo de que Auth/Firestore no funcionen igual en un futuro build Windows | **S** (solo verificar, una vez exista el proyecto) | Documento 6 §4 |
| M9 | Credenciales QA viejas en historial de git (anteriores a 2026-07-23) | Exposición histórica, ya no vigente pero recuperable del historial | **M** (reescritura de historial, alto cuidado operacional) | Documento 3 §8 |
| M10 | Sin matriz formal de entornos (dev/QA/staging/prod) | Condiciona directamente C1 y el resto de la gestión de riesgo operacional | **M** | Documento 1 §6 |

## 4. Bajos

| # | Riesgo | Costo | Fuente |
|---|---|---|---|
| B1 | Sin Docker Compose para desarrollo reproducible | **S-M** | Documento 1 §6/§8 |
| B2 | Windows sin proyecto nativo generado | **S** (`flutter create`) + **M** si aparecen problemas de plugins (Documento 6) | Documento 1 §6, Documento 6 §1 |
| B3 | `integration_test/` sin ningún archivo | **M** | Documento 1 §6/§8 |
| B4 | 9 dependencias de generación de código declaradas sin uso (`logger`, `injectable`, `freezed`, `json_serializable`, `riverpod_generator` y sus paquetes asociados) | **S** (eliminar) | Documento 2 §2.6 |
| B5 | `CI_CD_GUIDE.md` desactualizado | **S** | Documentación previa del proyecto (fuera de esta serie) |
| B6 | Sin escaneo de secretos ni bloque `permissions:` explícito en CI | **S** cada uno | Documento 3 §9 |
| B7 | `BleDataSourceImpl` concentra responsabilidades en un archivo (H7) — sin impacto real hoy | **M** si se decide dividir (no urgente) | Documento 2 §H7 |
| B8 | `telemetryController` en `_DeviceSession` nunca se cierra (R1) | **S** | Documento 4 §4 |
| B9 | Caché de Firestore sin límite de tamaño (`CACHE_SIZE_UNLIMITED`) | **S** (agregar límite) — a vigilar, no urgente | Documento 4 §1 |
| B10 | `applicationId`/`package_name` Android en placeholder | **S** técnico, depende de decisión de producto (nombre final) | Documentación previa del proyecto (fuera de esta serie) |

---

## 5. Matriz consolidada (vista rápida)

```
CRÍTICO  ██  C1 (Firebase único)         C2 (sin backend desplegado)
ALTO     ██  A1 (auth dual)              A2 (crash Web/Wearables)
MEDIO    ██████████  M1..M10 (10 hallazgos — ver tabla §3)
BAJO     ██████████  B1..B10 (10 hallazgos — ver tabla §4)
```

**Ningún riesgo de esta lista es una vulnerabilidad activamente explotable hoy por un tercero externo** (reconfirmado, consistente con Documento 3 §11) — los dos críticos son de infraestructura/negocio (requieren decisión y presupuesto del propietario), no de código inseguro.

## 6. Orden de corrección recomendado (síntesis, detalle completo en Documento 8)

1. **A2** (crash Web) — más barato de los altos, sin ambigüedad, corregible ya.
2. **C1** (decisión del propietario, no bloquea el resto del trabajo técnico mientras se decide).
3. **M6, M7** (rate limiter + paginación) — preparan el terreno para C2.
4. **C2** (backend desplegado) — una vez resuelto M6.
5. **A1** (puente de auth) — el cambio más grande, se beneficia de tener C2 resuelto para iterar con confianza contra un entorno real.
6. Resto de Medios/Bajos — paralelizables, sin dependencias fuertes entre sí (ver Documento 8 para el orden detallado con dependencias explícitas).

---

## 7. Criterios de aprobación de este documento

- [x] Todos los hallazgos de los Documentos 1-6 consolidados, sin duplicados.
- [x] Clasificación en 4 niveles (Crítico/Alto/Medio/Bajo) como se pidió.
- [x] Cada riesgo con: por qué existe, impacto, cómo resolverlo, costo estimado.
- [x] Se distingue qué requiere autorización explícita del propietario (C1, C2, M9) de lo que no.
- [x] Ningún riesgo reportado sin cita a su documento fuente (trazabilidad completa).

**Siguiente documento:** Documento 8 — Roadmap Arquitectónico.
