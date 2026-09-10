import 'package:equatable/equatable.dart';

import 'telemetry_source.dart';

/// Lectura cruda de UN dispositivo en un instante dado. Cada tipo de
/// sensor solo llena los campos que le corresponden (un pulsómetro nunca
/// llena `powerWatts`, por ejemplo) — el resto queda `null`.
///
/// `source` identifica el origen normalizado de la lectura (FTMS, CSC,
/// Cycling Power, Heart Rate, demo...), mientras que `deviceId` identifica
/// el dispositivo físico concreto que la produjo.
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
    required this.source,
    required this.timestamp,
    this.speedKmh,
    this.powerWatts,
    this.cadenceRpm,
    this.heartRateBpm,
  });

  final String deviceId;
  final TelemetrySourceKind source;
  final DateTime timestamp;

  final double? speedKmh;
  final int? powerWatts;
  final int? cadenceRpm;
  final int? heartRateBpm;

  @override
  List<Object?> get props => [deviceId, source, timestamp, speedKmh, powerWatts, cadenceRpm, heartRateBpm];
}
