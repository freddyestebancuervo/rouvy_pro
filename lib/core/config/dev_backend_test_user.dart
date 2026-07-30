/// Cuenta de prueba contra el backend REAL de RidePro (NestJS), usada
/// exclusivamente en `kDebugMode` (ver
/// `core/network/backend_auth_service.dart`) para poder probar
/// Equipment/Workouts sin depender de una pantalla de login propia contra
/// este backend — hoy no existe: la app solo tiene login contra Firebase
/// (`features/auth`), que este backend no entiende en absoluto. Son dos
/// sistemas de autenticación completamente independientes (ver
/// `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md`).
///
/// NO es un bypass de seguridad: pasa por `POST /auth/register` y
/// `POST /auth/login` reales del backend, obtiene un JWT RS256 firmado de
/// verdad, y queda sujeto a las mismas reglas de ownership que cualquier
/// otro usuario — simplemente no hay todavía una UI para elegir/crear esa
/// cuenta a mano.
///
/// Auditoría 2026-07-23: antes estas credenciales estaban hardcodeadas
/// como `static const`. Se reemplazan por `String.fromEnvironment` —
/// mismo mecanismo `--dart-define`/`--dart-define-from-file` que ya usa
/// `QaEmulatorConfig` — para que NINGÚN valor real quede en el código
/// fuente ni en el historial de git. Sin definir, quedan vacías: ver
/// [isConfigured] y `dart_define.local.json.example` (raíz del repo) para
/// cómo poblarlas localmente.
///
/// Doble candado con esto sigue siendo cierto: `kDebugMode` (siempre
/// `false` en `flutter build`/`--release`, código muerto en producción) Y
/// ahora, además, que el dev-define se haya pasado explícitamente — sin
/// ninguno de los dos, `BackendAuthService` rechaza con un error claro en
/// vez de intentar loguearse con credenciales vacías.
///
/// DEUDA TÉCNICA documentada (ver reporte de cierre de D2): reemplazar por
/// la pantalla de login real contra este backend, o por una capa de
/// intercambio Firebase → backend, antes de exponer Workouts a usuarios
/// reales.
abstract class DevBackendTestUser {
  static const String email = String.fromEnvironment('QA_BACKEND_EMAIL');
  static const String password = String.fromEnvironment('QA_BACKEND_PASSWORD');
  static const String displayName = String.fromEnvironment(
    'QA_BACKEND_DISPLAY_NAME',
    defaultValue: 'QA Workouts',
  );

  /// `false` si el dev-define no se pasó (build normal sin
  /// `--dart-define-from-file=dart_define.local.json`) — el nombre
  /// (`displayName`) tiene un default no sensible, así que no cuenta acá.
  static bool get isConfigured => email.isNotEmpty && password.isNotEmpty;
}
