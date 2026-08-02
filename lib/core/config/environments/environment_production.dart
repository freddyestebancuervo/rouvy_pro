import '../../../firebase_options.dart';
import '../app_environment.dart';
import '../backend_config_resolver.dart';
import '../social_login_config.dart';

/// Entorno Production (`ridepro-dbafe`) — Documento 21, Fase 0.2.
/// Envuelve las fuentes ya existentes y ya auditadas
/// (`firebase_options.dart`, `social_login_config.dart`) sin duplicar sus
/// valores.
///
/// `backendBaseUrl` usa el mismo default local platform-aware que ya
/// usaba `ApiConfig.backendBaseUrl` (`defaultLocalBackendBaseUrl()`) —
/// **comportamiento sin cambios respecto al `main.dart` anterior a este
/// bloque**. No existe todavía ningún backend de Producción desplegado
/// (`T-F1.1`, Documento 15 §4.5); ningún dominio real fue asignado ni
/// verificado, por lo que no se hardcodea ningún placeholder aquí — se
/// deja explícito el mismo default ya vigente, no uno nuevo inventado.
/// Actualizar a la URL real, cuando exista, es una decisión de
/// infraestructura aparte, con su propia autorización.
AppEnvironment get productionEnvironment => AppEnvironment(
      name: 'production',
      firebaseOptions: DefaultFirebaseOptions.currentPlatform,
      googleSignInWebClientId: SocialLoginConfig.googleWebClientId,
      backendBaseUrl: defaultLocalBackendBaseUrl(),
      // Documento 21, Fase 0.3.1: Production NUNCA admite
      // BACKEND_BASE_URL_OVERRIDE, sin excepción — cualquier valor
      // recibido se rechaza explícitamente en `resolveBackendBaseUrl`.
      allowsBackendOverride: false,
      // Production NUNCA se autologuea con DevBackendTestUser, sin
      // excepción, sin importar el modo de build.
      allowsDevBackendTestUser: false,
    );
