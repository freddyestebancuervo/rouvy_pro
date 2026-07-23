import '../../domain/entities/workout.dart';

class WorkoutIntervalModel extends WorkoutInterval {
  const WorkoutIntervalModel({
    required super.position,
    required super.durationSeconds,
    super.targetLow,
    super.targetHigh,
    super.label,
  });

  factory WorkoutIntervalModel.fromJson(Map<String, dynamic> json) {
    return WorkoutIntervalModel(
      position: json['position'] as int,
      durationSeconds: json['durationSeconds'] as int,
      targetLow: (json['targetLow'] as num?)?.toDouble(),
      targetHigh: (json['targetHigh'] as num?)?.toDouble(),
      label: json['label'] as String?,
    );
  }
}

class WorkoutModel extends Workout {
  const WorkoutModel({
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
  });

  factory WorkoutModel.fromJson(Map<String, dynamic> json) {
    return WorkoutModel(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      sport: json['sport'] as String,
      estimatedDurationSeconds: json['estimatedDurationSeconds'] as int,
      targetType: WorkoutTargetType.fromRaw(json['targetType'] as String),
      isPublic: json['isPublic'] as bool,
      isMine: json['isMine'] as bool,
      archivedAt: json['archivedAt'] == null ? null : DateTime.parse(json['archivedAt'] as String),
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }
}

class WorkoutDetailModel extends WorkoutDetail {
  const WorkoutDetailModel({
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
    required super.intervals,
  });

  factory WorkoutDetailModel.fromJson(Map<String, dynamic> json) {
    final List<dynamic> rawIntervals = json['intervals'] as List<dynamic>? ?? const <dynamic>[];
    return WorkoutDetailModel(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      sport: json['sport'] as String,
      estimatedDurationSeconds: json['estimatedDurationSeconds'] as int,
      targetType: WorkoutTargetType.fromRaw(json['targetType'] as String),
      isPublic: json['isPublic'] as bool,
      isMine: json['isMine'] as bool,
      archivedAt: json['archivedAt'] == null ? null : DateTime.parse(json['archivedAt'] as String),
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      intervals: rawIntervals
          .map((dynamic e) => WorkoutIntervalModel.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
