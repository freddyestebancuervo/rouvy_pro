# Roadmap de desarrollo — M0/M1 a nivel de producción

**Estado actual:** A1, A2, Bloque B completo (B1-B3), y C1-C2 implementados.
**A3 y C2 comparten el mismo bloqueo:** ambos están escritos y revisados
por inspección, pero **no ejecutados** — sin red en este entorno de
trabajo para `npm install`/Firebase CLI/Postgres. **C3 detenido
explícitamente hasta verificar ambos** — ver `VERIFICATION_GUIDE.md` para
los comandos exactos, resultado esperado, y qué enviar de vuelta.

Basado en `docs/TECHNICAL_SPECIFICATION_M0_M1.md`. Cada tarea es lo
bastante pequeña para completarse en una sesión de trabajo concreta, en
el orden en que deben abordarse (las posteriores asumen que las
anteriores ya están hechas).

## Bloque A — Endurecer lo que ya existe (sin tocar arquitectura)

- [x] **A1. Habilitar persistencia offline de Firestore** ✅ Implementado.
  Una línea en `main.dart` (`FirebaseFirestore.instance.settings = ...`,
  ver spec sección 7.1). Resuelve el cuello de botella #1. Se amplió con
  un servicio de estado de sincronización observable
  (`core/sync/FirestoreSyncService`) y un banner global
  (`ConnectivitySyncBanner`) — comportamiento completo documentado en
  `docs/OFFLINE_FIRST.md`, incluyendo el protocolo de verificación manual
  y la cobertura de tests automatizados.

- [x] **A2. Añadir el campo `role` a `users/{uid}`** ✅ Implementado.
  `UserRole` enum (`user`/`premium`/`coach`/`admin`) añadido a
  `UserEntity`. `UserModel.fromMap` lee `role` con fallback seguro a
  `user` para documentos previos a esta tarea; `UserModel.toMap` NUNCA
  incluye `role` — es de solo lectura desde el cliente por diseño (doble
  protección: el cliente no lo escribe Y las reglas de Firestore lo
  bloquearían igual, ver A3). Script de backfill idempotente en
  `firebase/scripts/backfill_user_roles.js`, pendiente de ejecutarse
  contra el proyecto de Firebase real (requiere credenciales que no
  existen en este entorno).

- [ ] **A3. Desplegar `firestore.rules` versionado** 🟡 Implementado,
  **PENDIENTE DE VERIFICACIÓN** — no marcar como hecho hasta correr los
  tests.
  Se encontró y corrigió una vulnerabilidad crítica de escalada de
  privilegios (la regla de `create` no validaba contenido) — ver
  `docs/SECURITY_AUDIT.md` para el análisis completo. Archivo real en
  `firestore.rules` (raíz), tests de seguridad en
  `firebase/rules-tests/`. **Bloqueante:** estos tests no se han podido
  ejecutar en este entorno de trabajo (sin red/Firebase CLI). Antes de
  desplegar con `firebase deploy --only firestore:rules` O de continuar
  con A4/A5, es obligatorio correr `cd firebase/rules-tests && npm
  install && npm test` en un entorno real y confirmar que todos pasan.
  **← BLOQUEADO hasta esa verificación. No avanzar a A4 sin ella.**

- [x] **A4. Declarar `firestore.indexes.json`** ✅ Implementado (ya existía,
  el checkbox no se había actualizado — corregido ahora).
  `firestore.indexes.json` en la raíz, versiona el índice de
  `ride_sessions.startTime`. No requiere verificación de ejecución
  separada — es un archivo de configuración declarativo, Firestore lo
  aplica al desplegar (`firebase deploy --only firestore:indexes`), no
  hay "test" que correr para un índice en sí.

- [ ] **A5. Tests de reglas de seguridad** 🟡 Implementado (mismo archivo
  que A3 — `firebase/rules-tests/firestore.rules.test.js` ya cubre
  exactamente lo que A5 pedía: lectura cruzada entre usuarios,
  `role`/`premium` protegidos, escritura de perfil propio permitida).
  **Comparte el mismo bloqueo que A3** — no es una verificación aparte,
  es la misma suite.

## Bloque B — Cerrar huecos funcionales de M1 ya identificados

- [x] **B1. Snapshot de sesión activa en `shared_preferences`** ✅ Implementado.
  `RideSessionSnapshotLocalDataSource` guarda un snapshot cada 10s
  mientras la sesión está activa (`elapsedSeconds`, distancia, calorías,
  nº de dispositivos). `TrainingHudPage` comprueba al entrar si hay uno
  recuperable (más reciente que 3h) y ofrece un diálogo
  "Descartar"/"Continuar sesión" en vez de perderla en silencio.
  `TelemetryAggregator.seed()` (aditivo, no rompe sus tests existentes)
  permite continuar acumulando distancia/calorías desde el valor
  recuperado. Tests: datasource (persistencia/expiración) + controlador
  (`resumeFromSnapshot`, limpieza al finalizar).

