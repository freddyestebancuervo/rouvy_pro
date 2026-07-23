import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../entities/workout.dart';

/// Un intervalo tal como lo arma la UI de creación — sin `position` (lo
/// asigna el backend a partir del índice, ver `WorkoutsRepository.create`
/// en el backend) y sin distinguir "no definido" de "explícitamente null":
/// si `targetLow`/`targetHigh` son `null` acá, simplemente no se envían.
class WorkoutIntervalInput {
  const WorkoutIntervalInput({
    required this.durationSeconds,
    this.targetLow,
    this.targetHigh,
    this.label,
  });

  final int durationSeconds;
  final double? targetLow;
  final double? targetHigh;
  final String? label;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'durationSeconds': durationSeconds,
        if (targetLow != null) 'targetLow': targetLow,
        if (targetHigh != null) 'targetHigh': targetHigh,
        if (label != null && label!.trim().isNotEmpty) 'label': label!.trim(),
      };
}

class CreateWorkoutParams {
  const CreateWorkoutParams({
    required this.name,
    this.description,
    this.sport = 'cycling',
    required this.targetType,
    this.isPublic = false,
    required this.intervals,
  });

  final String name;
  final String? description;
  final String sport;
  final WorkoutTargetType targetType;
  final bool isPublic;
  final List<WorkoutIntervalInput> intervals;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'name': name,
        if (description != null && description!.trim().isNotEmpty) 'description': description!.trim(),
        'sport': sport,
        'targetType': targetType.raw,
        'isPublic': isPublic,
        'intervals': intervals.map((WorkoutIntervalInput i) => i.toJson()).toList(),
      };
}

/// Solo `name`/`description`/`isPublic` son editables — `sport`,
/// `targetType` e `intervals` son inmutables tras la creación (ver
/// `UpdateWorkoutDto` en el backend). `null` en cualquiera de estos tres
/// campos significa "no tocar", no "vaciar" (mismo criterio `PATCH`
/// parcial que ya usa `ProfileController.updateProfile`).
class UpdateWorkoutParams {
  const UpdateWorkoutParams({this.name, this.description, this.isPublic});

  final String? name;
  final String? description;
  final bool? isPublic;

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (name != null) 'name': name,
        if (description != null) 'description': description,
        if (isPublic != null) 'isPublic': isPublic,
      };
}

abstract class WorkoutsRepository {
  /// `mineOnly: false` incluye catálogo y entrenamientos públicos de otros
  /// usuarios además de los propios — ver `WorkoutsService.isVisible` en el
  /// backend, es la única excepción a "todo es /me" del resto de Bloque D.
  Future<Either<Failure, List<Workout>>> fetchAll({required bool mineOnly});

  Future<Either<Failure, WorkoutDetail>> fetchById(String id);

  Future<Either<Failure, WorkoutDetail>> create(CreateWorkoutParams params);

  Future<Either<Failure, WorkoutDetail>> update(String id, UpdateWorkoutParams params);

  /// Soft-delete idempotente (archivar algo ya archivado no es un error).
  Future<Either<Failure, void>> archive(String id);
}
