import '../entities/aggregated_telemetry.dart';
import '../entities/telemetry_metric_state.dart';
import '../entities/telemetry_snapshot.dart';
import '../entities/telemetry_source.dart';

/// Fusiona los snapshots de N dispositivos conectados en un único
/// [AggregatedTelemetry] — la fuente que consume el HUD de entrenamiento.
///
/// Es una clase con estado (no una función pura) porque **integrar**
/// distancia y calorías requiere recordar cuánto tiempo pasó desde la
/// última lectura. Se instancia UNA vez por sesión de entrenamiento (la
/// crea el controller de presentación al iniciar el HUD) y se descarta al
/// terminar — por eso expone [reset].
///
/// Supuestos de cálculo, documentados aquí porque son decisiones de
/// producto, no solo de código:
/// - **Distancia:** `metros += (velocidad_kmh / 3.6) * segundos_transcurridos`
///   desde la última lectura de velocidad recibida (integración simple,
///   no trapezoidal — suficiente dado que las notificaciones BLE llegan
///   ~1 vez por segundo).
/// - **Calorías:** se usa la aproximación estándar de la industria del
///   ciclismo (la misma que usan Garmin/Strava): el trabajo mecánico en
///   kilojulios (`potencia_watts * segundos / 1000`) se toma
///   aproximadamente 1:1 como kilocalorías metabólicas, lo que
///   implícitamente asume una eficiencia humana de pedaleo de ~24% (esa
///   es la razón por la que 1 kJ de trabajo mecánico ≈ 1 kcal
///   metabólica, no una coincidencia). No es exacto a nivel individual
///   (varía con la eficiencia real del ciclista), pero es el estándar de
///   referencia que los usuarios esperan ver.
class TelemetryAggregator {
  AggregatedTelemetry _state = const AggregatedTelemetry();
  DateTime? _lastTimestamp;

  static const Duration _speedFreshness = Duration(seconds: 3);
  static const Duration _powerFreshness = Duration(seconds: 3);
  static const Duration _cadenceFreshness = Duration(seconds: 5);
  static const Duration _heartRateFreshness = Duration(seconds: 10);

  AggregatedTelemetry get currentState => _state;

  /// Restaura el acumulado (distancia/calorías) a partir de un valor
  /// conocido, SIN tocar `_lastTimestamp` — el próximo `ingest()` sigue
  /// integrando hacia adelante desde aquí, como si nunca se hubiera
  /// interrumpido. Se usa exclusivamente para recuperar una sesión tras un
  /// cierre inesperado de la app (ver `RideSessionController.resumeFromSnapshot`,
  /// tarea B1 del roadmap) — nunca durante el flujo normal de una sesión.
  void seed(AggregatedTelemetry initial) {
    _state = initial;
  }

  /// Aplica un nuevo snapshot de UN dispositivo al estado combinado y
  /// devuelve el nuevo [AggregatedTelemetry]. Los campos que el snapshot
  /// no trae (porque ese dispositivo no los mide) se conservan del estado
  /// anterior — así, con dos dispositivos conectados (p. ej. rodillo +
  /// pulsómetro), cada uno "aporta" sus campos sin pisar los del otro.
  AggregatedTelemetry ingest(TelemetrySnapshot snapshot) {
    _state = _expireStaleMetrics(snapshot.timestamp);

    final Duration elapsed =
        _lastTimestamp == null ? Duration.zero : snapshot.timestamp.difference(_lastTimestamp!);
    final double elapsedSeconds = elapsed.inMilliseconds / 1000;

    double newDistance = _state.distanceMeters;
    double newCalories = _state.caloriesKcal;

    final double effectiveSpeed = snapshot.speedKmh ?? _state.speedKmh;
    if (elapsedSeconds > 0 && elapsedSeconds <= 10) {
      // El límite superior de 10s evita saltos irreales de distancia si
      // hubo un hueco largo de desconexión entre snapshots.
      newDistance += (effectiveSpeed / 3.6) * elapsedSeconds;

      final int effectivePower = snapshot.powerWatts ?? _state.powerWatts;
      newCalories += (effectivePower * elapsedSeconds) / 1000;
    }

    final TelemetryMetricState<double>? speedState = _selectMetric<double>(
      current: _state.speedState,
      candidateValue: snapshot.speedKmh,
      snapshot: snapshot,
      freshnessWindow: _speedFreshness,
      priorityFor: _speedPriority,
    );
    final TelemetryMetricState<int>? powerState = _selectMetric<int>(
      current: _state.powerState,
      candidateValue: snapshot.powerWatts,
      snapshot: snapshot,
      freshnessWindow: _powerFreshness,
      priorityFor: _powerPriority,
    );
    final TelemetryMetricState<int>? cadenceState = _selectMetric<int>(
      current: _state.cadenceState,
      candidateValue: snapshot.cadenceRpm,
      snapshot: snapshot,
      freshnessWindow: _cadenceFreshness,
      priorityFor: _cadencePriority,
    );
    final TelemetryMetricState<int>? heartRateState = _selectMetric<int>(
      current: _state.heartRateState,
      candidateValue: snapshot.heartRateBpm,
      snapshot: snapshot,
      freshnessWindow: _heartRateFreshness,
      priorityFor: _heartRatePriority,
    );

    _state = _state.copyWith(
      speedKmh: speedState?.value ?? _state.speedKmh,
      powerWatts: powerState?.value ?? _state.powerWatts,
      cadenceRpm: cadenceState?.value ?? _state.cadenceRpm,
      heartRateBpm: heartRateState?.value ?? _state.heartRateBpm,
      distanceMeters: newDistance,
      caloriesKcal: newCalories,
      elapsedSeconds: _state.elapsedSeconds + elapsedSeconds.round(),
      speedState: speedState,
      powerState: powerState,
      cadenceState: cadenceState,
      heartRateState: heartRateState,
    );
    _lastTimestamp = snapshot.timestamp;

    return _state;
  }

