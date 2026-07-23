/// Cuenta de prueba fija contra el backend REAL de RidePro (NestJS),
/// usada exclusivamente en `kDebugMode` (ver
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
/// cuenta a mano. Está deliberadamente excluido de release builds
/// (`kDebugMode` es `false` en `flutter build`/`--release`): en producción,
/// sin una pantalla de login de backend real, las pantallas de Workouts
/// muestran un estado de error de sesión en vez de autenticar solas.
///
/// DEUDA TÉCNICA documentada (ver reporte de cierre de D2): reemplazar por
/// la pantalla de login real contra este backend, o por una capa de
/// intercambio Firebase → backend, antes de exponer Workouts a usuarios
/// reales.
abstract class DevBackendTestUser {
  static const String email = 'qa.workouts@ridepro.local';
  static const String password = 'QaWorkouts#2026';
  static const String displayName = 'QA Workouts';
}
