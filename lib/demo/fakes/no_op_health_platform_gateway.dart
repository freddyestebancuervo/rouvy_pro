import '../../core/health/health_availability.dart';
import '../../core/health/health_permission_status.dart';
import '../../core/health/health_platform_gateway.dart';

/// Implementación mínima para modo demo — los adapters de salud
/// (`DemoAppleHealthAdapter`/`DemoGoogleFitAdapter`) no lo usan en
/// absoluto (extienden `MockWearableAdapter`, que no toca este gateway),
/// pero `wearable_actions_controller.dart` sí lo referencia directamente
/// para `openHealthSettings()`. Se registra este no-op para que ese
/// camino de código no lance una excepción de provider sin overridear si
/// alguna vez se alcanza durante la demo.
class NoOpHealthPlatformGateway implements HealthPlatformGateway {
  @override
  Future<HealthAvailability> checkAvailability() async => HealthAvailability.available;

  @override
  Future<HealthPermissionStatus> requestPermissions() async => HealthPermissionStatus.granted;

  @override
  Future<HealthPermissionStatus> checkPermissionStatus() async => HealthPermissionStatus.granted;

  @override
  Future<void> openPermissionSettings() async {}

  @override
  Future<List<HealthWorkout>> fetchWorkouts({required DateTime since, required DateTime until}) async {
    return const <HealthWorkout>[];
  }
}
