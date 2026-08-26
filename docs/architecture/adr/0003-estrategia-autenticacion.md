# ADR-0003: Estrategia de autenticación (dos sistemas, plan de convergencia)

> **Nota de reconciliación PR #7 (corte PR #95):** este ADR conserva el diagnóstico y la decisión arquitectónica tomada el 2026-07-24, pero su estado de ejecución quedó superado antes de que PR #7 fuera fusionado. PR #4 implementó el puente Firebase → NestJS mediante `POST /auth/firebase/exchange`, añadió `firebase_uid` con la migración `0005_users_firebase_uid.sql` y validación server-side con Firebase Admin; PR #5 endureció concurrencia/rate limiting del flujo. Por tanto, las frases históricas de abajo que dicen “no hay ningún mecanismo”, “queda pendiente” o “firebase_uid no existe” deben leerse como **estado previo a PR #4**, no como estado vigente. La decisión de convergencia se considera ejecutada en su núcleo desde PR #4.

- **Fecha:** 2026-07-24
- **Estado:** Aceptado el diagnóstico y el plan de convergencia; la ejecución del puente (T2 en el plan de transición) queda pendiente de priorización — este ADR no la implementa.

## Contexto

Es el hallazgo estructural más importante de esta auditoría (sección 1.5/1.16 #1 de `01_SYSTEM_ARCHITECTURE.md`). Existen hoy **dos sistemas de autenticación completamente independientes**:

1. **Firebase Auth** — usado por 8 de 10 features Flutter (todo excepto `workouts` y, a nivel de módulo backend, `equipment`). JWT de Google, gestionado por el SDK.
2. **NestJS/PostgreSQL** — JWT RS256 propio (`TokenService`), con `register`/`login`/`refresh` reales y rotación de refresh tokens con detección de reuso. Usado únicamente por `workouts` (y `equipment` a nivel backend, sin datasource Flutter todavía).

No hay ningún mecanismo hoy para que una sesión de Firebase Auth se traduzca en una sesión válida del backend NestJS. El acceso a Workouts en el cliente Flutter se resuelve, en `kDebugMode` únicamente, con una cuenta de prueba fija (`DevBackendTestUser`) que hace su propio `register`/`login` contra el backend — **no vinculada al usuario de Firebase real que está usando la app**.

## Decisión

1. **A corto plazo (ya implementado, sin cambios en este ADR):** mantener ambos sistemas separados, con el mecanismo de cuenta QA de debug como puente temporal explícito y documentado — nunca alcanzable en release builds (`kDebugMode` + `--dart-define-from-file` requerido, ver `docs/AUDITORIA_FINAL.md`).
2. **A mediano plazo (plan de convergencia, no ejecutado en este ADR):** implementar un **intercambio de token Firebase → backend** (`POST /auth/exchange` o similar, nuevo endpoint NestJS): el cliente envía el ID token de Firebase ya verificado, el backend lo revalida server-side contra los certificados públicos de Google (mismo patrón ya usado para OAuth social en la spec, sección 5.3), y si es válido, crea/vincula un usuario en `users` (Postgres) con el mismo `uid` de Firebase como identificador externo, emitiendo su propio JWT RS256 normalmente.
3. **Se descarta explícitamente** construir una pantalla de login nativa separada para el backend NestJS (pedirle al usuario que inicie sesión dos veces) — es peor experiencia de usuario que el intercambio de token, y el propio código ya señala esta alternativa como la preferida (`dev_backend_test_user.dart`, docblock: "reemplazar por la pantalla de login real... **o por una capa de intercambio Firebase → backend**").

## Alternativas descartadas

1. **Migrar todo el auth a NestJS, abandonar Firebase Auth.** Descartada: reescribe un sistema en producción (Firebase Auth ya gestiona usuarios reales) sin necesidad comprobada — mismo criterio de "no reescribir todo el proyecto" aplicado aquí.
2. **Migrar todo el auth a Firebase, hacer que NestJS confíe ciegamente en el ID token de Firebase sin revalidarlo server-side.** Descartada por seguridad: un backend nunca debe confiar en un token sin verificar su firma/emisor/audiencia server-side — es exactamente el tipo de atajo que la spec ya rechaza para OAuth social (sección 5.3) y debe aplicarse igual acá.
3. **Pantalla de login duplicada** (ver decisión, punto 3). Descartada por UX y porque ya hay una alternativa mejor identificada.
4. **Dejar el estado actual indefinidamente** (cuenta QA fija). Descartada como destino final — es una solución de desarrollo válida hoy, pero bloquea explícitamente exponer Workouts a usuarios reales, tal como el propio código lo documenta.

## Consecuencias

- El endpoint de intercambio necesita: verificación de firma del ID token de Firebase (librería `firebase-admin` en el backend, o verificación manual de JWKS de Google), una tabla/columna que vincule `users.id` (Postgres) con el `uid` de Firebase (hoy no existe — es un cambio de esquema aditivo, migración nueva), y decidir qué pasa con usuarios que ya se autoregistraron en Postgres solo con la cuenta QA (dato de desarrollo, no de producción — sin usuarios reales afectados hoy).
- Una vez implementado, `DevBackendTestUser`/`QaEmulatorConfig` dejan de ser necesarios para probar Workouts — pueden simplificarse o eliminarse (no antes, sería quitar la única forma de probar el flujo hoy).
- Los refresh tokens del backend seguirían su ciclo de vida propio (rotación, detección de reuso) — el intercambio solo resuelve la autenticación inicial, no reemplaza el modelo de sesión de NestJS ya implementado y auditado.

## Riesgos

- **Complejidad de mantener dos JWT verificándose por separado en el cliente** (uno de Firebase para el resto de la app, uno propio para llamadas a Workouts/Equipment) — mitigado por ya existir la separación limpia (`core/network/` vs. datasources de Firebase) que hace esto transparente para el resto del código.
- **Ventana de trabajo no trivial**: verificar JWKS de Google server-side, manejar expiración/renovación de ambos tokens en paralelo, y migrar el flujo de `BackendAuthService` actual son varias piezas de trabajo real — se marca **P0** en el plan de transición precisamente por su impacto, no porque sea trivial de ejecutar.
- **Ningún cambio de este ADR se ejecuta en esta tarea** — es una decisión documentada para guiar el trabajo futuro, consistente con la restricción explícita de no implementar módulos/flujos nuevos en esta auditoría.
