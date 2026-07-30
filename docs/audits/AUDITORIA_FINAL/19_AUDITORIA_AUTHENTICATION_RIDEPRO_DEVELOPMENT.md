# RidePro — Documento 19: Auditoría Técnica Independiente — Authentication
## Fase 1 de la Parte B — `ridepro-development` — Nivel pre-producción

- **Fecha:** 2026-07-25
- **Rol:** Lead Software Engineer / Software Architect / Firebase Specialist / QA Lead / Security Engineer / Auditor Técnico independiente
- **Alcance:** auditoría de solo lectura del módulo Authentication (código, integración con Firestore, seguridad, rendimiento, arquitectura, compatibilidad futura). **Cero archivos modificados, cero comandos de escritura ejecutados** contra Firebase o el repositorio, salvo la creación de este documento.
- **Nota sobre continuidad:** no existe ningún trabajo previo real de esta auditoría específica en el historial de esta sesión — se ejecuta completa, de una sola vez, en esta tarea. Ningún hallazgo fue inventado ni se asumió ningún resultado sin verificarlo.

---

## Resumen Ejecutivo

Authentication (Email/Password + Google, según confirmaste habilitados; Apple habilitado en Firebase pero sin configuración externa de Apple Developer) está respaldado por un módulo de cliente **bien arquitecturado, sin deuda estructural nueva, con 17/17 pruebas automatizadas en verde y `flutter analyze` limpio**. La auditoría encontró **un hallazgo real de severidad Media** (el Web Client ID de Google está hardcodeado al de producción, no al de `ridepro-development`) que bloqueará — no comprometerá la seguridad de — las pruebas de Google Sign-In en Web hasta corregirse, y **reconfirma con evidencia de código** dos gaps ya conocidos (eliminación de cuenta no implementada; sin test de integración contra el emulador de Auth). Ningún hallazgo crítico o alto. **Veredicto: Aprobado con observaciones.**

---

## FASE 1 — Auditoría del Código

### Arquitectura de capas — Clean Architecture verificada

| Capa | Archivo | Verificación |
|---|---|---|
| Domain (contrato) | `lib/features/auth/domain/repositories/auth_repository.dart:1-4` | Solo importa `dartz`, `failures.dart`, `user_entity.dart` — **cero dependencia de Firebase**, confirmado leyendo el archivo completo |
| Domain (entidad) | `lib/features/auth/domain/entities/user_entity.dart:1` | Solo importa `equatable` — sin `firebase_auth`, sin `cloud_firestore` |
| Data (implementación del contrato) | `lib/features/auth/data/repositories/auth_repository_impl.dart:18-122` | Único punto que conecta `domain` con `data`, patrón `_guard`/`_tryCatch` consistente en los 10 métodos |
| Data (único punto de contacto con SDKs externos) | `lib/features/auth/data/datasources/auth_remote_datasource.dart:1-8,14-17` | Confirmado por su propio docblock: *"Única capa autorizada a llamar directamente a los SDKs de Firebase, Google Sign-In y Sign in with Apple"* — verificado cierto: es el único archivo de todo `lib/features/auth/` que importa `firebase_auth`, `google_sign_in` o `sign_in_with_apple` |
| DI | `lib/core/di/injection.dart:83,86-94,141-146` | `FirebaseAuth`, `GoogleSignIn`, `AuthRemoteDataSource`, `AuthRepository` registrados como lazy singletons, wiring completo y correcto |

### Consistencia de versiones (posible fuente de bugs no evidente sin verificar)

`pubspec.yaml:27,35,36`: `firebase_auth: ^5.1.0`, `google_sign_in: ^6.2.1`, `sign_in_with_apple: ^6.1.1`. El código usa `_googleSignIn.signIn()` (`auth_remote_datasource.dart:121`) — API de la **v6** de `google_sign_in`. Confirmado que el rango `^6.2.1` (caret) **no permite** un salto a v7 (que eliminó `signIn()` en favor de `authenticate()`), por lo tanto **no hay riesgo de mismatch de API por actualización automática de dependencias**. Verificado también en `pubspec.lock` — sin necesidad de revisar más.

### 🟡 Hallazgo — Web Client ID de Google hardcodeado a Producción

`lib/core/config/social_login_config.dart:16-17`:
```dart
static const String googleWebClientId =
    '731660820861-3jkse9cbmat7bl4nk9ig9qj2728cv2r9.apps.googleusercontent.com';
```

