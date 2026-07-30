# RidePro — Documento Maestro de Arquitectura
## Documento 6 de 9: Arquitectura Multiplataforma

- **Fecha:** 2026-07-24 · **Rama/HEAD:** `feature/d2` / `d3d01d8`
- **Plataformas objetivo declaradas:** Android, iOS, Web, Windows (`pubspec.yaml`, `ARCHITECTURE_DECISIONS.md`).
- **Método:** inspección de carpetas nativas, del patrón Adapter existente (`core/platform/`), y de cada plugin declarado en `pubspec.yaml` contra su soporte de plataforma conocido. **No se ejecutó ningún build real de Web/Windows en esta pasada** (ver sección 6, no verificado) — los hallazgos de esta sección se basan en lectura de código + conocimiento verificable del soporte de plataforma de cada paquete (documentado en pub.dev), no en compilar y correr.
- **No se modifica código en este documento.**

---

## 1. Estado real por plataforma

| Plataforma | Proyecto nativo | Estado |
|---|---|---|
| Android | `android/` | ✅ Presente, compila (evidencia: CI job `flutter-checks` corre `flutter test`/`analyze`, que requieren que el proyecto compile) |
| iOS | `ios/` | ✅ Presente |
| Web | `web/` | ✅ Presente — pero ver hallazgo PLAT-1 (sección 3) sobre un crash real al abrir Wearables |
| Windows | **No existe** | 🔴 `firebase_options.dart` ya tiene un bloque `DefaultFirebaseOptions.windows` generado, pero **nunca se ejecutó `flutter create --platforms=windows`** — verificado por ausencia de la carpeta `windows/` en la raíz del repo |

## 2. El patrón de referencia ya existente: Web Bluetooth

`lib/core/platform/` contiene `web_bluetooth_support.dart`, `web_bluetooth_support_stub.dart`, `web_bluetooth_support_web.dart` — **imports condicionales de Dart** (`import 'x_stub.dart' if (dart.library.html) 'x_web.dart'`, patrón estándar de Flutter para código específico de Web sin romper la compilación en plataformas nativas). Esto permite que `flutter_blue_plus` degrade correctamente en Web (donde Web Bluetooth tiene soporte limitado/inconsistente entre navegadores) sin que el resto de la app necesite saber que está en Web. **Es el ejemplo de referencia correcto** — cualquier capacidad nueva específica de plataforma debería replicar este patrón.

## 3. Hallazgo nuevo — `HealthPlatformGatewayImpl` no replica ese patrón y crashea en Web

**Severidad: Alto** (defecto confirmado, no especulativo, en una plataforma objetivo declarada)

