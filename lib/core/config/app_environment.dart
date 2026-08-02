import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;

/// Única fuente de verdad de configuración dependiente de entorno
/// (Documento 21, Fase 0.2). Ningún módulo debe leer valores de entorno
/// de ningún otro lugar (ni `ApiConfig`, ni una constante global nueva) —
/// todo pasa por una instancia de esta clase, construida por
/// `environments/environment_*.dart` e inyectada explícitamente desde el
/// entry point (`main.dart` / `main_development.dart`) hacia
/// `bootstrapRideProApp`.
///
/// Deliberadamente NO tiene ningún valor por defecto ni constructor sin
/// argumentos — cada campo debe venir de un archivo de entorno explícito,
/// nunca de un fallback silencioso.
class AppEnvironment {
  const AppEnvironment({
    required this.name,
    required this.firebaseOptions,
    required this.googleSignInWebClientId,
    required this.backendBaseUrl,
    required this.allowsBackendOverride,
    required this.allowsDevBackendTestUser,
  });

  /// Identificador legible del entorno (`'development'`, `'production'`,
  /// …) — únicamente para logs/diagnóstico, nunca para tomar decisiones
  /// de código (eso lo decide el compilador, no un string comparado en
  /// runtime).
  final String name;

  final FirebaseOptions firebaseOptions;

  /// `null` fuera de Web (Android/iOS resuelven el Client ID de forma
  /// nativa vía `google-services.json`/`GoogleService-Info.plist`) — ver
  /// `resolveGoogleSignInClientId` en `core/di/injection.dart`.
  final String? googleSignInWebClientId;

  /// URL base del backend NestJS propio (Equipment/Workouts) — ver
  /// `core/network/backend_dio_client.dart`.
  final String backendBaseUrl;

  /// Si `true`, `resolveBackendBaseUrl` (Documento 21, Fase 0.3.1) acepta
  /// `BACKEND_BASE_URL_OVERRIDE` para este entorno. Si `false`, cualquier
  /// override recibido se rechaza con una excepción explícita — nunca se
  /// ignora en silencio. Deliberadamente un campo tipado del propio
  /// entorno (no `kDebugMode`): Development debe poder usar el override
  /// incluso en builds `--release` de prueba (canales Preview), mientras
  /// que Production nunca debe aceptarlo, sin importar el modo de build.
  final bool allowsBackendOverride;

  /// Si `true`, `BackendAuthService` (ver `core/network/backend_auth_service.dart`)
  /// puede registrar/iniciar sesión automáticamente con `DevBackendTestUser`
  /// aunque la app corra fuera de `kDebugMode` — mismo criterio que
  /// [allowsBackendOverride]: Development necesita esto en builds
  /// `--release` de prueba (canales Preview), donde `kDebugMode` siempre es
  /// `false`. Hallazgo real (incidente "Error al comunicarse con el
  /// servidor" al crear un Workout desde el canal Preview): antes de este
  /// campo, Equipment/Workouts eran estructuralmente inalcanzables en
  /// CUALQUIER build no-debug, incluido Development, porque el único
  /// mecanismo de autenticación contra el backend propio dependía
  /// exclusivamente de `kDebugMode`. Production sigue en `false` sin
  /// excepción — nunca debe autologuearse con una cuenta de prueba. Esto
  /// NO relaja ningún requisito de credenciales: `DevBackendTestUser`
  /// sigue exigiendo `--dart-define-from-file` explícito (vacío por
  /// defecto, sin valores hardcodeados) — este flag solo decide *cuándo*
  /// se le permite intentarlo, nunca provee ni afloja las credenciales en
  /// sí (ver `core/config/dev_backend_test_user.dart`).
  final bool allowsDevBackendTestUser;
}
