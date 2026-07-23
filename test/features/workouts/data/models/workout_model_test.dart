import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/features/workouts/data/models/workout_model.dart';
import 'package:rouvy_pro/features/workouts/domain/entities/workout.dart';

void main() {
  group('WorkoutModel.fromJson', () {
    test('mapea todos los campos, incluyendo archivedAt null', () {
      final WorkoutModel model = WorkoutModel.fromJson(const <String, dynamic>{
        'id': 'workout-1',
        'name': 'Series de umbral',
        'description': null,
        'sport': 'cycling',
        'estimatedDurationSeconds': 1800,
        'targetType': 'power',
        'isPublic': false,
        'isMine': true,
        'archivedAt': null,
        'createdAt': '2026-01-10T08:00:00.000Z',
        'updatedAt': '2026-01-10T08:00:00.000Z',
      });

      expect(model.id, 'workout-1');
      expect(model.name, 'Series de umbral');
      expect(model.targetType, WorkoutTargetType.power);
      expect(model.isMine, isTrue);
      expect(model.archivedAt, isNull);
      expect(model.isArchived, isFalse);
    });

    test('mapea archivedAt cuando viene con fecha', () {
      final WorkoutModel model = WorkoutModel.fromJson(const <String, dynamic>{
        'id': 'workout-2',
        'name': 'Archivado',
        'description': null,
        'sport': 'cycling',
        'estimatedDurationSeconds': 600,
        'targetType': 'none',
        'isPublic': false,
        'isMine': true,
        'archivedAt': '2026-02-01T00:00:00.000Z',
        'createdAt': '2026-01-10T08:00:00.000Z',
        'updatedAt': '2026-02-01T00:00:00.000Z',
      });

      expect(model.isArchived, isTrue);
      expect(model.targetType, WorkoutTargetType.none);
    });
  });

  group('WorkoutDetailModel.fromJson', () {
    test('mapea los intervalos, convirtiendo targetLow/targetHigh de num a double', () {
      final WorkoutDetailModel model = WorkoutDetailModel.fromJson(const <String, dynamic>{
        'id': 'workout-1',
        'name': 'Con intervalos',
        'description': 'desc',
        'sport': 'cycling',
        'estimatedDurationSeconds': 900,
        'targetType': 'heart_rate',
        'isPublic': true,
        'isMine': false,
        'archivedAt': null,
        'createdAt': '2026-01-10T08:00:00.000Z',
        'updatedAt': '2026-01-10T08:00:00.000Z',
        'intervals': <Map<String, dynamic>>[
          <String, dynamic>{
            'position': 0,
            'durationSeconds': 600,
            'targetLow': 120,
            'targetHigh': 140,
            'label': 'Calentamiento',
          },
          <String, dynamic>{
            'position': 1,
            'durationSeconds': 300,
            'targetLow': null,
            'targetHigh': null,
            'label': null,
          },
        ],
      });

      expect(model.intervals, hasLength(2));
      expect(model.intervals[0].targetLow, 120.0);
      expect(model.intervals[0].targetHigh, 140.0);
      expect(model.intervals[1].targetLow, isNull);
      expect(model.intervals[1].label, isNull);
    });

    test('mapea una lista de intervalos vacía si el campo no viene', () {
      final WorkoutDetailModel model = WorkoutDetailModel.fromJson(const <String, dynamic>{
        'id': 'workout-3',
        'name': 'Sin intervalos en el payload',
        'description': null,
        'sport': 'cycling',
        'estimatedDurationSeconds': 0,
        'targetType': 'none',
        'isPublic': false,
        'isMine': true,
        'archivedAt': null,
        'createdAt': '2026-01-10T08:00:00.000Z',
        'updatedAt': '2026-01-10T08:00:00.000Z',
      });

      expect(model.intervals, isEmpty);
    });
  });

  group('WorkoutTargetType', () {
    test('fromRaw/raw hacen round-trip para los 3 valores', () {
      for (final WorkoutTargetType type in WorkoutTargetType.values) {
        expect(WorkoutTargetType.fromRaw(type.raw), type);
      }
    });

    test('fromRaw cae a "none" ante un valor desconocido', () {
      expect(WorkoutTargetType.fromRaw('algo-inventado'), WorkoutTargetType.none);
    });
  });

  group('Workout.isEditable', () {
    Workout buildWorkout({required bool isMine, DateTime? archivedAt}) {
      final DateTime now = DateTime(2026, 1, 10);
      return Workout(
        id: 'w1',
        name: 'x',
        description: null,
        sport: 'cycling',
        estimatedDurationSeconds: 600,
        targetType: WorkoutTargetType.none,
        isPublic: false,
        isMine: isMine,
        archivedAt: archivedAt,
        createdAt: now,
        updatedAt: now,
      );
    }

    test('es editable si es propio y no está archivado', () {
      expect(buildWorkout(isMine: true).isEditable, isTrue);
    });

    test('no es editable si no es propio', () {
      expect(buildWorkout(isMine: false).isEditable, isFalse);
    });

    test('no es editable si está archivado, aunque sea propio', () {
      expect(buildWorkout(isMine: true, archivedAt: DateTime(2026, 2, 1)).isEditable, isFalse);
    });
  });
}
