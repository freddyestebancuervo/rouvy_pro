import 'package:equatable/equatable.dart';

import 'achievement.dart';

/// Resultado de evaluar UN [Achievement] contra el historial actual —
/// incluye [progress] (0.0 a 1.0) incluso para los bloqueados, para que
/// la UI pueda mostrar una barra de progreso ("32/50 sesiones") en vez de
/// un simple candado sin contexto.
class UnlockedAchievement extends Equatable {
  const UnlockedAchievement({
    required this.achievement,
    required this.isUnlocked,
    required this.progress,
    required this.currentValue,
  });

  final Achievement achievement;
  final bool isUnlocked;

  /// Clampeado a [0.0, 1.0] — nunca supera el 100% aunque el usuario haya
  /// superado el umbral por mucho.
  final double progress;

  /// Valor actual crudo (metros, sesiones, días...) — la UI lo formatea
  /// según `achievement.criterion` (km vs. número entero vs. horas).
  final double currentValue;

  @override
  List<Object?> get props => [achievement, isUnlocked, progress, currentValue];
}
