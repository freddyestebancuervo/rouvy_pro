import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/features/training/domain/entities/ride_session_record.dart';
import 'package:rouvy_pro/features/training/domain/entities/statistics_summary.dart';
import 'package:rouvy_pro/features/training/domain/services/statistics_calculator.dart';

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
  final DateTime today = DateTime(2026, 6, 15, 18); // un lunes cualquiera, 18:00

  group('StatisticsCalculator.calculate — caso vacío', () {
    test('una lista vacía devuelve el resumen por defecto, todo en cero', () {
      final StatisticsSummary summary = StatisticsCalculator.calculate(const [], now: today);

      expect(summary, const StatisticsSummary());
    });
  });

  group('StatisticsCalculator.calculate — totales', () {
    test('suma distancia, duración y calorías de todas las sesiones', () {
      final List<RideSessionRecord> sessions = [
        _session(startTime: today, distanceMeters: 20000, caloriesKcal: 500, duration: const Duration(hours: 1)),
        _session(
          startTime: today.subtract(const Duration(days: 1)),
          distanceMeters: 30000,
          caloriesKcal: 700,
          duration: const Duration(hours: 1, minutes: 30),
        ),
      ];

      final StatisticsSummary summary = StatisticsCalculator.calculate(sessions, now: today);

      expect(summary.totalSessions, 2);
      expect(summary.totalDistanceMeters, 50000);
      expect(summary.totalCaloriesKcal, 1200);
      expect(summary.totalDurationSeconds, const Duration(hours: 2, minutes: 30).inSeconds);
    });

    test('averageDistanceMeters se calcula sobre el total de sesiones', () {
      final List<RideSessionRecord> sessions = [
        _session(startTime: today, distanceMeters: 10000),
        _session(startTime: today.subtract(const Duration(days: 1)), distanceMeters: 30000),
      ];

      final StatisticsSummary summary = StatisticsCalculator.calculate(sessions, now: today);

      expect(summary.averageDistanceMeters, 20000);
    });

    test('longestSessionDistanceMeters identifica la sesión más larga, no la suma', () {
      final List<RideSessionRecord> sessions = [
        _session(startTime: today, distanceMeters: 15000),
        _session(startTime: today.subtract(const Duration(days: 1)), distanceMeters: 42000),
        _session(startTime: today.subtract(const Duration(days: 2)), distanceMeters: 8000),
      ];

      final StatisticsSummary summary = StatisticsCalculator.calculate(sessions, now: today);

      expect(summary.longestSessionDistanceMeters, 42000);
    });
  });

  group('StatisticsCalculator.calculate — racha (currentStreakDays)', () {
    test('0 si no hay sesiones', () {
      expect(StatisticsCalculator.calculate(const [], now: today).currentStreakDays, 0);
    });

    test('1 si solo hay sesión hoy', () {
      final summary = StatisticsCalculator.calculate([_session(startTime: today)], now: today);
      expect(summary.currentStreakDays, 1);
    });

    test('cuenta días consecutivos terminando hoy', () {
      final sessions = [
        _session(startTime: today),
        _session(startTime: today.subtract(const Duration(days: 1))),
        _session(startTime: today.subtract(const Duration(days: 2))),
      ];

      expect(StatisticsCalculator.calculate(sessions, now: today).currentStreakDays, 3);
    });

    test('un hueco de un día CORTA la racha en ese punto', () {
      final sessions = [
        _session(startTime: today),
        _session(startTime: today.subtract(const Duration(days: 1))),
        // hueco: sin sesión hace 2 días
        _session(startTime: today.subtract(const Duration(days: 3))),
      ];

      expect(StatisticsCalculator.calculate(sessions, now: today).currentStreakDays, 2);
    });

    test('sigue contando "activa" si la última sesión fue AYER (no rota todavía)', () {
      final sessions = [
        _session(startTime: today.subtract(const Duration(days: 1))),
        _session(startTime: today.subtract(const Duration(days: 2))),
      ];

      expect(StatisticsCalculator.calculate(sessions, now: today).currentStreakDays, 2);
    });

    test('0 si la última sesión fue hace 2+ días (racha rota)', () {
      final sessions = [_session(startTime: today.subtract(const Duration(days: 3)))];

      expect(StatisticsCalculator.calculate(sessions, now: today).currentStreakDays, 0);
    });

    test('varias sesiones el mismo día cuentan como un solo día de racha', () {
      final sessions = [
        _session(startTime: DateTime(2026, 6, 15, 7)),
        _session(startTime: DateTime(2026, 6, 15, 19)),
      ];

      expect(StatisticsCalculator.calculate(sessions, now: today).currentStreakDays, 1);
    });
  });

  group('StatisticsCalculator.calculate — dailyDistanceLast7Days', () {
    test('coloca cada sesión en el índice correcto (6 = hoy, 0 = hace 6 días)', () {
      final sessions = [
        _session(startTime: today, distanceMeters: 10000), // hoy → índice 6
        _session(startTime: today.subtract(const Duration(days: 6)), distanceMeters: 5000), // índice 0
      ];

      final List<double> daily = StatisticsCalculator.calculate(sessions, now: today).dailyDistanceLast7Days;

      expect(daily, hasLength(7));
      expect(daily[6], 10000);
      expect(daily[0], 5000);
      expect(daily[1], 0); // sin sesión ese día
    });

    test('suma varias sesiones del mismo día en el mismo índice', () {
      final sessions = [
        _session(startTime: DateTime(2026, 6, 15, 7), distanceMeters: 10000),
        _session(startTime: DateTime(2026, 6, 15, 19), distanceMeters: 5000),
      ];

      final daily = StatisticsCalculator.calculate(sessions, now: today).dailyDistanceLast7Days;

      expect(daily[6], 15000);
    });

    test('ignora sesiones fuera de la ventana de 7 días', () {
      final sessions = [_session(startTime: today.subtract(const Duration(days: 10)), distanceMeters: 99999)];

      final daily = StatisticsCalculator.calculate(sessions, now: today).dailyDistanceLast7Days;

      expect(daily, everyElement(0));
    });
  });
}
