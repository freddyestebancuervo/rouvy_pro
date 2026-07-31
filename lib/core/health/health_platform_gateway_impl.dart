import 'dart:io';

import 'package:health/health.dart';
import 'package:permission_handler/permission_handler.dart' as ph;

import '../platform/platform_capabilities.dart';
import 'health_availability.dart';
import 'health_permission_status.dart';
import 'health_platform_gateway.dart';

/// Implementación real — la ÚNICA clase del proyecto que importa
/// `package:health`. Si mañana se cambia de plugin (o se llama
/// directamente a HealthKit/Health Connect vía platform channels propios),
/// solo este archivo cambia.
///
/// ⚠️ Nota de mantenimiento: los nombres exactos de métodos/enums del
/// paquete `health` han cambiado entre versiones mayores en el pasado.
/// Antes de compilar contra una versión nueva, verificar en pub.dev que
/// `requestAuthorization`, `hasPermissions`, `getHealthConnectSdkStatus` y
/// `HealthDataType`/`HealthDataAccess` siguen teniendo esta forma — ver
/// `HEALTH_SETUP.md`, sección "Mantenimiento del plugin".
class HealthPlatformGatewayImpl implements HealthPlatformGateway {
  HealthPlatformGatewayImpl({bool Function()? isWeb})
      : _health = Health(),
        _isWeb = isWeb ?? (() => PlatformCapabilities.isWeb);

  final Health _health;

  // Inyectable por tests — `kIsWeb`/`PlatformCapabilities.isWeb` es una
  // constante de compilación, no mockeable en una corrida normal de
  // `flutter test` (VM). Mismo patrón ya usado en
  // `HealthPackageAdapter._isIOS` (`isIOS` inyectable) para poder probar
  // la rama Web sin necesitar `flutter test --platform chrome`, que no
  // está configurado en `ci.yml`.
  final bool Function() _isWeb;

  /// Mismo conjunto de tipos que ya usaba `HealthPackageAdapter` — se
  /// centraliza aquí para que la solicitud de permisos y la lectura de
  /// datos usen exactamente los mismos tipos (pedir permiso para X y leer
  /// Y es la causa más común de un "permission denied" fantasma).
  static const List<HealthDataType> _dataTypes = <HealthDataType>[
    HealthDataType.WORKOUT,
    HealthDataType.HEART_RATE,
    HealthDataType.ACTIVE_ENERGY_BURNED,
    HealthDataType.DISTANCE_CYCLING,
  ];

  static final List<HealthDataAccess> _accessTypes =
      List<HealthDataAccess>.filled(_dataTypes.length, HealthDataAccess.READ);

  @override
  Future<HealthAvailability> checkAvailability() async {
    if (_isWeb()) {
      // `dart:io`'s `Platform.isIOS`/`Platform.isAndroid` lanzan
      // `UnsupportedError` en tiempo de ejecución en Flutter Web — ninguna
      // plataforma de salud aplica ahí de todas formas (ver el mismo
      // veredicto ya existente más abajo para desktop), así que se
      // devuelve `unavailable` ANTES de tocar `Platform`, sin esperar a
      // que la comprobación de iOS/Android truene primero.
      return HealthAvailability.unavailable;
    }

    if (Platform.isIOS) {
      // HealthKit está presente en todo iOS desde la versión 8 — el único
      // caso real de "no disponible" es un iPad (algunas versiones de
      // iPadOS no incluyen la app Salud) o una restricción de MDM
      // corporativo. El paquete `health` no expone una comprobación
      // directa de esto en iOS; se infiere de forma segura intentando
      // configurar el SDK y capturando cualquier excepción de plataforma.
      try {
        await _health.configure();
        return HealthAvailability.available;
      } catch (_) {
        return HealthAvailability.unavailable;
      }
    }

    if (Platform.isAndroid) {
      try {
        final HealthConnectSdkStatus? status = await _health.getHealthConnectSdkStatus();
        switch (status) {
          case HealthConnectSdkStatus.sdkAvailable:
            return HealthAvailability.available;
          case HealthConnectSdkStatus.sdkUnavailableProviderUpdateRequired:
          case HealthConnectSdkStatus.sdkUnavailable:
          case null:
            // En ambos casos la app Health Connect necesita instalarse o
            // actualizarse desde Play Store antes de poder usarse — desde
            // la perspectiva de esta app, el flujo de recuperación es el
            // mismo: dirigir al usuario a Play Store.
            return HealthAvailability.notInstalled;
        }
      } catch (_) {
        return HealthAvailability.unavailable;
      }
    }

    // Desktop (Windows/Linux/macOS, no Web — Web ya se resolvió arriba):
    // ninguna plataforma de salud aplicable.
    return HealthAvailability.unavailable;
  }

