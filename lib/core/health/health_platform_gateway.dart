import 'health_availability.dart';
import 'health_permission_status.dart';

/// Un "workout"/entrenamiento ya leído de HealthKit o Health Connect,
/// normalizado a lo mínimo que esta capa garantiza en ambas plataformas.
/// La traducción a `ExternalActivity` (con su `ExternalActivityType`,
/// proveedor, etc.) es responsabilidad de `HealthPackageAdapter`, una capa
/// más arriba — este gateway no sabe nada del dominio de wearables.
class HealthWorkout {
  const HealthWorkout({
    required this.id,
    required this.startTime,
    required this.endTime,
    required this.activityTypeName,
    this.totalEnergyBurnedKcal,
    this.totalDistanceMeters,
  });

  final String id;
  final DateTime startTime;
  final DateTime endTime;
  final String activityTypeName;
  final double? totalEnergyBurnedKcal;
  final double? totalDistanceMeters;
}

/// **Capa de abstracción** entre el resto de la app y el SDK de salud
/// específico de cada plataforma (HealthKit vía el paquete `health` en
/// iOS, Health Connect vía el mismo paquete en Android).
///
/// Por qué existe esta capa además del patrón Adapter del módulo
/// `wearables` (`WearableAdapter`): son dos abstracciones con
/// responsabilidades distintas.
/// - `WearableAdapter` (dominio de negocio) responde "¿puedo importar
///   actividades de este PROVEEDOR (Apple Health, Garmin...)?".
/// - `HealthPlatformGateway` (capacidad de plataforma) responde "¿qué
///   puede hacer el SISTEMA OPERATIVO en materia de salud en ESTE
///   dispositivo, ahora mismo?" — independientemente de qué proveedor de
///   la app lo esté usando.
///
/// Esta separación es la que permite testear `HealthPackageAdapter` con
/// un `FakeHealthPlatformGateway` inyectado (ver
/// `test/features/wearables/data/adapters/health_package_adapter_test.dart`)
/// sin depender de un dispositivo real con HealthKit/Health Connect
/// disponible — algo que NO sería testeable si `HealthPackageAdapter`
/// llamara directamente a `Health()` del paquete `health`.
abstract class HealthPlatformGateway {
  /// Consulta si la plataforma de salud existe/está lista en este
  /// dispositivo, SIN disparar ningún diálogo de permisos.
  Future<HealthAvailability> checkAvailability();

  /// Dispara el diálogo de autorización nativo (HealthKit o Health
  /// Connect) para los tipos de dato indicados. Ver la nota sobre
  /// [HealthPermissionStatus.permanentlyDenied] respecto a la limitación
  /// real de HealthKit en iOS.
  Future<HealthPermissionStatus> requestPermissions();

  /// Estado actual del permiso SIN volver a mostrar el diálogo — usado al
  /// entrar a la pantalla de wearables para decidir si mostrar "Conectar"
  /// o "Ya conectado", análogo a `BlePermissionHandler.hasBlePermissions()`.
  Future<HealthPermissionStatus> checkPermissionStatus();

  /// Abre los ajustes donde el usuario puede conceder el permiso
  /// manualmente — Ajustes de la app (iOS, ahí vive el toggle de Salud) o
  /// la propia app Health Connect (Android).
  Future<void> openPermissionSettings();

  Future<List<HealthWorkout>> fetchWorkouts({required DateTime since, required DateTime until});
}
