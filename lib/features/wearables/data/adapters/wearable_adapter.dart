import '../../domain/entities/external_activity.dart';
import '../../domain/entities/wearable_provider_type.dart';

/// Patrón **Adapter**: cada proveedor (Apple Health, Google Fit, Garmin,
/// Polar, Coros, Suunto) implementa esta misma interfaz con su propia
/// lógica interna — el resto de la app (`WearableRepositoryImpl` y hacia
/// arriba) programa contra esta abstracción, nunca contra un SDK
/// propietario directamente.
///
/// Esto es lo que permite que hoy 2 de los 6 adapters sean reales y 4
/// sean simulados sin que ni el dominio ni la UI necesiten saberlo — y
/// que activar un adapter real más adelante (cuando llegue la
/// aprobación de partner) sea sustituir una clase en
/// `WearableRepositoryImpl`, no reescribir nada aguas arriba.
abstract class WearableAdapter {
  WearableProviderType get providerType;

  /// `true` en los 4 adapters simulados (Garmin/Polar/Coros/Suunto) — la
  /// UI lo usa para mostrar el badge "Requiere aprobación oficial" y
  /// deshabilitar el botón de conectar en vez de dejar que el usuario
  /// intente una conexión que inevitablemente fallaría.
  bool get requiresPartnerApproval;

  /// Solicita los permisos/autorización específicos del proveedor
  /// (HealthKit y Health Connect piden permisos por tipo de dato; Garmin/
  /// Polar/Coros usarían OAuth2 una vez haya credenciales de partner).
  Future<bool> requestAuthorization();

  Future<void> connect();

  Future<void> disconnect();

  Future<bool> get isConnected;

  /// Descarga actividades desde [since] (o un rango por defecto razonable
  /// si es `null`, p. ej. últimos 30 días) y las devuelve ya normalizadas
  /// a [ExternalActivity].
  Future<List<ExternalActivity>> fetchActivities({DateTime? since});
}
