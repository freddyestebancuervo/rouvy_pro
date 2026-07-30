# Changelog

## [0.5.0] - 2026-07-30

### Added
- **Workouts**: nuevo módulo de entrenamientos estructurados (calentamiento,
  series con objetivo de potencia/frecuencia cardíaca, enfriamiento) —
  backend NestJS (migración `0004`) y feature completa en Flutter, con
  catálogo público y entrenamientos propios del usuario.
- **Firebase Auth Bridge**: intercambio de identidad Firebase por sesión de
  la API (`POST /auth/firebase/exchange`), alta o reutilización de usuarios
  por `firebase_uid`, verificación de tokens (firma, expiración, revocación)
  vía Firebase Admin SDK con Application Default Credentials (nunca JSON de
  cuenta de servicio).
- **Rate limiting híbrido** en `/auth/firebase/exchange`: capa por IP más
  capas por identidad, ajustadas sin debilitar la protección anti-abuso.
- Imagen Docker de producción para el backend: build multi-stage, usuario
  no-root, `HEALTHCHECK` contra `/v1/health`, sin código fuente TypeScript ni
  `devDependencies` en el runtime.
- Cliente de sesión de backend en Flutter (`backend_auth_service`,
  `backend_dio_client`) para consumir la API de RidePro desde la app.

### Fixed
- **Estabilidad de CI**: Flutter actualizado a 3.32.0 / Dart 3.8.0 (Dart 3.5
  no satisfacía el requisito de SDK de una dependencia existente),
  `firebase-tools` fijado a una versión compatible con Java 17.
- Migración de `RadioGroup` (widget no disponible en Flutter 3.32.0) al
  patrón clásico `groupValue`/`onChanged` en la pantalla de configuración.
- Corrección de aserciones de test afectadas por un cambio de comportamiento
  de `FilledButton.icon()` en Flutter 3.32.0 (ya no expone `FilledButton`
  como tipo exacto).
- **Self-deadlock del pool de PostgreSQL**: las colisiones concurrentes de
  alta de usuario ya no piden una segunda conexión del mismo pool mientras
  retienen la original — elimina los timeouts de conexión bajo carga
  concurrente real en el intercambio de tokens de Firebase.
- Clasificación correcta de saturación temporal del pool como `503
  DATABASE_TEMPORARILY_UNAVAILABLE` (con `Retry-After`) en vez de un error
  genérico.
- Corrección de un `ECONNRESET` determinístico en el arnés de pruebas e2e,
  causado por la ausencia de un `listen()` estable en el servidor de test.
- Job de CI del backend ahora provisiona `FIREBASE_PROJECT_ID` y
  `FIREBASE_CHECK_REVOKED`, necesarios para que el servidor arranque en
  las pruebas automatizadas.
- CI del backend ahora aplica todas las migraciones pendientes
  (`migrate:up`) en vez de solo la migración inicial, y provisiona claves
  JWT efímeras para el job.
- Reemplazo de CORS completamente abierto por un allowlist de orígenes
  controlado por entorno.
- Eliminación de credenciales QA hardcodeadas, ahora dirigidas por
  configuración de entorno.

### Changed
- Migración `0005`: nueva columna `firebase_uid` (nullable) e índice único
  parcial en `users`.
- Búsqueda de identidad de usuario unificada en una sola consulta
  parametrizada (antes dos `SELECT` secuenciales), cerrando además una
  ventana de carrera de correctitud.

### Infrastructure
- Integración de `feature/d2` en `main` mediante 5 bloques funcionales
  secuenciales (PRs #1–#5), cada uno validado de forma aislada (build,
  lint, tests unitarios, e2e, migraciones desde base limpia) antes de su
  propio merge commit tradicional, preservando los hashes originales de
  cada commit.