- [x] **B2. Límite de tiempo total de reintento BLE** ✅ Implementado.
  `_DeviceSession.firstDisconnectAt` + `_maxTotalReconnectDuration` (10
  min) en `ble_datasource.dart` — además del límite de 6 intentos ya
  existente, ahora también se detiene si el ciclo de reconexión lleva
  más de 10 minutos corriendo, independientemente de cuántos intentos
  haya consumido el backoff. **Sin test automatizado dedicado** — mismo
  motivo que el resto de `BleDataSourceImpl` (depende de
  `flutter_blue_plus`/plataforma real, no mockeable sin refactorizar a
  inyectar un reloj; limitación preexistente del módulo, no nueva de
  esta tarea).

- [x] **B3. Mensaje contextual tras fallos repetidos de HealthKit** ✅ Implementado.
  `HealthPackageAdapter` cuenta fetches vacíos consecutivos;
  `emptyFetchesHintMessage` sugiere revisar Ajustes tras 3 seguidos,
  **solo** para Apple Health en iOS (Health Connect en Android confirma
  el permiso de forma fiable, no hay ambigüedad que aclarar).
  `WearableConnection.advisoryMessage` (campo nuevo, informativo — nunca
  de error) lo expone hasta `WearableProviderTile`. El chequeo de
  plataforma se hizo inyectable (`isIOS: () => ...`) para que fuera
  realmente testeable — `Platform.isIOS` de `dart:io` nunca es `true` al
  correr `flutter test` en un host normal, así que sin esa inyección el
  caso "estamos en iOS" habría sido imposible de probar (se detectó al
  escribir el propio test).

## Bloque C — Preparar el terreno para el backend NestJS objetivo

*No implica escribir el backend todavía — solo dejar el contrato ya
codificado del lado cliente para que la migración futura sea un cambio de
datasource, no una reescritura de features.*

- [x] **C1. Extraer una interfaz `AuthApiContract` documentada en código** ✅ Implementado.
  Dartdoc en `AuthRepository` con la tabla completa método → endpoint
  REST objetivo, enlazando a la sección 1.2 de la spec.

- [x] **C2. Scaffold del backend (`backend/` en el monorepo)** ✅ Implementado,
  **NO EJECUTADO** (mismo motivo que A3: sin red para `npm install`, sin
  Postgres disponible en este entorno — ver `backend/README.md`).
  NestJS + `pg.Pool` directo (sin ORM, decisión deliberada — ver el
  README), `AuthModule`/`UsersModule` vacíos, `GET /v1/health` real
  (falla de verdad si Postgres no responde, no un mock), migración
  `0001_init.sql` idéntica al DDL de la spec, test e2e del health check.
  **Antes de construir C3 sobre esto, correr `npm install && npm run
  test:e2e` en un entorno con red + Postgres y confirmar que pasa** —
  mismo principio que con A3: no se asume que compila solo porque el
  balance de llaves es correcto.

- [ ] **C3. Implementar `POST /auth/register` y `POST /auth/login`**
  Los dos endpoints de mayor prioridad, siguiendo el contrato exacto de
  la sección 1.2 (incluyendo el sobre de error estándar).

- [ ] **C4. Implementar rotación de refresh tokens**
  Sección 5.2 completa, incluyendo detección de reuso — es la pieza de
  seguridad más fácil de hacer mal si se implementa apurado, por eso va
  en su propia tarea con tests dedicados.

## Bloque D — Panel de administración (dependiente de C)

- [ ] **D1. Endpoint `GET /admin/users`** con paginación y filtro por rol
      — primer endpoint que justifica tener el backend NestJS corriendo
      en producción en paralelo a Firebase.

---

## Cómo usar este roadmap

Cada tarea, al completarse, debe:
1. Marcarse como hecha en este archivo (editar el checkbox).
2. Si cambia algo del contrato documentado en
   `docs/TECHNICAL_SPECIFICATION_M0_M1.md`, actualizar esa sección en el
   mismo commit — la spec y el código no deben divergir.

El Bloque A es puramente aditivo y de bajo riesgo (no cambia contratos
existentes) — es el punto de entrada recomendado antes de tocar nada del
Bloque C, que sí implica una pieza de infraestructura nueva.