  @override
  Future<HealthPermissionStatus> requestPermissions() async {
    final HealthAvailability availability = await checkAvailability();
    if (availability == HealthAvailability.notInstalled) return HealthPermissionStatus.notInstalled;
    if (availability == HealthAvailability.unavailable) return HealthPermissionStatus.unavailable;

    try {
      final bool dialogCompleted = await _health.requestAuthorization(_dataTypes, permissions: _accessTypes);

      if (!dialogCompleted) {
        // El usuario cerró el diálogo sin decidir, o Android denegó de
        // forma explícita — en Health Connect esto SÍ es una señal fiable
        // de denegación (a diferencia de iOS, ver el docblock de
        // `HealthPermissionStatus.permanentlyDenied`).
        return HealthPermissionStatus.denied;
      }

      if (Platform.isIOS) {
        // Ver la nota de honestidad en `HealthPermissionStatus`: iOS no
        // permite saber si el usuario realmente concedió lectura. Se
        // reporta `granted` como mejor esfuerzo — cualquier ausencia real
        // de datos se maneja en `fetchWorkouts` devolviendo una lista
        // vacía, nunca lanzando un error de "permiso denegado" que no se
        // puede confirmar.
        return HealthPermissionStatus.granted;
      }

      // Android: si `requestAuthorization` devolvió true, Health Connect
      // sí confirma la concesión de forma fiable.
      return HealthPermissionStatus.granted;
    } catch (_) {
      return HealthPermissionStatus.denied;
    }
  }

  @override
  Future<HealthPermissionStatus> checkPermissionStatus() async {
    final HealthAvailability availability = await checkAvailability();
    if (availability == HealthAvailability.notInstalled) return HealthPermissionStatus.notInstalled;
    if (availability == HealthAvailability.unavailable) return HealthPermissionStatus.unavailable;

    try {
      final bool? granted = await _health.hasPermissions(_dataTypes, permissions: _accessTypes);
      // `hasPermissions` devuelve `null` en iOS cuando no puede saberlo
      // (la misma limitación de privacidad de HealthKit) — se trata como
      // "aún no confirmado" (`denied`, recuperable con un nuevo intento de
      // `requestPermissions`), nunca como `permanentlyDenied`.
      return (granted ?? false) ? HealthPermissionStatus.granted : HealthPermissionStatus.denied;
    } catch (_) {
      return HealthPermissionStatus.denied;
    }
  }

  @override
  Future<void> openPermissionSettings() async {
    // No existe (a fecha de esta implementación) un deep-link fiable y
    // multiplataforma directo a "ajustes de Health Connect para esta app"
    // ni a la sección de Salud de Ajustes de iOS expuesto por
    // `permission_handler` — `openAppSettings()` lleva a la pantalla de
    // ajustes de la app, desde donde iOS expone un acceso directo a
    // "Salud" y Android a los permisos de Health Connect asociados. Se
    // documenta esta limitación en HEALTH_SETUP.md en vez de fingir mayor
    // precisión de la que la plataforma realmente ofrece.
    await ph.openAppSettings();
  }

  @override
  Future<List<HealthWorkout>> fetchWorkouts({required DateTime since, required DateTime until}) async {
    try {
      final List<HealthDataPoint> points = await _health.getHealthDataFromTypes(
        types: _dataTypes,
        startTime: since,
        endTime: until,
      );

      return points
          .where((HealthDataPoint p) => p.type == HealthDataType.WORKOUT)
          .map(_toHealthWorkout)
          .toList();
    } catch (_) {
      // Un fallo de lectura (incluyendo el caso ambiguo de iOS sin
      // permiso real) se trata como "sin actividades", no como error duro
      // — evita mostrar un mensaje de error alarmante cuando en realidad
      // puede que simplemente no haya entrenamientos en el rango pedido.
      return const <HealthWorkout>[];
    }
  }

  HealthWorkout _toHealthWorkout(HealthDataPoint point) {
    String activityName = 'OTHER';
    final HealthValue value = point.value;
    if (value is WorkoutHealthValue) {
      activityName = value.workoutActivityType.name;
    }

    return HealthWorkout(
      id: point.uuid,
      startTime: point.dateFrom,
      endTime: point.dateTo,
      activityTypeName: activityName,
    );
  }
}
