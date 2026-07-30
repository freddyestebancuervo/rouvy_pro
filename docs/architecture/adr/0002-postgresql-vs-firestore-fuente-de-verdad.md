# ADR-0002: PostgreSQL vs. Firestore como fuente de verdad

- **Fecha:** 2026-07-24
- **Estado:** Aceptado (formaliza una decisión ya tomada y parcialmente implementada)

## Contexto

El proyecto arrancó con Firebase (Auth + Firestore) como única capa de datos — decisión pragmática documentada en `docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 0 para llegar rápido a una demo funcional. A partir del Bloque D (Equipment, Workouts), el propio proyecto ya decidió explícitamente ("todo lo nuevo va directo a PostgreSQL/NestJS, no a Firestore", `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md` sección 0.1) construir sobre PostgreSQL en vez de seguir extendiendo Firestore. El resultado, verificado en esta auditoría (sección 1.5 de `01_SYSTEM_ARCHITECTURE.md`), es que **hoy conviven ambas** sin un plan de migración del contenido ya existente en Firestore.

## Decisión

1. **PostgreSQL es la fuente de verdad para todo dato nuevo** con necesidad de: integridad referencial real, consultas relacionales/agregadas (joins, agregaciones para Estadísticas), o portabilidad fuera del ecosistema Firebase.
2. **Firestore permanece como fuente de verdad únicamente para lo que ya tiene**: perfil de usuario (`users/{uid}`) e historial de sesiones (`users/{uid}/ride_sessions`) — **no se migra retroactivamente** sin una razón de negocio concreta (costo/riesgo de migrar datos de usuarios reales no se justifica solo por consistencia arquitectónica).
3. **Ninguna colección nueva se crea en Firestore** salvo que el caso de uso dependa específicamente de una capacidad que Firestore da "gratis" y PostgreSQL no (listeners en tiempo real de baja cardinalidad, ver `docs/TECHNICAL_SPECIFICATION_M0_M1.md` sección 6.2, opción B — p. ej. un dashboard de coach viendo un atleta en vivo).

## Alternativas descartadas

1. **Migrar todo a PostgreSQL de una vez** (incluyendo `users`/`ride_sessions` de Firestore). Descartada: es una reescritura de facto del sistema de autenticación y del historial de datos de usuarios reales — alto riesgo, sin beneficio inmediato medible, y explícitamente fuera del alcance de esta tarea ("no propongas reescribir todo el proyecto"). Además, Firestore ya resuelve offline-first "gratis" para estas dos colecciones (`docs/OFFLINE_FIRST.md`) — replicar esa garantía en un cliente REST contra PostgreSQL es trabajo no trivial (ver ADR-0004).
2. **Mantener todo en Firestore, incluyendo Equipment/Workouts**. Descartada antes de esta auditoría (decisión ya tomada en Bloque D): Firestore no tiene integridad referencial nativa (un `equipment_id` inválido en un documento no se puede rechazar a nivel de base de datos como sí lo hace una `FOREIGN KEY`), y las consultas relacionales que Estadísticas necesitará (agregados cruzando Workouts + Equipment + Rutas) son exactamente el punto débil de un modelo documental.
3. **Dos fuentes de verdad para el mismo dato** (p. ej. duplicar `ride_sessions` en ambos). Descartada explícitamente — es justo el patrón que esta auditoría detectó como riesgo ya presente por accidente (tabla `ride_sessions` en PostgreSQL, definida en `0001_init.sql`, sin ninguna fila escrita nunca — remanente del diseño original antes del pivote a Firestore para esta colección). Se documenta como deuda a limpiar (ver plan de transición), no como patrón a repetir.

## Consecuencias

- El cliente Flutter necesita hablar con **dos backends** para funcionalidad completa (Firebase SDK + Dio contra NestJS) — ya es el caso hoy (`lib/core/network/` vs. `lib/features/auth/data/datasources/` con Firebase).
- La tabla de "fuente de verdad por categoría de dato" (sección 5 de `01_SYSTEM_ARCHITECTURE.md`) se vuelve el documento de referencia obligatorio para decidir dónde vive un dato nuevo — cualquier módulo de la sección 3 que se implemente debe consultarla antes de crear una tabla o colección.
- Ver ADR-0003 para la consecuencia más directa de esta decisión: dos sistemas de autenticación independientes, sin puente todavía.

## Riesgos

- **Confusión de "dónde vive esto"** a medida que crecen los módulos, si la tabla de fuente de verdad no se mantiene actualizada con cada módulo nuevo. Mitigación: exigirla como parte del checklist de diseño de cualquier módulo nuevo (sección 3 del documento de arquitectura ya lo hace para los 19 módulos identificados).
- **La tabla `ride_sessions` de Postgres, sin uso, puede confundir a quien lea el esquema por primera vez** pensando que es la fuente de verdad activa. Mitigación de bajo riesgo: documentar (ya hecho en el hallazgo 1.16 #3) o eliminarla en una migración futura si se confirma que nunca se usará — decisión de limpieza, no urgente.
- **Costo de Firestore crece con el historial de sesiones a escala** — ya identificado como cuello de botella #3 en `docs/TECHNICAL_SPECIFICATION_M0_M1.md`, con mitigación propuesta (paginación + mover agregados históricos a PostgreSQL en M3) que es coherente con esta decisión, no la contradice.