El prefijo `731660820861` es el **Project Number de `ridepro-dbafe`** (Producción, confirmado contra `lib/firebase_options.dart` y `firebase.json`), no de `ridepro-development` (Project Number `1020003121433`, confirmado en el cierre de la Fase 1 de esta misma Parte B). Este valor se usa en `injection.dart:92` (`clientId: kIsWeb ? SocialLoginConfig.googleWebClientId : null`) — es decir, **cualquier build Web que apunte a `ridepro-development` seguiría usando el client ID OAuth de producción** para Google Sign-In.

**Impacto real:** Firebase Auth valida que el client ID de la credencial OAuth pertenezca al proyecto Firebase contra el que se llama `signInWithCredential` — un client ID de `ridepro-dbafe` usado contra `ridepro-development` sería rechazado por Firebase (no es una vulnerabilidad de seguridad: Firebase lo bloquea activamente), pero **el login de Google en Web fallará** hasta corregirse. No es un hallazgo nuevo de diseño (el propio archivo ya documenta, en su comentario, que este valor debe reemplazarse por entorno — `social_login_config.dart:6-11`) — es la confirmación, con evidencia real, de que ese reemplazo **todavía no se hizo** para Development.

**Por qué no bloquea hoy:** Android/iOS no leen este valor (se resuelve nativamente vía `google-services.json`/`GoogleService-Info.plist`, ninguno de los cuales existe todavía para Development — Fases 2-3 de `16_...md`, no ejecutadas). Web tampoco tiene su app registrada en `ridepro-development` todavía. Es decir, **este hallazgo no es explotable ni probable hoy porque no hay ningún build real de Development en ninguna plataforma** — pero debe corregirse antes de que exista uno, para no descubrirlo como un fallo confuso en ese momento.

### Referencias a proveedores no autorizados

Grep exhaustivo (repetido en esta tarea, ya ejecutado también en la auditoría de decisión de proveedores) sobre `lib/` y `backend/`: `PhoneAuthProvider`, `signInAnonymously`, `Facebook`, `Twitter`, `Github`, `Microsoft`, `signInWithCustomToken`, `MultiFactor`, `sendSignInLinkToEmail` — **cero coincidencias**. Confirmado: el código solo puede producir tráfico de autenticación hacia Email/Password, Google y Apple — ningún otro proveedor tiene ni una línea de código que lo invoque, por lo que no hay riesgo de que un proveedor no habilitado en Firebase reciba una llamada real desde el cliente.

### Rutas muertas, llamadas obsoletas, imports innecesarios

`flutter analyze --fatal-infos` (re-ejecutado en esta tarea) → **"No issues found!"** — este comando ya detecta imports sin usar y código inalcanzable a nivel de lint; no se encontró ninguno en el módulo de auth ni en el resto del proyecto.

### Ausencia confirmada — Eliminación de cuenta

Reconfirmado con evidencia de código (ya señalado en la auditoría previa a habilitar Auth, repetido aquí porque el alcance de esta tarea lo exige explícitamente): `AuthRepository`/`AuthRemoteDataSource` no tienen ningún método `deleteAccount`. `firestore.rules:59-61` referencia una Cloud Function que no existe (`functions/` ausente). Es deuda técnica ya registrada (`T-TRANS.7`), no un hallazgo nuevo.

### Backend (`backend/src/`)

Reconfirmado (sin cambios desde la última verificación): cero referencias a `firebase`/`firebase-admin` en todo `backend/src` y `backend/package.json`. El módulo `backend/src/modules/auth/` es el sistema JWT propio del backend NestJS, completamente independiente — mismo hallazgo `A1` ya documentado, sin relación con el Authentication de Firebase auditado aquí.

---

## FASE 2 — Pruebas Funcionales (validación por evidencia de código, no por ejecución en un build real — ver Fase 9 para lo que sí se ejecutó)

### Email/Password

| Paso | Estado | Evidencia |
|---|---|---|
| Creación de usuario | ✅ Código correcto | `auth_remote_datasource.dart:85-113` — `createUserWithEmailAndPassword` + `updateDisplayName` + `sendEmailVerification` + creación de `users/{uid}` |
| Login | ✅ Código correcto | `:70-82` |
| Logout | ✅ Código correcto | `:187-193` — cierra Firebase y Google Sign-In en paralelo |
| Persistencia | ✅ Correcta por diseño del SDK | Sin código custom necesario (correcto que no exista) |
| Recuperación de contraseña | ✅ Código correcto | `:214-217` |
| Verificación de email | ✅ Código correcto | `:223-228`, más `reloadCurrentUser` (`:230-240`) para detectar la confirmación |
| Creación de `users/{uid}` | ✅ Código correcto | `:102-112` (registro), `:289-312` (`_fetchUserDocument`, crea el documento con valores por defecto si no existe — cubre también logins previos a esta lógica) |

