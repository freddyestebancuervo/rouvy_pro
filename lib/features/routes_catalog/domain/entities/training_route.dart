import 'package:equatable/equatable.dart';

enum RouteDifficulty { easy, moderate, hard, extreme }

/// `video`/`terrain3d`: contenido audiovisual sincronizado que **no existe
/// todavía** — hoy son solo una etiqueta descriptiva sobre las 6 entradas
/// fijas de `RoutesMockDataSource`, sin ningún video ni motor 3D real
/// detrás (ver KORIXA-MVP-ROUTEFIRST-01, hallazgo de auditoría
/// independiente: esas 6 entradas no deben presentarse como prueba de un
/// contenido real).
///
/// `staticRoute`: lo único honesto de representar hoy — una ruta con
/// distancia/desnivel fijos, sin ningún contenido audiovisual ni de
/// terreno generado asociado. Es el tipo que usa la ruta MVP de Route-First
/// (KORIXA-MVP-VERTICAL-SLICE-01) para no reclamar un video/3D que no
/// existe mientras sigue probando el progreso real de una ride.
enum RouteContentType { video, terrain3d, staticRoute }

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
