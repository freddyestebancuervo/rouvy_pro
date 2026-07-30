import 'package:flutter/material.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/workout.dart';

extension WorkoutTargetTypeUi on WorkoutTargetType {
  String label(AppLocalizations l10n) => switch (this) {
        WorkoutTargetType.power => l10n.workoutTargetTypePower,
        WorkoutTargetType.heartRate => l10n.workoutTargetTypeHeartRate,
        WorkoutTargetType.none => l10n.workoutTargetTypeNone,
      };

  IconData get icon => switch (this) {
        WorkoutTargetType.power => Icons.bolt,
        WorkoutTargetType.heartRate => Icons.favorite,
        WorkoutTargetType.none => Icons.circle_outlined,
      };

  /// Unidad mostrada junto a `targetLow`/`targetHigh` de cada intervalo —
  /// `null` para `none`, que no admite target en absoluto.
  String? get unit => switch (this) {
        WorkoutTargetType.power => '%FTP',
        WorkoutTargetType.heartRate => 'lpm',
        WorkoutTargetType.none => null,
      };

  /// Mismo rango que valida `WorkoutsService` en el backend
  /// (`TARGET_RANGES`) — mantenerlo en un solo lugar en el cliente evita
  /// que el formulario de creación permita algo que el backend va a
  /// rechazar de todas formas.
  (double min, double max)? get targetRange => switch (this) {
        WorkoutTargetType.power => (0, 300),
        WorkoutTargetType.heartRate => (60, 220),
        WorkoutTargetType.none => null,
      };
}

/// Formatea segundos como "1 h 15 min" / "45 min" / "40 s" — pensado para
/// duraciones de entrenamiento (minutos/horas), a diferencia de
/// `DurationFormatter` (mm:ss / hh:mm:ss), pensado para el cronómetro en
/// vivo del HUD de entrenamiento.
String formatWorkoutDuration(int totalSeconds) {
  final int hours = totalSeconds ~/ 3600;
  final int minutes = (totalSeconds % 3600) ~/ 60;
  final int seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? '$hours h $minutes min' : '$hours h';
  }
  if (minutes > 0) {
    return '$minutes min';
  }
  return '$seconds s';
}