**Pendiente, no por código sino por infraestructura:** ninguna app está registrada en `ridepro-development` todavía (Fases 2-3 de `16_...md`) — por lo tanto no existe ningún build real contra el cual ejecutar este flujo de punta a punta hoy. El código está listo; el entorno todavía no.

### Google

Código completo y correcto (`:119-140`), con el mismo patrón de creación/lectura de `users/{uid}` que Email/Password (`_fetchOrCreateSocialUser`, `:316-340`, con `emailVerified: true` automático — correcto, los proveedores sociales certifican el correo). **Bloqueado para pruebas reales en Web por el hallazgo de la Fase 1** (Web Client ID de producción); en Android/iOS, bloqueado porque las apps de Development aún no están registradas (mismo bloqueo que Email/Password, más el registro de huellas SHA-1/SHA-256 para Android específicamente).

### Apple

Código completo y correcto: nonce aleatorio de 32 caracteres + hash SHA-256 (`:146-147`, mitigación correcta contra replay attacks, tal como exige Apple), captura del nombre completo solo en el primer login (`:168-178`, correcto — Apple no lo reenvía después). **Depende enteramente de la configuración externa de Apple Developer** (Team ID, Service ID, Key, Return URL, dominio verificado) documentada en `18_MICROPLAN_APPLE_SIGNIN.md` — **nada de eso se ha ejecutado todavía**. Confirmo explícitamente lo que pediste:
- **Qué ya funciona:** el código en sí — compilaría y se ejecutaría si el resto de la cadena estuviera lista.
- **Qué depende de Apple Developer:** absolutamente todo el flujo real (sin Service ID/Key configurados en Firebase, la llamada a `SignInWithApple.getAppleIDCredential` puede iniciarse desde el cliente, pero Firebase rechazaría el intercambio de credencial en el servidor).
- **Qué falta para producción:** ejecutar el Documento 18 completo, más el registro de la app iOS con la capacidad Xcode correspondiente.

---

## FASE 3 — Firestore

`isOwner(uid)` (`firestore.rules:20-22`) depende de `request.auth != null && request.auth.uid == uid`. Con Authentication ahora habilitado en `ridepro-development`, `request.auth` se puebla correctamente para cualquier usuario autenticado por cualquiera de los 3 proveedores — el `uid` de Firebase Auth es el mismo sin importar el proveedor usado para autenticarse (Firebase unifica la identidad bajo un solo `uid` por cuenta). **Sin cambios necesarios en `firestore.rules`** — el diseño ya anticipaba esto correctamente, confirmado ahora con Authentication real habilitado, no solo en teoría.

---

## FASE 4 — Seguridad (clasificación por severidad)

| # | Hallazgo | Severidad | Nota |
|---|---|---|---|
| 1 | Web Client ID de Google hardcodeado a producción (Fase 1) | **Medio** | Riesgo de bloqueo funcional, no de exposición de datos — Firebase rechaza activamente el cruce. Corregir antes de la Fase 2 de `16_...md` |
| 2 | Ausencia de eliminación de cuenta | **Bajo** | Riesgo de cumplimiento (GDPR-like) a futuro, no de seguridad activa hoy — ya registrado como deuda |
| 3 | Sin MFA | **Bajo, no bloqueante** | No solicitado para el MVP; RidePro no maneja datos financieros directos — evaluar como mejora futura, no como brecha |
| — | Protección de `role`/`permissions`/`isAdmin`/`customClaims` | **Fortaleza, no riesgo** | Doble capa: el cliente nunca los envía (`user_model.dart:70-79`) **y** `firestore.rules` los bloquea igual aunque el cliente lo intentara (`:94-98`) — defensa en profundidad correctamente implementada |
| — | Credenciales/secretos expuestos | **Ninguno encontrado** | Sin API keys de Auth expuestas fuera de lo que ya es público por diseño (`apiKey` de Firebase, protegido por Security Rules, no por ocultamiento — principio ya validado en toda la auditoría oficial) |
| — | Permisos excesivos | **Ninguno encontrado** | El código de auth no solicita scopes más allá de `email`/`profile` (Google, `injection.dart:88`) y `email`/`fullName` (Apple, `:150-153`) — mínimos necesarios |

