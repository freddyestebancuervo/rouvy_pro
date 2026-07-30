# RidePro — Documento Maestro de Arquitectura
## Documento 9 de 9: Recomendaciones Finales y Plan de Acción

- **Fecha:** 2026-07-24 · **Rama/HEAD:** `feature/d2` / `d3d01d8`
- **Alcance:** experiencia de usuario (eje pendiente de ubicar, Documento 1 §10) + síntesis final de los 8 documentos anteriores + plan de acción inmediato.
- **No se modifica código en este documento.**

---

## 1. Experiencia de usuario

### 1.1 Navegación

`go_router` declarativo, rutas centralizadas en `lib/app/router/app_router.dart` — **con guard de autenticación real** (`redirect:`, línea 91, verificado presente) que gatea acceso a rutas protegidas. Rutas anidadas correctamente donde corresponde (`routesCatalog/:routeId`, `workouts/new`, `workouts/:workoutId`) — jerarquía de navegación coherente con la jerarquía de datos.

### 1.2 Pantallas y flujos principales (inventario por rutas declaradas)

Onboarding → `splash` → `welcome` → `login`/`register` → `forgotPassword`/`emailVerification` → `home`. Desde `home`: `profile`, `devices`, `wearables`, `training` → `trainingSummary`, `rideHistory`, `statistics`, `achievements`, `routesCatalog`, `workouts`. **Flujo completo y sin pantallas huérfanas detectadas** en la lista de rutas registradas.

### 1.3 Estados de carga/error/vacío

**Consistente donde se usa:** `AsyncValueView` (widget compartido, `core/widgets/`) usado en al menos 5 páginas verificadas — encapsula loading/error/data en un solo punto, con `onRetry` (visto en `workout_form_page.dart:44`) en vez de dejar al usuario sin salida ante un error. **No se verificó exhaustivamente si las 10 features usan este widget de forma universal o si alguna implementa su propio manejo de loading/error ad hoc** — con 5 usos confirmados sobre un total no contado de páginas con estado asíncrono, esto queda como pendiente de verificación (sección 5).

### 1.4 Accesibilidad

**Hallazgo:** solo **4 archivos** en todo `lib/` usan `Semantics`/`semanticLabel` (`grep -rl "Semantics(\|semanticLabel" lib`). Para un proyecto de ~250 archivos Dart con 10 features de UI, esto es una cobertura de accesibilidad mínima — no se verificó si Flutter provee suficiente accesibilidad "gratis" por defecto (los widgets de Material ya exponen algo de semántica automáticamente) como para que esto sea aceptable, pero **no hay evidencia de un esfuerzo deliberado de accesibilidad** (sin `Semantics` custom en pantallas complejas como el HUD de entrenamiento, donde un usuario con lector de pantalla necesitaría anuncios de cambio de estado — fase/tiempo/telemetría — que van más allá de lo que Material provee por defecto).
- **Severidad:** Media — no bloquea el uso de la app, pero es una barrera real para usuarios con discapacidad visual, y una app que aspira a competir con ROUVY/Zwift/TrainerRoad a nivel internacional debería tratar esto como requisito, no como extra.
- **Recomendación:** auditoría de accesibilidad dedicada (fuera del alcance de esta auditoría arquitectónica) antes de cualquier release público, con foco inicial en el HUD de entrenamiento y los formularios de auth/registro.

### 1.5 Consistencia visual

No verificado en profundidad (requiere revisión de diseño, no solo de código) — se observa un tema centralizado (`app/theme/`) usado consistentemente en las páginas inspeccionadas, sin estilos inline dispersos en los archivos leídos durante esta auditoría. **No se ejecutó ninguna revisión visual real (capturas de pantalla, comparación entre plataformas)** — ver sección 5.

### 1.6 Animaciones y tiempo de carga percibido

No evaluado — requiere observación en ejecución (Documento 4 §8, mismo hueco de "no hay profiling real").

---

## 2. Síntesis final — los 3 hechos que más importan de toda la auditoría

1. **El código es de buena calidad; el producto no está desplegado en ningún lado.** La nota de calidad de código consolidada (Documento 2) es B+, con patrones consistentes y decisiones bien documentadas. El riesgo real de RidePro no es "el código está mal escrito" — es que no existe ningún entorno real (staging o producción) contra el cual validar que todo esto funciona end-to-end fuera de una laptop de desarrollo (C2, Documento 7).
2. **Hay dos backends y solo se decidió cuál usar para datos nuevos, no cómo conectarlos.** (A1) Es el hallazgo estructural que más se repite a lo largo de los 9 documentos porque condiciona seguridad, escalabilidad y roadmap de producto simultáneamente.
3. **La arquitectura ya tomó las decisiones correctas para escalar el catálogo de features** (Adapter para wearables/BLE, monolito modular con costura de extracción ya definida, dominio desacoplado de transporte) — el trabajo pendiente es mayormente de **infraestructura y cierre de huecos**, no de rediseño.

## 3. Recomendaciones finales (decisiones, no opciones abiertas)