- **Evidencia:** `lib/core/health/health_platform_gateway_impl.dart:1` importa `dart:io` (`import 'dart:io';`) y sus métodos ramifican con `Platform.isIOS`/`Platform.isAndroid` (líneas 42, 57, 98) — **sin ninguna rama para el caso en que ninguno de los dos es cierto**.
- **`dart:io`'s `Platform` lanza una excepción en tiempo de ejecución cuando el código corre en Flutter Web** (`Platform._operatingSystem` no está disponible en el runtime de la Web) — esto es un hecho conocido y documentado del SDK de Dart, no una suposición sobre este proyecto en particular.
- **Registro en DI sin condicional:** `lib/core/di/injection.dart:133` — `sl.registerLazySingleton<HealthPlatformGateway>(HealthPlatformGatewayImpl.new)` — **sin ningún guard `kIsWeb`**. Esto contrasta directamente con la línea 92 del mismo archivo, que sí condiciona correctamente otro caso (`clientId: kIsWeb ? SocialLoginConfig.googleWebClientId : null`) — el patrón correcto existe en el mismo archivo, a 41 líneas de distancia, pero no se aplicó acá.
- **Alcance del impacto:** al ser `registerLazySingleton`, no crashea el arranque de la app — crashea **la primera vez que un usuario en Flutter Web abre la pantalla de Wearables** (o cualquier flujo que resuelva `HealthPlatformGateway` por primera vez), con una excepción no capturada de `dart:io`.
- **Consecuencia técnica:** el feature Wearables (parcialmente implementado, 2 de 6 proveedores reales según Documento 1) es **inutilizable en Web**, no solo "no soportado" de forma controlada — es un crash, con la mala experiencia de usuario que eso implica, y potencialmente un reporte de error en Crashlytics sin contexto claro de que la causa raíz es "se ejecutó en Web".
- **Solución recomendada:** replicar el patrón de `core/platform/web_bluetooth_support*.dart` — un `HealthPlatformGatewayWebStub` que responda con un estado explícito ("no disponible en esta plataforma", mismo criterio de degradación local ya documentado en `ARCHITECTURE_DECISIONS.md` #4 para BLE en Web) en vez de dejar que `dart:io` lance la excepción. Cambio acotado a 1-2 archivos nuevos + el registro condicional en `injection.dart` (mismo patrón que la línea 92).
- **Orden de corrección:** antes de considerar Web una plataforma "soportada" en cualquier comunicación a usuarios — hoy Web compila y corre, pero con esta ruta rota.

## 4. Plugins con riesgo de plataforma — evaluados uno por uno

| Plugin | Android | iOS | Web | Windows | Riesgo |
|---|---|---|---|---|---|
| `flutter_blue_plus` (BLE) | ✅ | ✅ | 🟡 Soporte limitado del navegador, ya mitigado con adapter propio (sección 2) | ⚪ No verificado — sin proyecto Windows para probarlo | Bajo (ya mitigado en Web; Windows requiere verificación cuando exista el proyecto) |
| `health` (HealthKit/Health Connect) | ✅ | ✅ | ❌ Sin sentido conceptual (no hay "salud del navegador") **y crashea hoy** (sección 3) | ❌ Sin sentido conceptual — mismo tipo de riesgo que Web si no se guarda con un stub | **Alto** — ver PLAT-1 arriba |
| `google_sign_in` | ✅ | ✅ | ✅ (ya con `clientId` condicional, `injection.dart:92`) | 🟡 Sin implementación oficial de escritorio Windows en versiones estables del paquete — requeriría un flujo alternativo (p. ej. OAuth vía navegador embebido/`flutter_web_auth`) el día que Windows se priorice | Medio (diferido, no bloquea hoy porque Windows no existe todavía) |
| `sign_in_with_apple` | N/A (Apple exige que esté disponible si se usa en iOS, pero el paquete en sí es multiplataforma) | ✅ | 🟡 Requiere configuración de dominio verificado (Sign in with Apple JS) — no confirmado si está configurado | 🟡 Mismo riesgo que `google_sign_in` en Windows — sin implementación de escritorio nativa estándar | Medio (mismo motivo: diferido) |
| `permission_handler` | ✅ | ✅ | 🟡 Modelo de permisos del navegador es distinto (se piden en el momento de uso, no hay un "settings de la app") — ya parcialmente reconocido por el proyecto (`ble_permission_handler.dart` existe como capa propia) | ⚪ No verificado | Bajo |
| `flutter_secure_storage` | ✅ Keystore | ✅ Keychain | ✅ (cifrado en almacenamiento del navegador) | ✅ DPAPI (soporte oficial del paquete) | Bajo — el más multiplataforma de los plugins usados |
| `connectivity_plus` | ✅ | ✅ | ✅ | ✅ | Bajo |
| `firebase_*` (Auth/Firestore/Storage/Messaging/Analytics/Crashlytics) | ✅ | ✅ | ✅ (vía Firebase JS SDK) | 🟡 Windows usa la config de Web reutilizada como placeholder (Documento 1 §6) — funciona en teoría (Firebase JS SDK vía webview en desktop), **no probado** porque no hay proyecto Windows | Medio en Windows específicamente, por falta de verificación, no por incompatibilidad conocida |

## 5. Qué código debe ser nativo vs. compartido

**Ya compartido correctamente (sin acción requerida):** toda la capa `domain/` de los 10 features (100% Dart puro, sin dependencia de plataforma) — el dominio de RidePro nunca debería necesitar código nativo. Toda la lógica de negocio de Auth, Training, Workouts, Wearables (a nivel de dominio, no de adapter) es y debe seguir siendo compartida.

**Debe tener una implementación por plataforma (adapter, no reescritura del dominio):**
- BLE en Web (ya resuelto, sección 2 — patrón de referencia).
- Health en Web/Windows (no resuelto, sección 3 — requiere el mismo patrón).
- Login social en Windows (no resuelto porque Windows no existe todavía — planificar con el mismo patrón cuando se priorice).
- Cualquier acceso a Storage/descargas de archivos (módulo "Descargas", no implementado todavía — Documento 2) — la API de descarga en segundo plano difiere genuinamente entre plataformas; diseñar como adapter desde el día uno de ese módulo, no como código común con `if` esparcidos.

**No se encontró ningún caso de código nativo mezclado directamente en `domain/` o en widgets compartidos** — el proyecto no tiene el problema opuesto (lógica de negocio contaminada con `Platform.isX`) excepto por el caso ya señalado (`HealthPlatformGatewayImpl`, que sí vive correctamente en una capa de infraestructura — el problema no es dónde vive el código, es que le falta la rama de Web/Windows).

## 6. No verificado en este documento

1. **Build real de `flutter build web`** — no ejecutado en esta pasada; el hallazgo PLAT-1 se basa en el comportamiento conocido de `dart:io` en Web + lectura directa del código, no en observar el crash ocurrir.
2. **Build real de Windows** — imposible de verificar porque el proyecto nativo no existe (`flutter create --platforms=windows` no se ejecutó, consistente con no implementar nada sin autorización explícita, ya que generar el proyecto nativo es una acción de infraestructura, no solo de análisis).
3. **Comportamiento real de `google_sign_in`/`sign_in_with_apple` en un hipotético build de Windows** — evaluado por conocimiento documentado del paquete (pub.dev), no probado.
4. **Configuración de dominio verificado para Sign in with Apple en Web** — no confirmada.

---

## 7. Resumen de hallazgos

| # | Hallazgo | Severidad |
|---|---|---|
| PLAT-1 | `HealthPlatformGatewayImpl` crashea en Web (`dart:io`/`Platform.isX` sin guard) | **Alto** |
| PLAT-2 | Windows sin proyecto nativo generado, pese a ser plataforma declarada | **Medio** (ya documentado en Documento 1) |
| PLAT-3 | Login social sin plan de adapter para Windows cuando se priorice | Bajo (diferido, sin bloqueo hoy) |
| PLAT-4 | Firebase en Windows usa config de Web como placeholder, sin probar | Medio |

## 8. Criterios de aprobación de este documento

- [x] Estado real por plataforma (Android/iOS/Web/Windows) con evidencia.
- [x] Cada plugin de riesgo evaluado individualmente por plataforma.
- [x] Código nativo vs. compartido identificado con criterio explícito.
- [x] Al menos un hallazgo nuevo, verificado con evidencia de línea de código, no solo inferido de la documentación existente (PLAT-1).
- [ ] **No cumplido — declarado explícitamente:** sin build real ejecutado en Web/Windows (sección 6).

**Siguiente documento:** Documento 7 — Riesgos Técnicos.