  void removeSource(String sourceId) {
    _state = _state.copyWith(
      speedKmh: _state.speedSourceId == sourceId ? 0 : _state.speedKmh,
      powerWatts: _state.powerSourceId == sourceId ? 0 : _state.powerWatts,
      cadenceRpm: _state.cadenceSourceId == sourceId ? 0 : _state.cadenceRpm,
      heartRateBpm: _state.heartRateSourceId == sourceId ? null : _state.heartRateBpm,
      speedState: _state.speedSourceId == sourceId ? null : _state.speedState,
      powerState: _state.powerSourceId == sourceId ? null : _state.powerState,
      cadenceState: _state.cadenceSourceId == sourceId ? null : _state.cadenceState,
      heartRateState: _state.heartRateSourceId == sourceId ? null : _state.heartRateState,
    );
  }

  AggregatedTelemetry _expireStaleMetrics(DateTime now) {
    return _state.copyWith(
      speedKmh: _isFresh(_state.speedState, now) ? _state.speedKmh : 0,
      powerWatts: _isFresh(_state.powerState, now) ? _state.powerWatts : 0,
      cadenceRpm: _isFresh(_state.cadenceState, now) ? _state.cadenceRpm : 0,
      heartRateBpm: _isFresh(_state.heartRateState, now) ? _state.heartRateBpm : null,
      speedState: _isFresh(_state.speedState, now) ? _state.speedState : null,
      powerState: _isFresh(_state.powerState, now) ? _state.powerState : null,
      cadenceState: _isFresh(_state.cadenceState, now) ? _state.cadenceState : null,
      heartRateState: _isFresh(_state.heartRateState, now) ? _state.heartRateState : null,
    );
  }

  bool _isFresh<T>(TelemetryMetricState<T>? state, DateTime now) => state?.isFreshAt(now) ?? false;

  TelemetryMetricState<T>? _selectMetric<T>({
    required TelemetryMetricState<T>? current,
    required T? candidateValue,
    required TelemetrySnapshot snapshot,
    required Duration freshnessWindow,
    required int Function(TelemetrySourceKind source) priorityFor,
  }) {
    if (candidateValue == null) return current;

    final TelemetryMetricState<T> candidate = TelemetryMetricState<T>(
      value: candidateValue,
      source: snapshot.source,
      sourceId: snapshot.deviceId,
      observedAt: snapshot.timestamp,
      priority: priorityFor(snapshot.source),
      freshnessWindow: freshnessWindow,
    );

    if (current == null) return candidate;
    if (current.sourceId == candidate.sourceId) {
      return candidate.observedAt.isAfter(current.observedAt) ? candidate : current;
    }

    if (candidate.priority > current.priority) return candidate;
    if (candidate.priority == current.priority && candidate.observedAt.isAfter(current.observedAt)) {
      return candidate;
    }

    return current;
  }

  int _speedPriority(TelemetrySourceKind source) => switch (source) {
        TelemetrySourceKind.ftms => 3,
        TelemetrySourceKind.cyclingPower => 2,
        TelemetrySourceKind.demo => 1,
        _ => 0,
      };

  int _powerPriority(TelemetrySourceKind source) => switch (source) {
        TelemetrySourceKind.cyclingPower => 3,
        TelemetrySourceKind.ftms => 2,
        TelemetrySourceKind.demo => 1,
        _ => 0,
      };

  int _cadencePriority(TelemetrySourceKind source) => switch (source) {
        TelemetrySourceKind.cyclingPower => 3,
        TelemetrySourceKind.csc => 2,
        TelemetrySourceKind.ftms => 1,
        TelemetrySourceKind.demo => 1,
        _ => 0,
      };

  int _heartRatePriority(TelemetrySourceKind source) => switch (source) {
        TelemetrySourceKind.heartRate => 3,
        TelemetrySourceKind.ftms => 2,
        TelemetrySourceKind.demo => 1,
        _ => 0,
      };

  void reset() {
    _state = const AggregatedTelemetry();
    _lastTimestamp = null;
  }
}
