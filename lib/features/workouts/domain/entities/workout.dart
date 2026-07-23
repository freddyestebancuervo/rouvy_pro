import 'package:equatable/equatable.dart';

/// A qué tipo de objetivo apuntan los intervalos del entrenamiento — fija
/// el rango válido de `targetLow`/`targetHigh` en cada intervalo (ver
/// `WorkoutInterval` y `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md` sección
/// 3): `power` → 0-300 %FTP, `heartRate` → 60-220 lpm, `none` → ningún
/// intervalo puede traer target.
enum WorkoutTargetType {
  power,
  heartRate,
  none;

  static WorkoutTargetType fromRaw(String raw) => switch (raw) {
        'power' => power,
        'heart_rate' => heartRate,
        _ => none,
      };

  String get raw => switch (this) {
        power => 'power',
        heartRate => 'heart_rate',
        none => 'none',
      };
}

/// Un tramo del entrenamiento. Inmutable una vez creado el `Workout` que lo
/// contiene — el backend no ofrece ningún endpoint para editar intervalos
/// sueltos (ver `UpdateWorkoutDto`): cambiar la estructura implica archivar
/// y crear un entrenamiento nuevo.
class WorkoutInterval extends Equatable {
  const WorkoutInterval({
    required this.position,
    required this.durationSeconds,
    this.targetLow,
    this.targetHigh,
    this.label,
  });

  final int position;
  final int durationSeconds;
  final double? targetLow;
  final double? targetHigh;
  final String? label;

  @override
  List<Object?> get props => [position, durationSeconds, targetLow, targetHigh, label];
}

/// Vista resumida de un entrenamiento — lo que devuelve `GET /workouts`
/// (sin `intervals`, para mantener el listado liviano). Ver [WorkoutDetail]
/// para la vista completa (`GET /workouts/:id`, `POST`, `PATCH`).
class Workout extends Equatable {
  const Workout({
    required this.id,
    required this.name,
    required this.description,
    required this.sport,
    required this.estimatedDurationSeconds,
    required this.targetType,
    required this.isPublic,
    required this.isMine,
    required this.archivedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final String? description;
  final String sport;
  final int estimatedDurationSeconds;
  final WorkoutTargetType targetType;
  final bool isPublic;

  /// Calculado por el backend a partir del owner real — evita que el
  /// cliente tenga que comparar IDs de usuario para decidir si mostrar
  /// controles de edición/archivado.
  final bool isMine;

  final DateTime? archivedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  bool get isArchived => archivedAt != null;

  /// Editable/archivable desde la UI solo si es propio Y no está ya
  /// archivado — un entrenamiento de catálogo o de otro usuario nunca
  /// muestra controles de edición, y uno ya archivado no admite más
  /// cambios (backend responde 409 `WORKOUT_ARCHIVED`).
  bool get isEditable => isMine && !isArchived;

  @override
  List<Object?> get props => [
        id,
        name,
        description,
        sport,
        estimatedDurationSeconds,
        targetType,
        isPublic,
        isMine,
        archivedAt,
        createdAt,
        updatedAt,
      ];
}

/// Vista completa de un entrenamiento, con sus intervalos.
class WorkoutDetail extends Workout {
  const WorkoutDetail({
    required super.id,
    required super.name,
    required super.description,
    required super.sport,
    required super.estimatedDurationSeconds,
    required super.targetType,
    required super.isPublic,
    required super.isMine,
    required super.archivedAt,
    required super.createdAt,
    required super.updatedAt,
    required this.intervals,
  });

  final List<WorkoutInterval> intervals;

  @override
  List<Object?> get props => <Object?>[...super.props, intervals];
}
