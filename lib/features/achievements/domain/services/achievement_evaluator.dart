import '../../../training/domain/entities/ride_session_record.dart';
import '../../../training/domain/entities/statistics_summary.dart';
import '../entities/achievement.dart';
import '../entities/unlocked_achievement.dart';

/// Evalúa `AchievementCatalog.all` contra el historial actual.
///
/// Reutiliza deliberadamente `StatisticsSummary` (ya calculado por
/// `StatisticsCalculator` para la pantalla de Estadísticas) para los
/// criterios agregados (distancia/sesiones/racha totales) en vez de
/// volver a recorrer la lista de sesiones — evita calcular lo mismo dos
/// veces. Los criterios "en una sola sesión" (century, resistencia) sí
/// necesitan la lista completa, porque son un máximo por sesión
/// individual, no un total.
abstract class AchievementEvaluator {
  static List<UnlockedAchievement> evaluate({
    required StatisticsSummary summary,
    required List<RideSessionRecord> sessions,
  }) {
    return AchievementCatalog.all.map((Achievement achievement) {
      final double currentValue = _currentValueFor(achievement.criterion, summary, sessions);
      final double progress =
          achievement.threshold == 0 ? 1.0 : (currentValue / achievement.threshold).clamp(0.0, 1.0);

      return UnlockedAchievement(
        achievement: achievement,
        isUnlocked: currentValue >= achievement.threshold,
        progress: progress,
        currentValue: currentValue,
      );
    }).toList(growable: false);
  }

  static double _currentValueFor(
    AchievementCriterion criterion,
    StatisticsSummary summary,
    List<RideSessionRecord> sessions,
  ) {
    switch (criterion) {
      case AchievementCriterion.totalDistanceMeters:
        return summary.totalDistanceMeters;
      case AchievementCriterion.totalSessions:
        return summary.totalSessions.toDouble();
      case AchievementCriterion.streakDays:
        return summary.currentStreakDays.toDouble();
      case AchievementCriterion.singleSessionDistanceMeters:
        return _maxOf(sessions, (RideSessionRecord s) => s.distanceMeters);
      case AchievementCriterion.singleSessionDurationSeconds:
        return _maxOf(sessions, (RideSessionRecord s) => s.duration.inSeconds.toDouble());
      case AchievementCriterion.singleSessionCalories:
        return _maxOf(sessions, (RideSessionRecord s) => s.caloriesKcal);
    }
  }

  static double _maxOf(List<RideSessionRecord> sessions, double Function(RideSessionRecord) selector) {
    if (sessions.isEmpty) return 0;
    return sessions.map(selector).reduce((double a, double b) => a > b ? a : b);
  }
}
