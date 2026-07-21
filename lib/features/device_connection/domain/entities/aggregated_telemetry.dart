import 'package:equatable/equatable.dart';

/// Vista combinada de TODOS los dispositivos conectados, fusionada en un
/// único estado — esto es lo que consume el HUD de entrenamiento (M2/M4):
/// una sola fuente de verdad de "velocidad actual", sin que la UI tenga
/// que saber de cuántos ni de qué dispositivos viene cada dato.
///
/// La fusión la hace `TelemetryAggregator`: si hay rodillo (FTMS) Y un
/// medidor de potencia dedicado conectados a la vez, se prioriza el
/// medidor de potencia dedicado para `powerWatts` (suele ser más preciso
/// que la estimación del rodillo), pero se usa la velocidad del rodillo
/// (un medidor de potencia de pedales no reporta velocidad).
class AggregatedTelemetry extends Equatable {
  const AggregatedTelemetry({
    this.speedKmh = 0,
    this.powerWatts = 0,
    this.cadenceRpm = 0,
    this.heartRateBpm,
    this.distanceMeters = 0,
    this.caloriesKcal = 0,
    this.elapsedSeconds = 0,
  });

  final double speedKmh;
  final int powerWatts;
  final int cadenceRpm;

  /// `null` (no 0) cuando no hay pulsómetro conectado — 0 bpm sería
  /// engañoso (parecería que el sensor está midiendo un pulso de cero).
  final int? heartRateBpm;

  final double distanceMeters;
  final double caloriesKcal;
  final int elapsedSeconds;

  AggregatedTelemetry copyWith({
    double? speedKmh,
    int? powerWatts,
    int? cadenceRpm,
    int? heartRateBpm,
    double? distanceMeters,
    double? caloriesKcal,
    int? elapsedSeconds,
  }) {
    return AggregatedTelemetry(
      speedKmh: speedKmh ?? this.speedKmh,
      powerWatts: powerWatts ?? this.powerWatts,
      cadenceRpm: cadenceRpm ?? this.cadenceRpm,
      heartRateBpm: heartRateBpm ?? this.heartRateBpm,
      distanceMeters: distanceMeters ?? this.distanceMeters,
      caloriesKcal: caloriesKcal ?? this.caloriesKcal,
      elapsedSeconds: elapsedSeconds ?? this.elapsedSeconds,
    );
  }

  @override
  List<Object?> get props =>
      [speedKmh, powerWatts, cadenceRpm, heartRateBpm, distanceMeters, caloriesKcal, elapsedSeconds];
}
