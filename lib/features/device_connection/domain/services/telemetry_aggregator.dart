import '../entities/aggregated_telemetry.dart';
import '../entities/telemetry_snapshot.dart';

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
    final Duration elapsed =
        _lastTimestamp == null ? Duration.zero : snapshot.timestamp.difference(_lastTimestamp!);
    final double elapsedSeconds = elapsed.inMilliseconds / 1000;

    double newDistance = _state.distanceMeters;
    double newCalories = _state.caloriesKcal;

    final double effectiveSpeed = snapshot.speedKmh ?? _state.speedKmh;
    if (elapsedSeconds > 0 && elapsedSeconds < 10) {
      // El límite superior de 10s evita saltos irreales de distancia si
      // hubo un hueco largo de desconexión entre snapshots.
      newDistance += (effectiveSpeed / 3.6) * elapsedSeconds;

      final int effectivePower = snapshot.powerWatts ?? _state.powerWatts;
      newCalories += (effectivePower * elapsedSeconds) / 1000;
    }

    _state = _state.copyWith(
      speedKmh: snapshot.speedKmh,
      powerWatts: snapshot.powerWatts,
      cadenceRpm: snapshot.cadenceRpm,
      heartRateBpm: snapshot.heartRateBpm,
      distanceMeters: newDistance,
      caloriesKcal: newCalories,
      elapsedSeconds: _state.elapsedSeconds + elapsedSeconds.round(),
    );
    _lastTimestamp = snapshot.timestamp;

    return _state;
  }

  void reset() {
    _state = const AggregatedTelemetry();
    _lastTimestamp = null;
  }
}
