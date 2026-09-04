import 'package:equatable/equatable.dart';

/// Versión persistida de [RideSessionSummary] — con [id] (asignado por
/// Firestore) y sin el objeto [AggregatedTelemetry] completo, que no
/// tiene sentido serializar tal cual: aquí solo se guardan los campos que
/// de verdad importan para un historial (totales + últimas lecturas de
/// referencia), no el objeto de dominio de `device_connection`.
///
/// Mantener esta entidad separada de `RideSessionSummary` (en vez de
/// reutilizar la misma clase para "sesión recién terminada" y "sesión
/// guardada") evita que el módulo de historial dependa de la forma
/// exacta de `AggregatedTelemetry`, que pertenece a `device_connection` y
/// podría cambiar por motivos ajenos al historial.
class RideSessionRecord extends Equatable {
  const RideSessionRecord({
    required this.id,
    required this.startTime,
    required this.endTime,
    required this.distanceMeters,
    required this.caloriesKcal,
    this.lastPowerWatts,
    this.lastCadenceRpm,
    this.lastHeartRateBpm,
    this.deviceCount = 0,
    this.routeId,
    this.routeName,
    this.routeDistanceMeters,
    this.routeCompleted,
  });

  final String id;
  final DateTime startTime;
  final DateTime endTime;
  final double distanceMeters;
  final double caloriesKcal;

  /// "Última lectura" en vez de promedio/máximo real — el
  /// `TelemetryAggregator` actual no lleva series completas (ver nota en
  /// `RideSessionSummary`). Calcular promedios/máximos de verdad es
  /// trabajo del módulo de Estadísticas (M3), que grabará la serie
  /// completa segundo a segundo en vez de solo el último valor.
  final int? lastPowerWatts;
  final int? lastCadenceRpm;
  final int? lastHeartRateBpm;

  final int deviceCount;

  /// KORIXA-MVP-VERTICAL-SLICE-01 — `null` en los cuatro para una sesión
  /// libre grabada antes (o después) de este slice; registros viejos sin
  /// estos campos en Firestore se parsean igual (ver
  /// `RideSessionRecordModel.fromMap`), nunca fallan por su ausencia.
  final String? routeId;
  final String? routeName;
  final double? routeDistanceMeters;
  final bool? routeCompleted;

  bool get isRouteBacked => routeId != null;

  Duration get duration => endTime.difference(startTime);

  @override
  List<Object?> get props => [
        id,
        startTime,
        endTime,
        distanceMeters,
        caloriesKcal,
        lastPowerWatts,
        lastCadenceRpm,
        lastHeartRateBpm,
        deviceCount,
        routeId,
        routeName,
        routeDistanceMeters,
        routeCompleted,
      ];
}