1. **No empezar ningún módulo nuevo de producto (Fase 4 del Roadmap) hasta cerrar la Fase 0 y al menos F1.5 (puente de auth).** Justificación: cualquier módulo nuevo construido sobre el backend NestJS hereda el mismo problema de inalcanzabilidad que Workouts tiene hoy — es repetir el mismo error, no evitarlo.
2. **Corregir A2 (crash Web) de inmediato, en un commit aislado, sin esperar el resto del roadmap.** Es de costo S, sin ambigüedad de producto, y dejar un crash conocido sin corregir en una plataforma objetivo declarada no tiene ninguna ventaja de esperar.
3. **Llevar C1 (proyectos Firebase separados) a decisión del propietario esta semana, no como parte de un sprint futuro sin fecha.** Es el único riesgo Crítico que depende 100% de una decisión externa a este documento — cuanto antes se decida, antes deja de ser un riesgo activo.
4. **No adoptar el toolchain de generación de código (`injectable`/`freezed`/`riverpod_generator`) — eliminarlo.** Ya justificado en Documento 2/8: el patrón manual ya funciona, adoptar generación ahora sería un cambio de convención sin necesidad comprobada.
5. **Tratar accesibilidad como requisito de release, no como mejora posterior**, dado el posicionamiento competitivo declarado (competir con apps establecidas internacionalmente).

## 4. Plan de acción priorizado (consolidado, ejecutable)

| Orden | Acción | Costo | Bloquea |
|---|---|---|---|
| 1 | Corregir A2 (crash Web/Wearables) | S | Nada — ejecutable ya |
| 2 | Decisión del propietario sobre C1 (Firebase por entorno) | Decisión | F0.2, indirectamente todo lo demás de infraestructura |
| 3 | `docker-compose.yml` (F0.3) | S-M | F0.4, F1.2 |
| 4 | Rate limiter → Redis (F0.4) | M | Escalar el backend a >1 instancia |
| 5 | Paginación en `equipment`/`workouts` (F0.5) | S | Nada — ejecutable ya |
| 6 | Elegir hosting + CD (F1.1/F1.2) | Decisión + M | F1.3, F1.5 |
| 7 | Staging real (F1.3) | M | F1.5, F2.2, F3.2 |
| 8 | **Puente de autenticación Firebase↔NestJS (A1/F1.5)** | L | Exponer Workouts a usuarios reales |
| 9 | Resto de Fase 2 (idempotencia, tests de contrato, audit_log, limpieza) | M acumulado | Calidad continua, no bloquea negocio individualmente |
| 10 | Profiling real + prueba de carga (Fase 3) | M | Confianza de escalabilidad antes de crecimiento real de usuarios |
| 11 | Fase 4 (módulos de producto nuevos) | Variable, decisión de negocio | — |

## 5. No verificado — consolidado final de toda la auditoría

Se reúnen acá, sin repetir el detalle ya dado en cada documento, los huecos de verificación más relevantes para que quede una sola lista de referencia:

1. Alcance exacto de `checkForRecoverableSnapshot()` (Documento 2 §1.7).
2. Comportamiento en runtime bajo carga real (memoria durante sesiones largas, tiempo de arranque/login medido) — Documento 4 §8.
3. Si `forgetDevice()` limpia realmente `_DeviceSession` del mapa interno — Documento 4 §4.
4. `npm audit`/escaneo de CVEs de dependencias — Documento 3 §13.
5. Existencia real de la Cloud Function de borrado de cuenta mencionada en `firestore.rules` — Documento 3 §13.
6. Build real de Web y de Windows — Documento 6 §6.
7. Prueba de carga real contra un entorno desplegado — Documento 5 (no existe el entorno).
8. Cobertura universal de `AsyncValueView` en las 10 features — Documento 9 §1.3.
9. Auditoría de accesibilidad dedicada — Documento 9 §1.4.
10. Consistencia visual entre plataformas (capturas reales) — Documento 9 §1.5.

**Esta auditoría, en su conjunto (Documentos 1-9), no se declara "verificación exhaustiva línea por línea del 100% del código"** — es una revisión dirigida por evidencia y riesgo, con cobertura real y citada en cada hallazgo, y con esta lista de huecos declarada explícitamente en vez de omitida. Es la base correcta para decidir y priorizar; no reemplaza profiling, pentest activo ni pruebas de carga reales donde este documento indica que no se ejecutaron.

## 6. Criterios de aprobación de este documento

- [x] Experiencia de usuario cubierta: navegación, pantallas, flujos, estados de carga/error/vacío, accesibilidad, consistencia.
- [x] Síntesis final con los hallazgos de mayor impacto, no una repetición de los 8 documentos anteriores.
- [x] Recomendaciones como decisiones concretas, no como opciones abiertas sin resolver.
- [x] Plan de acción único, priorizado, con costo y dependencias.
- [x] Lista consolidada de todo lo no verificado en la auditoría completa.

**Fin de la serie de 9 documentos.** Ver `AUDITORIA_FINAL/` para el índice completo y el resumen ejecutivo consolidado.
