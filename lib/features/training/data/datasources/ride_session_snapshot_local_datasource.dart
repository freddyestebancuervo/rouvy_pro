import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Snapshot serializable del estado mínimo necesario para reanudar una
/// sesión de entrenamiento tras un cierre inesperado de la app.
///
/// Deliberadamente NO incluye el `AggregatedTelemetry` completo del
/// dominio de `device_connection` — solo los campos primitivos que hacen
/// falta para reconstruir un resumen razonable si el usuario decide NO
/// reanudar y prefiere simplemente cerrar la sesión con lo que ya tenía
/// acumulado. Reconectar los dispositivos BLE en sí (si estaban
/// conectados) es responsabilidad de `device_connection` al arrancar la
/// app (`restoreKnownDevices`), no de este snapshot.
class RideSessionSnapshotData {
  const RideSessionSnapshotData({
    required this.startTimeIso,
    required this.elapsedSeconds,
    required this.distanceMeters,
    required this.caloriesKcal,
    required this.connectedDeviceCount,
    required this.savedAtIso,
  });

  final String startTimeIso;
  final int elapsedSeconds;
  final double distanceMeters;
  final double caloriesKcal;
  final int connectedDeviceCount;

  /// Cuándo se escribió este snapshot — se usa para descartar
  /// automáticamente snapshots demasiado viejos (ver
  /// `RideSessionSnapshotLocalDataSource.maxRecoverableAge`), en vez de
  /// ofrecer "recuperar" una sesión de hace tres días.
  final String savedAtIso;

  factory RideSessionSnapshotData.fromJson(Map<String, dynamic> json) {
    return RideSessionSnapshotData(
      startTimeIso: json['startTimeIso'] as String,
      elapsedSeconds: json['elapsedSeconds'] as int,
      distanceMeters: (json['distanceMeters'] as num).toDouble(),
      caloriesKcal: (json['caloriesKcal'] as num).toDouble(),
      connectedDeviceCount: json['connectedDeviceCount'] as int,
      savedAtIso: json['savedAtIso'] as String,
    );
  }

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'startTimeIso': startTimeIso,
      'elapsedSeconds': elapsedSeconds,
      'distanceMeters': distanceMeters,
      'caloriesKcal': caloriesKcal,
      'connectedDeviceCount': connectedDeviceCount,
      'savedAtIso': savedAtIso,
    };
  }
}

abstract class RideSessionSnapshotLocalDataSource {
  Future<void> save(RideSessionSnapshotData snapshot);

  /// `null` si no hay snapshot guardado, o si el que hay es más viejo que
  /// [maxRecoverableAge] (se descarta silenciosamente en ese caso, no se
  /// ofrece recuperar algo de hace demasiado tiempo).
  Future<RideSessionSnapshotData?> load();

  Future<void> clear();
}

class RideSessionSnapshotLocalDataSourceImpl implements RideSessionSnapshotLocalDataSource {
  RideSessionSnapshotLocalDataSourceImpl(this._prefs);

  final SharedPreferences _prefs;

  static const String _key = 'active_ride_session_snapshot';

  /// Pasado este tiempo desde el último guardado, un snapshot se considera
  /// obsoleto — recuperar una sesión "activa" de hace más de 3 horas casi
  /// seguro no es lo que el usuario quiere (probablemente cerró la app a
  /// propósito y se olvidó de finalizar, no un cierre inesperado real).
  static const Duration maxRecoverableAge = Duration(hours: 3);

  @override
  Future<void> save(RideSessionSnapshotData snapshot) async {
    await _prefs.setString(_key, jsonEncode(snapshot.toJson()));
  }

  @override
  Future<RideSessionSnapshotData?> load() async {
    final String? raw = _prefs.getString(_key);
    if (raw == null) return null;

    final RideSessionSnapshotData snapshot;
    try {
      snapshot = RideSessionSnapshotData.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      // JSON corrupto (p. ej. de una versión anterior con otro formato) —
      // se descarta en vez de fallar el arranque de la app.
      await clear();
      return null;
    }

    final DateTime savedAt = DateTime.tryParse(snapshot.savedAtIso) ?? DateTime.now();
    if (DateTime.now().difference(savedAt) > maxRecoverableAge) {
      await clear();
      return null;
    }

    return snapshot;
  }

  @override
  Future<void> clear() async {
    await _prefs.remove(_key);
  }
}
