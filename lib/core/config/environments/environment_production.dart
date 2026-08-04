import '../../../firebase_options.dart';
import '../app_environment.dart';
import '../social_login_config.dart';

/// Entorno Production (`ridepro-dbafe`) — Documento 21, Fase 0.2.
/// Envuelve las fuentes ya existentes y ya auditadas
/// (`firebase_options.dart`, `social_login_config.dart`) sin duplicar sus
/// valores.
///
/// ⚠️ `backendBaseUrl` es un PLACEHOLDER — no existe todavía ningún
/// backend de Producción desplegado (`T-F1.1`, Documento 15 §4.5). Debe
/// actualizarse a la URL real antes de que cualquier build de Producción
/// intente hablar con el backend NestJS de verdad. Hoy ninguna pantalla de
/// Producción lo necesita (Workouts, el único consumidor, solo se ha
/// probado contra Development) — se deja explícito, en vez de vacío o
/// apuntando a `localhost`, para que quede evidente que es un valor
/// pendiente de reemplazo real y no un entorno ya operativo.
AppEnvironment get productionEnvironment => AppEnvironment(
      name: 'production',
      firebaseOptions: DefaultFirebaseOptions.currentPlatform,
      googleSignInWebClientId: SocialLoginConfig.googleWebClientId,
      backendBaseUrl: 'https://api.ridepro.app/v1',
      // Documento 21, Fase 0.3.1: Production NUNCA admite
      // BACKEND_BASE_URL_OVERRIDE, sin excepción — cualquier valor
      // recibido se rechaza explícitamente en `resolveBackendBaseUrl`.
      allowsBackendOverride: false,
      // Production NUNCA se autologuea con DevBackendTestUser, sin
      // excepción, sin importar el modo de build.
      allowsDevBackendTestUser: false,
    );
