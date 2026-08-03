import '../../../firebase_options_development.dart';
import '../app_environment.dart';
import '../social_login_config_development.dart';

/// Entorno Development (`ridepro-development`) — Documento 21, Fase 0.2.
/// Envuelve las fuentes ya existentes y ya auditadas
/// (`firebase_options_development.dart`, `social_login_config_development.dart`)
/// sin duplicar sus valores — este archivo es la única pieza nueva.
///
/// `backendBaseUrl` apunta al backend real de Development (T-F0.2 Bloque 2):
/// Cloud Run `ridepro-backend-dev` + Cloud SQL `ridepro-backend-dev-pg`,
/// región `southamerica-east1`, ya desplegados y validados con pruebas de
/// concurrencia reales (`docs/audits/AUDITORIA_FINAL/fase_4_1`/`fase_4_2`) —
/// no un valor de infraestructura nuevo creado por este bloque, que es
/// exclusivamente de código. `BACKEND_BASE_URL_OVERRIDE` (ver
/// `dart_define.local.json.example`) sigue disponible para apuntar un
/// build local a otro backend sin recompilar este valor.
const String developmentBackendUrl =
    'https://ridepro-backend-dev-hmsnc2l3pq-rj.a.run.app/v1';

/// Documento 21, Fase 0.3.1: Development permite `BACKEND_BASE_URL_OVERRIDE`
/// incluso en builds `--release` de prueba (canales Preview) — no depende
/// de `kDebugMode`. Extraído como constante (igual que [developmentBackendUrl])
/// para que sea comprobable en tests de VM sin evaluar `developmentEnvironment`
/// completo, que requiere Web por `DefaultFirebaseOptionsDevelopment`.
const bool developmentAllowsBackendOverride = true;

AppEnvironment get developmentEnvironment => AppEnvironment(
      name: 'development',
      firebaseOptions: DefaultFirebaseOptionsDevelopment.currentPlatform,
      googleSignInWebClientId: SocialLoginConfigDevelopment.googleWebClientId,
      backendBaseUrl: developmentBackendUrl,
      allowsBackendOverride: developmentAllowsBackendOverride,
      // Mismo criterio: Development permite que BackendAuthService use
      // DevBackendTestUser fuera de kDebugMode — necesario para que
      // Equipment/Workouts sean alcanzables en el canal Preview. Ver
      // `AppEnvironment.allowsDevBackendTestUser` para el incidente real
      // que motiva este campo, y `backend_auth_service_test.dart` para la
      // prueba que demuestra que esto NUNCA afloja el requisito de
      // credenciales de `DevBackendTestUser` (que sigue vacío por defecto).
      allowsDevBackendTestUser: true,
    );
