import 'package:equatable/equatable.dart';

import 'telemetry_metric_state.dart';
import 'telemetry_source.dart';

/// Vista combinada de TODOS los dispositivos conectados, fusionada en un
/// único estado — esto es lo que consume el HUD de entrenamiento (M2/M4):
/// una sola fuente de verdad de "velocidad actual", sin que la UI tenga
/// que saber de cuántos ni de qué dispositivos viene cada dato.
///
/// La fusión la hace `TelemetryAggregator` con política explícita por
/// métrica y frescura. Cada campo vivo conserva metadata de la métrica
/// elegida (`*State`) para que la UI y el controlador sepan qué fuente
/// ganó, cuándo se observó y cuándo expira.
class AggregatedTelemetry extends Equatable {
  static const Object _unset = Object();

  const AggregatedTelemetry({
    this.speedKmh = 0,
    this.powerWatts = 0,
    this.cadenceRpm = 0,
    this.heartRateBpm,
    this.distanceMeters = 0,
    this.caloriesKcal = 0,
    this.elapsedSeconds = 0,
    this.speedState,
    this.powerState,
    this.cadenceState,
    this.heartRateState,
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

  final TelemetryMetricState<double>? speedState;
  final TelemetryMetricState<int>? powerState;
  final TelemetryMetricState<int>? cadenceState;
  final TelemetryMetricState<int>? heartRateState;

  TelemetrySourceKind? get speedSource => speedState?.source;
  TelemetrySourceKind? get powerSource => powerState?.source;
  TelemetrySourceKind? get cadenceSource => cadenceState?.source;
  TelemetrySourceKind? get heartRateSource => heartRateState?.source;

  String? get speedSourceId => speedState?.sourceId;
  String? get powerSourceId => powerState?.sourceId;
  String? get cadenceSourceId => cadenceState?.sourceId;
  String? get heartRateSourceId => heartRateState?.sourceId;

  DateTime? get speedObservedAt => speedState?.observedAt;
  DateTime? get powerObservedAt => powerState?.observedAt;
  DateTime? get cadenceObservedAt => cadenceState?.observedAt;
  DateTime? get heartRateObservedAt => heartRateState?.observedAt;

  DateTime? get speedExpiresAt => speedState?.expiresAt;
  DateTime? get powerExpiresAt => powerState?.expiresAt;
  DateTime? get cadenceExpiresAt => cadenceState?.expiresAt;
  DateTime? get heartRateExpiresAt => heartRateState?.expiresAt;

  int? get speedPriority => speedState?.priority;
  int? get powerPriority => powerState?.priority;
  int? get cadencePriority => cadenceState?.priority;
  int? get heartRatePriority => heartRateState?.priority;

  AggregatedTelemetry copyWith({
    double? speedKmh,
    int? powerWatts,
    int? cadenceRpm,
    double? distanceMeters,
    double? caloriesKcal,
    int? elapsedSeconds,
    Object? speedState = _unset,
    Object? powerState = _unset,
    Object? cadenceState = _unset,
    Object? heartRateBpm = _unset,
    Object? heartRateState = _unset,
  }) {
    return AggregatedTelemetry(
      speedKmh: speedKmh ?? this.speedKmh,
      powerWatts: powerWatts ?? this.powerWatts,
      cadenceRpm: cadenceRpm ?? this.cadenceRpm,
      distanceMeters: distanceMeters ?? this.distanceMeters,
      caloriesKcal: caloriesKcal ?? this.caloriesKcal,
      elapsedSeconds: elapsedSeconds ?? this.elapsedSeconds,
      speedState: identical(speedState, _unset) ? this.speedState : speedState as TelemetryMetricState<double>?,
      powerState: identical(powerState, _unset) ? this.powerState : powerState as TelemetryMetricState<int>?,
      cadenceState: identical(cadenceState, _unset) ? this.cadenceState : cadenceState as TelemetryMetricState<int>?,
      heartRateBpm: identical(heartRateBpm, _unset) ? this.heartRateBpm : heartRateBpm as int?,
      heartRateState: identical(heartRateState, _unset) ? this.heartRateState : heartRateState as TelemetryMetricState<int>?,
    );
  }

  @override
  List<Object?> get props =>
      [
        speedKmh,
        powerWatts,
        cadenceRpm,
        heartRateBpm,
        distanceMeters,
        caloriesKcal,
        elapsedSeconds,
        speedState,
        powerState,
        cadenceState,
        heartRateState,
      ];
}