**Ningún hallazgo Crítico o Alto.**

---

## FASE 5 — Rendimiento

| Observación | Severidad | Detalle |
|---|---|---|
| `authStateChanges` re-consulta Firestore en cada emisión | Bajo, oportunidad de optimización | `auth_remote_datasource.dart:203-208`, vía `_fetchUserDocument` en cada evento del stream de Firebase (incluyendo refresh de token) — funcionalmente correcto, pero podría cachear el último documento si el `uid` no cambió, para evitar lecturas repetidas de Firestore |
| Inicialización de `GoogleSignIn`/`FirebaseAuth` | ✅ Correcta | `registerLazySingleton` — una sola instancia, creada solo cuando se usa por primera vez |
| Fugas de memoria | ✅ Ninguna encontrada | Controllers son `AsyncNotifier` (ciclo de vida gestionado por Riverpod), sin `StreamSubscription` manuales sin `cancel()` en todo el feature de auth |
| Operaciones costosas | Ninguna fuera de lo esperado | Una lectura de Firestore por verificación de usuario es el costo mínimo posible dado el diseño (perfil vive en Firestore, no en custom claims) |

---

## FASE 6 — Arquitectura (Clean Architecture / SOLID)

| Principio | Cumplimiento | Evidencia |
|---|---|---|
| Clean Architecture (capas) | ✅ Completo | Ver Fase 1 — domain sin infraestructura, un solo punto de contacto con SDKs |
| Single Responsibility | ✅ | Un usecase, una acción (`LoginUseCase`, `SignInWithAppleUseCase`, etc. — cada uno ~10-17 líneas) |
| Open/Closed | ✅ | `AuthRepository` es una interfaz — agregar NestJS como backend futuro (ya diseñado en el docblock de la interfaz, `:13-35`) no requeriría tocar `domain` ni `presentation` |
| Liskov / Interface Segregation | ✅ | Sin violaciones detectadas — interfaces cohesivas, sin métodos "vacíos" forzados |
| Dependency Inversion | ✅ | `AuthRepositoryImpl` depende de la abstracción `AuthRemoteDataSource`, no de Firebase directamente |
| Bajo acoplamiento | ✅ | Auth no importa nada de otros features; otros features (`ride_session_remote_datasource.dart`) dependen de `fb.FirebaseAuth` directamente para leer `currentUser`, no de `AuthRepository` — aceptable (es una lectura de infraestructura, no una regla de negocio de auth), pero es el único acoplamiento cruzado real a mencionar |
| Alta cohesión | ✅ | Cada archivo tiene una responsabilidad clara y única |

**Qué mejoraría antes de seguir desarrollando (recomendaciones, no bloqueantes):**
1. Resolver el hardcodeo de `googleWebClientId` (Fase 1) antes de que exista un build Web real de Development.
2. Agregar al menos un test de integración contra el emulador de Firebase Auth (gap confirmado en Fase 9) — mismo patrón ya usado en `firebase/rules-tests` para Firestore, extendido a Auth.
3. Resolver la duplicación `premium`/`role` (deuda ya conocida, sin relación directa con esta tarea, pero vive en el mismo archivo).

---

## FASE 7 — Compatibilidad Futura por Plataforma

| Plataforma | Bloqueos identificados |
|---|---|
| **Android** | Registro de app pendiente (Fase 2, `16_...md`); huellas SHA-1/SHA-256 del keystore de development deben registrarse en Firebase para que Google Sign-In funcione nativamente; recordatorio ya documentado de que `buildTypes.release` firma con clave de debug (Documento 15) |
| **iOS** | Registro de app pendiente (Fase 3, `16_...md`); capacidad "Sign in with Apple" en Xcode pendiente de la Fase 3 + Documento 18 completo; sin build/validación real en macOS (bloqueador transversal ya conocido) |
| **Web** | Registro de app pendiente; **hallazgo de esta auditoría** (`googleWebClientId`) debe corregirse antes de probar Google; dominio de Development debe agregarse a "Authorized domains" de Firebase Auth para Apple |
| **Windows** | Sin proyecto nativo generado (`PLAT-2`, ya conocido) — Authentication no es evaluable en esta plataforma todavía, ni bloquea ni se ve bloqueada por el estado actual de Auth |

