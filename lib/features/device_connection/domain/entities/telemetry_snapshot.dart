import 'package:equatable/equatable.dart';

/// Lectura cruda de UN dispositivo en un instante dado. Cada tipo de
/// sensor solo llena los campos que le corresponden (un pulsómetro nunca
/// llena `powerWatts`, por ejemplo) — el resto queda `null`.
///
/// Deliberadamente NO incluye `distanceMeters` ni `caloriesKcal`: esos son
/// valores *acumulados* a lo largo de una sesión, no una lectura
/// instantánea, y se calculan en `TelemetryAggregator` (domain/services)
/// a partir de una secuencia de snapshots — mezclar ambos conceptos en la
/// misma clase haría ambiguo si `distanceMeters` es "desde que empezó la
/// sesión" o "el contador crudo que reporta el sensor".
class TelemetrySnapshot extends Equatable {
  const TelemetrySnapshot({
    required this.deviceId,
    required this.timestamp,
    this.speedKmh,
    this.powerWatts,
    this.cadenceRpm,
    this.heartRateBpm,
  });

  final String deviceId;
  final DateTime timestamp;

  final double? speedKmh;
  final int? powerWatts;
  final int? cadenceRpm;
  final int? heartRateBpm;

  @override
  List<Object?> get props => [deviceId, timestamp, speedKmh, powerWatts, cadenceRpm, heartRateBpm];
}
