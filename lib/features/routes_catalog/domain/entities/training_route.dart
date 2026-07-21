import 'package:equatable/equatable.dart';

enum RouteDifficulty { easy, moderate, hard, extreme }

enum RouteContentType { video, terrain3d }

/// Entidad de dominio del catálogo de rutas — a diferencia de
/// `auth`/`device_connection`/`training`/`wearables`, este módulo **no
/// tiene todavía ninguna implementación real** (ni Firestore, ni backend
/// propio) — es el primer feature de M4 (ver `docs/TECHNICAL_SPECIFICATION_M0_M1.md`
/// y el plan de desarrollo general) y hoy solo existe como UI navegable
/// con datos fijos (`RoutesMockDataSource`). Cuando se diseñe el backend
/// real de rutas, esta entidad es el contrato que debería mantenerse
/// estable mientras cambia la implementación por debajo — mismo patrón
/// que ya se usó para desacoplar Firebase en el resto de la app.
class TrainingRoute extends Equatable {
  const TrainingRoute({
    required this.id,
    required this.name,
    required this.distanceMeters,
    required this.elevationGainMeters,
    required this.difficulty,
    required this.contentType,
    required this.descriptionEs,
    required this.descriptionEn,
    this.locationName,
  });

  final String id;
  final String name;
  final double distanceMeters;
  final double elevationGainMeters;
  final RouteDifficulty difficulty;
  final RouteContentType contentType;
  final String descriptionEs;
  final String descriptionEn;

  /// `null` para rutas 3D genéricas sin ubicación real asociada.
  final String? locationName;

  @override
  List<Object?> get props => [
        id,
        name,
        distanceMeters,
        elevationGainMeters,
        difficulty,
        contentType,
        descriptionEs,
        descriptionEn,
        locationName,
      ];
}
