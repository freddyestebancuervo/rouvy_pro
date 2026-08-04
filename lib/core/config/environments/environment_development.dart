import '../../../firebase_options_development.dart';
import '../app_environment.dart';
import '../social_login_config_development.dart';

/// Entorno Development (`ridepro-development`) — Documento 21, Fase 0.2.
/// Envuelve las fuentes ya existentes y ya auditadas
/// (`firebase_options_development.dart`, `social_login_config_development.dart`)
/// sin duplicar sus valores — este archivo es la única pieza nueva.
///
/// `backendBaseUrl` apunta al backend NestJS real desplegado en Cloud Run
/// (Fase 4D de esta sesión) — reemplaza el placeholder `localhost` que
/// era deuda técnica heredada mientras el backend no estaba desplegado en
/// ningún lugar real.
AppEnvironment get developmentEnvironment => AppEnvironment(
      name: 'development',
      firebaseOptions: DefaultFirebaseOptionsDevelopment.currentPlatform,
      googleSignInWebClientId: SocialLoginConfigDevelopment.googleWebClientId,
      backendBaseUrl: developmentBackendBaseUrl,
      // Documento 21, Fase 0.3.1: Development permite
      // BACKEND_BASE_URL_OVERRIDE incluso en builds `--release` de prueba
      // (canales Preview) — no depende de kDebugMode.
      allowsBackendOverride: true,
      // Mismo criterio: Development permite que BackendAuthService use
      // DevBackendTestUser fuera de kDebugMode — necesario para que
      // Equipment/Workouts sean alcanzables en el canal Preview.
      allowsDevBackendTestUser: true,
    );

/// Backend NestJS de Development real: Cloud Run `ridepro-backend-dev`,
/// región `southamerica-east1`, conectado a Cloud SQL
/// (`ridepro-backend-dev-pg`) — ver Fase 4D. Una única URL para todas las
/// plataformas: a diferencia de `localhost`/`10.0.2.2` (solo alcanzables
/// desde la propia máquina/el emulador de Android respectivamente), una
/// URL HTTPS pública es igualmente alcanzable desde Web, Android, iOS o
/// Windows — ya no hace falta la distinción por plataforma que tenía el
/// valor `localhost` anterior.
const String developmentBackendBaseUrl =
    'https://ridepro-backend-dev-1020003121433.southamerica-east1.run.app/v1';
