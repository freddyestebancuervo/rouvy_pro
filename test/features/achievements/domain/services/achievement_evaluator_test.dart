import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/features/achievements/domain/entities/achievement.dart';
import 'package:rouvy_pro/features/achievements/domain/entities/unlocked_achievement.dart';
import 'package:rouvy_pro/features/achievements/domain/services/achievement_evaluator.dart';
import 'package:rouvy_pro/features/training/domain/entities/ride_session_record.dart';
import 'package:rouvy_pro/features/training/domain/entities/statistics_summary.dart';

RideSessionRecord _session({
  required DateTime startTime,
  Duration duration = const Duration(hours: 1),
  double distanceMeters = 20000,
  double caloriesKcal = 500,
}) {
  return RideSessionRecord(
    id: 'session-${startTime.toIso8601String()}',
    startTime: startTime,
    endTime: startTime.add(duration),
    distanceMeters: distanceMeters,
    caloriesKcal: caloriesKcal,
  );
}

void main() {
  group('AchievementEvaluator.evaluate — catálogo completo', () {
    test('devuelve exactamente un resultado por cada logro del catálogo', () {
      final List<UnlockedAchievement> results = AchievementEvaluator.evaluate(
        summary: const StatisticsSummary(),
        sessions: const [],
      );

      expect(results, hasLength(AchievementCatalog.all.length));
    });

    test('con historial vacío, ningún logro está desbloqueado', () {
      final results = AchievementEvaluator.evaluate(summary: const StatisticsSummary(), sessions: const []);

      expect(results.every((UnlockedAchievement r) => !r.isUnlocked), isTrue);
    });
  });

  group('AchievementEvaluator.evaluate — criterios agregados (via StatisticsSummary)', () {
    test('"Primera pedaleada" se desbloquea con 1 sesión total', () {
      final results = AchievementEvaluator.evaluate(
        summary: const StatisticsSummary(totalSessions: 1),
        sessions: const [],
      );

      final UnlockedAchievement firstRide = results.firstWhere((r) => r.achievement.id == 'first_ride');
      expect(firstRide.isUnlocked, isTrue);
    });

    test('"50 km recorridos" NO se desbloquea con 49.9 km acumulados', () {
      final results = AchievementEvaluator.evaluate(
        summary: const StatisticsSummary(totalDistanceMeters: 49900),
        sessions: const [],
      );

      final UnlockedAchievement distance50 = results.firstWhere((r) => r.achievement.id == 'distance_50km');
      expect(distance50.isUnlocked, isFalse);
      expect(distance50.progress, closeTo(0.998, 0.001));
    });

    test('"Una semana completa" usa la racha actual del resumen', () {
      final results = AchievementEvaluator.evaluate(
        summary: const StatisticsSummary(currentStreakDays: 7),
        sessions: const [],
      );

      final UnlockedAchievement streak7 = results.firstWhere((r) => r.achievement.id == 'streak_7');
      expect(streak7.isUnlocked, isTrue);
    });
  });

  group('AchievementEvaluator.evaluate — criterios de una sola sesión', () {
    test('"Century" se desbloquea si ALGUNA sesión individual llegó a 100 km, no la suma', () {
      final sessions = [
        _session(startTime: DateTime(2026, 1, 1), distanceMeters: 60000),
        _session(startTime: DateTime(2026, 1, 2), distanceMeters: 101000), // esta sí llega
        _session(startTime: DateTime(2026, 1, 3), distanceMeters: 40000),
      ];

      final results = AchievementEvaluator.evaluate(
        summary: const StatisticsSummary(totalDistanceMeters: 201000), // suma total, distinta del criterio
        sessions: sessions,
      );

      final UnlockedAchievement century = results.firstWhere((r) => r.achievement.id == 'century_ride');
      expect(century.isUnlocked, isTrue);
      expect(century.currentValue, 101000); // el máximo de una sesión, no la suma
    });

    test('"Más de 2 horas seguidas" evalúa la duración máxima de una sesión', () {
      final sessions = [
        _session(startTime: DateTime(2026, 1, 1), duration: const Duration(minutes: 45)),
        _session(startTime: DateTime(2026, 1, 2), duration: const Duration(hours: 2, minutes: 15)),
      ];

      final results = AchievementEvaluator.evaluate(summary: const StatisticsSummary(), sessions: sessions);

      final UnlockedAchievement endurance = results.firstWhere((r) => r.achievement.id == 'endurance_2h');
      expect(endurance.isUnlocked, isTrue);
    });

    test('progress nunca supera 1.0 aunque el valor exceda por mucho el umbral', () {
      final sessions = [_session(startTime: DateTime(2026, 1, 1), distanceMeters: 300000)];

      final results = AchievementEvaluator.evaluate(summary: const StatisticsSummary(), sessions: sessions);

      final UnlockedAchievement century = results.firstWhere((r) => r.achievement.id == 'century_ride');
      expect(century.progress, 1.0);
    });
  });
}
