import 'dart:io';

import '../../../../core/error/exceptions.dart';
import '../../../../core/health/health_permission_status.dart';
import '../../../../core/health/health_platform_gateway.dart';
import '../../domain/entities/external_activity.dart';
import '../../domain/entities/wearable_provider_type.dart';
import 'wearable_adapter.dart';

/// Adapter REAL — no requiere aprobación de partner. Implementa tanto
/// Apple Health (iOS, vía HealthKit) como Google Fit (Android, vía Health
/// Connect) delegando TODO el trabajo específico de plataforma al
/// `HealthPlatformGateway` inyectado — este adapter no importa
/// `package:health` ni sabe si detrás hay HealthKit o Health Connect.
///
/// Se modela como una única clase parametrizada por [providerType] (en
/// vez de `AppleHealthAdapter` y `GoogleFitAdapter` separadas) porque la
/// diferencia entre ambos proveedores es un dato, no comportamiento — el
/// gateway ya resuelve internamente qué SDK usar según la plataforma.
class HealthPackageAdapter implements WearableAdapter {
  HealthPackageAdapter({
    required WearableProviderType providerType,
    required HealthPlatformGateway gateway,
    // Inyectable por tests — `Platform.isIOS` de `dart:io` refleja el
    // sistema operativo del HOST que ejecuta el proceso Dart, no un
    // simulador iOS: en una corrida normal de `flutter test` (en
    // Linux/macOS/Windows como máquina de CI/desarrollo) siempre es
    // `false`, así que sin este punto de inyección sería imposible
    // testear la rama "estamos en iOS" de `emptyFetchesHintMessage` —
    // ver `test/features/wearables/data/adapters/health_package_adapter_test.dart`.
    bool Function()? isIOS,
  })  : assert(
          providerType == WearableProviderType.appleHealth ||
              providerType == WearableProviderType.googleFit,
          'HealthPackageAdapter solo es válido para appleHealth o googleFit',
        ),
        _providerType = providerType,
        _gateway = gateway,
        _isIOS = isIOS ?? (() => Platform.isIOS);

  final WearableProviderType _providerType;
  final HealthPlatformGateway _gateway;
  final bool Function() _isIOS;
  bool _authorized = false;

  /// Tarea B3 del roadmap: cuenta cuántas veces SEGUIDAS
  /// `fetchActivities()` devolvió una lista vacía. En iOS esto es
  /// ambiguo por diseño (ver `HealthPermissionStatus` — HealthKit no
  /// revela si el permiso de lectura fue realmente concedido), así que
  /// tras varios intentos vacíos seguidos vale la pena sugerirle al
  /// usuario que revise Ajustes manualmente, en vez de quedarse callado
  /// indefinidamente asumiendo que "simplemente no hay entrenamientos".
  int _consecutiveEmptyFetches = 0;

  @override
  WearableProviderType get providerType => _providerType;

  @override
  bool get requiresPartnerApproval => false;

  @override
  Future<bool> requestAuthorization() async {
    final HealthPermissionStatus status = await _gateway.requestPermissions();
    _authorized = status == HealthPermissionStatus.granted;
    return _authorized;
  }

  @override
  Future<void> connect() async {
    // Si ya se comprobó como concedido antes (p. ej. en una sesión previa
    // de la app), no se vuelve a mostrar el diálogo del sistema — se
    // valida el estado actual primero.
    final HealthPermissionStatus current = await _gateway.checkPermissionStatus();
    if (current == HealthPermissionStatus.granted) {
      _authorized = true;
      return;
    }

    final HealthPermissionStatus requested = await _gateway.requestPermissions();
    _authorized = requested == HealthPermissionStatus.granted;

    if (!_authorized) {
      throw HealthException(_messageFor(requested), status: requested);
    }
  }

  @override
  Future<void> disconnect() async {
    // HealthKit/Health Connect no tienen un "cerrar sesión" — el usuario
    // revoca el acceso desde los ajustes del sistema operativo, no desde
    // la app. Aquí solo se resetea el estado local para que la UI vuelva
    // a mostrar "No conectado" y pida autorización de nuevo si se
    // requiere.
    _authorized = false;
  }

  @override
  Future<bool> get isConnected async => _authorized;

  @override
  Future<List<ExternalActivity>> fetchActivities({DateTime? since}) async {
    if (!_authorized) return const <ExternalActivity>[];

    final DateTime startTime = since ?? DateTime.now().subtract(const Duration(days: 30));
    final workouts = await _gateway.fetchWorkouts(since: startTime, until: DateTime.now());

    if (workouts.isEmpty) {
      _consecutiveEmptyFetches += 1;
    } else {
      _consecutiveEmptyFetches = 0;
    }

    return workouts.map((workout) {
      return ExternalActivity(
        id: workout.id,
        provider: _providerType,
        type: _mapActivityType(workout.activityTypeName),
        startTime: workout.startTime,
        durationSeconds: workout.endTime.difference(workout.startTime).inSeconds,
        distanceMeters: workout.totalDistanceMeters,
        caloriesKcal: workout.totalEnergyBurnedKcal,
      );
    }).toList();
  }

  /// Mensaje sugerido a mostrar en la UI (como texto informativo, NUNCA
  /// como error) cuando conviene apuntar al usuario hacia Ajustes. Solo
  /// aplica a Apple Health en iOS — Health Connect en Android sí confirma
  /// de forma fiable si el permiso está concedido (ver
  /// `HealthPlatformGatewayImpl.checkPermissionStatus`), así que ahí un
  /// resultado vacío repetido probablemente significa, de verdad, "no hay
  /// entrenamientos", sin ambigüedad que aclarar.
  String? get emptyFetchesHintMessage {
    final bool isIosAppleHealth = _providerType == WearableProviderType.appleHealth && _isIOS();
    if (!isIosAppleHealth || _consecutiveEmptyFetches < 3) return null;

    return 'No se encontraron entrenamientos recientes en Apple Health. '
        'Si esperabas verlos aquí, revisa Ajustes → Privacidad y seguridad → '
        'Salud → RidePro y confirma que el acceso está activado.';
  }

  ExternalActivityType _mapActivityType(String activityTypeName) {
    final String name = activityTypeName.toLowerCase();
    if (name.contains('cycling') || name.contains('biking')) return ExternalActivityType.cycling;
    if (name.contains('running')) return ExternalActivityType.running;
    if (name.contains('walking')) return ExternalActivityType.walking;
    return ExternalActivityType.other;
  }

  String _messageFor(HealthPermissionStatus status) {
    final String providerName =
        _providerType == WearableProviderType.appleHealth ? 'Apple Health' : 'Google Fit / Health Connect';
    switch (status) {
      case HealthPermissionStatus.denied:
        return 'Permiso de $providerName denegado. Puedes intentarlo de nuevo.';
      case HealthPermissionStatus.permanentlyDenied:
        return 'Permiso de $providerName denegado permanentemente. Actívalo desde los ajustes del dispositivo.';
      case HealthPermissionStatus.notInstalled:
        return 'Health Connect no está instalado. Instálalo desde Play Store para conectar Google Fit.';
      case HealthPermissionStatus.unavailable:
        return '$providerName no está disponible en este dispositivo.';
      case HealthPermissionStatus.granted:
        return ''; // no se usa: este caso no lanza excepción
    }
  }
}