---

## FASE 8 — Evidencia

Toda afirmación de este informe cita archivo y línea exacta en su sección correspondiente — no se repite aquí para evitar duplicación (ver autoauditoría de este mismo criterio en documentos anteriores, `15_...md` §13).

---

## FASE 9 — Pruebas Reales Ejecutadas

| Comando | Resultado |
|---|---|
| `flutter test test/features/auth/` | **17/17 passed** — cubre `UserModel`/`UserRole` (3+4 tests), `LoginUseCase`, `RegisterUseCase`, `SendPasswordResetUseCase`, `SignInWithGoogleUseCase`, `UpdateProfileUseCase` (2 tests cada uno) — todos contra mocks de `AuthRepository`, no contra Firebase real ni emulado |
| `flutter analyze --fatal-infos` | **No issues found!** (91.6s) |

**Lo que NO se pudo ejecutar, y por qué (sin inventar el resultado):** ningún test de integración contra el emulador de Firebase Auth existe en el repositorio (`firebase/rules-tests` solo cubre Firestore) — no hay nada que ejecutar en esa categoría, no es una limitación del entorno sino una ausencia real en el código de pruebas, ya señalada como recomendación en la Fase 6. Tampoco se pudo ejecutar ningún flujo de login real de punta a punta (Web/Android/iOS) porque **ninguna app está registrada todavía en `ridepro-development`** (Fases 2-3 de `16_...md`) — es un límite de la fase actual del proyecto, no del entorno de esta sesión.

---

## FASE 10 — Informe Final

### Hallazgos (consolidado)
1. 🟡 Web Client ID de Google hardcodeado a producción — Severidad Media, corrección propuesta abajo, no ejecutada.
2. Eliminación de cuenta no implementada — deuda ya conocida, reconfirmada con evidencia.
3. Sin test de integración contra el emulador de Auth — gap de cobertura, nuevo en su formulación explícita, aunque de la misma naturaleza que el gap ya encontrado para Firestore/`ride_sessions`.

### Riesgos
Ninguno Crítico o Alto. El hallazgo #1 es Medio pero no explotable hoy (no hay ningún build real de Development en ninguna plataforma todavía).

### Recomendaciones (ninguna ejecutada, a la espera de tu autorización)
1. Actualizar `SocialLoginConfig.googleWebClientId` cuando se registre la app Web de Development (Fase 2/3 de `16_...md`) — idealmente evolucionando hacia una constante por flavor en vez de un único valor estático, consistente con el diseño de flavors ya aprobado (D3).
2. Agregar un test de integración contra el emulador de Firebase Auth.
3. Mantener el orden ya planificado: no declarar Apple "completado" hasta ejecutar el Documento 18 y validar en las 3 plataformas.

### Deuda técnica (consolidado, nada nuevo agregado salvo lo explícito)
- Eliminación de cuenta (ya en `T-TRANS.7`).
- Duplicación `premium`/`role` (ya conocida, `user_entity.dart:59-65`).
- Ausencia de test de integración de Auth contra emulador (nuevo, sin ID de backlog todavía).

### Mejoras sugeridas
- Cache de `_fetchUserDocument` en `authStateChanges` para evitar lecturas repetidas de Firestore (Fase 5).

### Próximos pasos
1. Storage de `ridepro-development` (siguiente ítem pendiente de la Fase 1 de `16_...md`).
2. Corregir el hallazgo #1 cuando se ejecute la Fase 2 (registro de apps) — no antes, no es urgente hoy.
3. Verificación final consolidada de la Fase 1 completa una vez Storage esté cerrado.

### Estado del módulo Authentication

**✅ Aprobado con observaciones.**

No se encontró ningún hallazgo Crítico ni Alto. El único hallazgo Medio (Web Client ID de producción hardcodeado) no es explotable en el estado actual del proyecto (sin apps registradas en ningún entorno de Development) y tiene una corrección clara, ya identificada, para cuando corresponda ejecutarla. El código de Authentication está completo, probado (17/17), analizado sin issues, y arquitectónicamente sólido — listo para que continúe la Fase 1 con Storage.

**Reitero, como me pediste explícitamente:** *"Authentication parcialmente configurado: Email/Password y Google aprobados. Apple pendiente de configuración externa y validación multiplataforma."*
