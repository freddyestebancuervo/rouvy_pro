import 'package:equatable/equatable.dart';

/// Contexto mínimo de una sesión "route-aware" (KORIXA-MVP-VERTICAL-SLICE-01).
///
/// Deliberadamente NO depende de `TrainingRoute` (`routes_catalog`) — ese
/// módulo tiene su propio contrato de dominio (nombre, dificultad,
/// contenido, descripciones) que a `training` no le importa; solo
/// necesita lo mínimo para calcular progreso y guardar de qué ruta se
/// trató. La capa de presentación (`TrainingHudPage`) es quien resuelve
/// el `TrainingRoute` real (vía `routesRepositoryProvider`) y construye
/// este value object — mismo principio de límites de feature ya usado en
/// el resto de la app (`training` tampoco depende de `device_connection`
/// más allá de sus entidades/servicios de dominio).
class RideSessionTarget extends Equatable {
  const RideSessionTarget({
    required this.routeId,
    required this.routeName,
    required this.routeTotalDistanceMeters,
  });

  final String routeId;
  final String routeName;
  final double routeTotalDistanceMeters;

  @override
  List<Object?> get props => [routeId, routeName, routeTotalDistanceMeters];
}
