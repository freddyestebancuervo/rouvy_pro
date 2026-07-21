import 'package:equatable/equatable.dart';

import 'wearable_provider_type.dart';

/// Tipo de actividad, normalizado entre proveedores (cada uno usa su
/// propia taxonomía internamente — p. ej. Garmin distingue "road_biking"
/// vs "indoor_cycling"; aquí se colapsan a lo que a esta app le importa).
enum ExternalActivityType { cycling, running, walking, other }

/// Actividad importada de un wearable, YA normalizada. Cada adapter
/// (`GarminAdapter`, `AppleHealthAdapter`...) es responsable de traducir
/// el formato propietario del proveedor a esta clase — así el resto de la
/// app (estadísticas, logros) nunca necesita saber de dónde vino la
/// actividad ni en qué formato llegó originalmente.
class ExternalActivity extends Equatable {
  const ExternalActivity({
    required this.id,
    required this.provider,
    required this.type,
    required this.startTime,
    required this.durationSeconds,
    this.distanceMeters,
    this.caloriesKcal,
    this.averageHeartRateBpm,
    this.averagePowerWatts,
  });

  /// ID propio del proveedor de origen — se usa para deduplicar si el
  /// usuario también grabó la misma sesión nativamente en la app (ver
  /// nota de "gestión de conflictos" en la documentación de arquitectura
  /// de wearables entregada en el Prompt 2).
  final String id;

  final WearableProviderType provider;
  final ExternalActivityType type;
  final DateTime startTime;
  final int durationSeconds;

  final double? distanceMeters;
  final double? caloriesKcal;
  final int? averageHeartRateBpm;
  final int? averagePowerWatts;

  @override
  List<Object?> get props => [
        id,
        provider,
        type,
        startTime,
        durationSeconds,
        distanceMeters,
        caloriesKcal,
        averageHeartRateBpm,
        averagePowerWatts,
      ];
}
