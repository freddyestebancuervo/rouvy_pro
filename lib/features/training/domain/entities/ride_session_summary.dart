import 'package:equatable/equatable.dart';

import '../../../device_connection/domain/entities/aggregated_telemetry.dart';

/// Snapshot final de una sesión — se construye una sola vez, al pulsar
/// "Finalizar", a partir del último [AggregatedTelemetry] acumulado por el
/// `TelemetryAggregator` de `device_connection`.
///
/// Deliberadamente NO incluye promedios/máximos ni potencia normalizada
/// todavía (ver `documento-funcional...` sección de Estadísticas, M3): el
/// `TelemetryAggregator` actual solo lleva el acumulado de distancia y
/// calorías, no series completas — calcular potencia normalizada requiere
/// guardar la serie de watts segundo a segundo, que es precisamente el
/// trabajo del módulo de Estadísticas, no de este HUD en vivo.
class RideSessionSummary extends Equatable {
  const RideSessionSummary({
    required this.startTime,
    required this.endTime,
    required this.finalTelemetry,
    required this.connectedDeviceCount,
    this.routeId,
    this.routeName,
    this.routeTotalDistanceMeters,
    this.routeCompleted,
  });

  final DateTime startTime;
  final DateTime endTime;
  final AggregatedTelemetry finalTelemetry;

  /// Cuántos dispositivos aportaron datos durante la sesión — se muestra
  /// en el resumen para que el usuario entienda por qué, p. ej., no hay
  /// dato de frecuencia cardíaca si entrenó sin pulsómetro.
  final int connectedDeviceCount;

  /// KORIXA-MVP-VERTICAL-SLICE-01 — `null` en los tres (`routeId`,
  /// `routeName`, `routeTotalDistanceMeters`) para una sesión libre (sin
  /// ruta), nunca solo alguno — `RideSessionController.finish()` los
  /// fija juntos a partir de un mismo `RideSessionTarget` o los deja los
  /// tres sin definir.
  final String? routeId;
  final String? routeName;
  final double? routeTotalDistanceMeters;

  /// `null` para una sesión libre (no aplica). `true` solo cuando la
  /// distancia acumulada alcanzó `routeTotalDistanceMeters` en el
  /// momento de finalizar (automático o manual); `false` si se finalizó
  /// antes de llegar al 100%.
  final bool? routeCompleted;

  bool get isRouteBacked => routeId != null;

  Duration get duration => endTime.difference(startTime);

  @override
  List<Object?> get props => [
        startTime,
        endTime,
        finalTelemetry,
        connectedDeviceCount,
        routeId,
        routeName,
        routeTotalDistanceMeters,
        routeCompleted,
      ];
}
