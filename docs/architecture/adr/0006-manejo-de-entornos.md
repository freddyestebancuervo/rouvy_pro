# ADR-0006: Manejo de entornos

- **Fecha:** 2026-07-24
- **Estado:** Aceptado el diseño; la creación de proyectos Firebase separados (el ítem de mayor impacto) **requiere autorización explícita del propietario** y no se ejecuta en este ADR.

## Contexto

Hoy no existe una matriz formal de entornos (hallazgo 1.16 #9 de `01_SYSTEM_ARCHITECTURE.md`). En la práctica:
- El backend distingue `NODE_ENV` solo para CORS (`cors.config.ts`, corregido esta sesión).
- Flutter distingue debug/release de forma robusta (`kDebugMode`, garantizado por el compilador) más flags opcionales vía `--dart-define-from-file`.
- **Un único proyecto Firebase real (`ridepro-dbafe`) sirve tanto para lo que sería desarrollo como para lo que sería producción.** No hay proyecto de staging ni de QA separado.

Este último punto es, según esta auditoría, el **riesgo de seguridad más crítico identificado** (sección 8 del documento de arquitectura): no es que un desarrollador pueda "apuntar a producción por accidente" — es que desarrollo y producción **ya son el mismo destino** por defecto.

## Decisión

1. **Cuatro entornos lógicos**: Desarrollo, QA, Staging, Producción — según la tabla de la sección 6 de `01_SYSTEM_ARCHITECTURE.md` (variables, Firebase, CORS, logs, datos de prueba, feature flags por entorno).
2. **Cada entorno con sus propias credenciales/base de datos**, nunca compartidas — ya es el caso para PostgreSQL (`DATABASE_URL` por entorno, trivial de separar, sin costo adicional) y **debería serlo para Firebase** (proyecto separado por entorno — con costo/tiempo de configuración real, de ahí que requiera decisión explícita del propietario, no una ejecución automática de este agente).
3. **`NODE_ENV`/`kDebugMode`/dart-defines siguen siendo los mecanismos de distinción técnica** dentro de cada entorno (ya implementados y verificados esta sesión) — esta decisión no los reemplaza, los complementa con la separación de infraestructura que falta (proyectos/bases de datos distintos, no solo flags).
4. **Ningún flujo de desarrollo debe requerir tocar credenciales de producción** — ya cierto para el backend (`.env` local, nunca compartido) y para las credenciales QA (corregido esta sesión, ver `docs/AUDITORIA_FINAL.md`); pendiente para Firebase mientras exista un solo proyecto.

## Alternativas descartadas

1. **Dejar un solo proyecto Firebase indefinidamente, confiando solo en las reglas de seguridad para separar datos de prueba de datos reales.** Descartada como diseño de largo plazo: las reglas de Firestore protegen **quién** puede leer/escribir, no **qué proyecto** es cada dato — no hay forma de "purgar solo los datos de QA" sin arriesgar tocar datos reales, porque literalmente comparten la misma base de datos.
2. **Crear los proyectos Firebase de entorno ahora mismo, sin autorización.** Descartada explícitamente por la instrucción del propietario ("no hagas git push, merge... si encuentras un problema crítico de seguridad, detente, documéntalo y solicita autorización antes de un cambio destructivo"). Crear infraestructura de Firebase nueva no es técnicamente destructivo, pero **tiene costo real** (proyectos Firebase en el plan de pago pueden facturar) y es una decisión de negocio, no solo técnica — se documenta y se detiene aquí.
3. **Usar un único proyecto Firebase con "namespacing" manual** (prefijos en los IDs de documento para distinguir datos de QA de datos reales). Descartada: es un parche fràgil (depende de que absolutamente todo el código respete el prefijo, sin ninguna garantía a nivel de plataforma) comparado con la separación real de proyectos, que sí la tiene.

## Consecuencias

- Mientras no se cree la separación de proyectos Firebase, **cualquier prueba manual contra el proyecto real deja datos de prueba mezclados con datos reales** — riesgo activo, no hipotético, documentado en la sección 8 como crítico.
- Los scripts de seed ya corregidos esta sesión (`firebase/seed/seed_emulator.js`) ya apuntan exclusivamente al emulador local, nunca al proyecto real — mitiga el riesgo para el flujo de seed específicamente, pero no para pruebas manuales ad hoc contra `ridepro-dbafe`.
- El backend ya tiene la separación de base de datos resuelta de forma trivial (`DATABASE_URL` distinta por entorno) — sirve de modelo de referencia de cómo debería verse la separación de Firebase una vez autorizada.

## Riesgos

- **Riesgo crítico, activo, ya documentado**: un solo proyecto Firebase para todo. Clasificado en la sección 8 del documento de arquitectura. Requiere decisión y presupuesto del propietario — **no se resuelve en esta tarea**.
- Si se crean los proyectos separados sin migrar primero los datos reales existentes del proyecto único actual, existe riesgo de fragmentar usuarios reales entre proyectos — cualquier ejecución futura de este ADR debe incluir un plan de migración de datos existentes, no solo la creación de proyectos nuevos.
