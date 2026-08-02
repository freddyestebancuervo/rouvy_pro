import '../../../firebase_options_development.dart';
import '../app_environment.dart';
import '../backend_config_resolver.dart';
import '../social_login_config_development.dart';

/// Entorno Development (`ridepro-development`) — Documento 21, Fase 0.2.
/// Envuelve las fuentes ya existentes y ya auditadas
/// (`firebase_options_development.dart`, `social_login_config_development.dart`)
/// sin duplicar sus valores — este archivo es la única pieza nueva.
///
/// `backendBaseUrl` usa hoy el mismo default local platform-aware que ya
/// usaba `ApiConfig` (`defaultLocalBackendBaseUrl()`) — **no** un backend
/// real desplegado. Existe evidencia de que un backend Cloud Run
/// (`ridepro-backend-dev`) y una instancia Cloud SQL (`ridepro-backend-dev-pg`)
/// ya corren en el proyecto `ridepro-development`, pero verificar esa URL
/// real y decidir wirearla aquí es una decisión de infraestructura aparte
/// (Documento 22, Fase 5) — fuera del alcance de este bloque de
/// reconciliación de código, y no ejecutada sin autorización explícita
/// separada. Mientras tanto, `BACKEND_BASE_URL_OVERRIDE` (ver
/// `dart_define.local.json.example`) permite apuntar un build local a
/// cualquier backend real sin recompilar el valor por defecto.
AppEnvironment get developmentEnvironment => AppEnvironment(
      name: 'development',
      firebaseOptions: DefaultFirebaseOptionsDevelopment.currentPlatform,
      googleSignInWebClientId: SocialLoginConfigDevelopment.googleWebClientId,
      backendBaseUrl: defaultLocalBackendBaseUrl(),
      // Documento 21, Fase 0.3.1: Development permite
      // BACKEND_BASE_URL_OVERRIDE incluso en builds `--release` de prueba
      // (canales Preview) — no depende de kDebugMode.
      allowsBackendOverride: true,
      // Mismo criterio: Development permite que BackendAuthService use
      // DevBackendTestUser fuera de kDebugMode — necesario para que
      // Equipment/Workouts sean alcanzables en el canal Preview. Ver
      // `AppEnvironment.allowsDevBackendTestUser` para el incidente real
      // que motiva este campo, y `backend_auth_service_test.dart` para la
      // prueba que demuestra que esto NUNCA afloja el requisito de
      // credenciales de `DevBackendTestUser` (que sigue vacío por defecto).
      allowsDevBackendTestUser: true,
    );
