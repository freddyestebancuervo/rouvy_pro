import '../entities/ride_session_record.dart';
import '../entities/statistics_summary.dart';

/// Calcula `StatisticsSummary` a partir del historial ya cargado en
/// memoria (`rideSessionsProvider`). Se recibe `now` como parámetro (en
/// vez de usar `DateTime.now()` internamente) específicamente para que
/// los tests puedan fijar una fecha exacta — el cálculo de racha
/// (`currentStreakDays`) depende por completo de "qué día es hoy", así
/// que sin este punto de inyección los tests serían frágiles (pasarían
/// o fallarían según qué día se ejecuten).
abstract class StatisticsCalculator {
  static StatisticsSummary calculate(List<RideSessionRecord> sessions, {required DateTime now}) {
    if (sessions.isEmpty) return const StatisticsSummary();

    double totalDistance = 0;
    int totalDuration = 0;
    double totalCalories = 0;
    double longestDistance = 0;

    final Set<DateTime> sessionDates = <DateTime>{};

    for (final RideSessionRecord session in sessions) {
      totalDistance += session.distanceMeters;
      totalDuration += session.duration.inSeconds;
      totalCalories += session.caloriesKcal;
      if (session.distanceMeters > longestDistance) longestDistance = session.distanceMeters;
      sessionDates.add(_dateOnly(session.startTime));
    }

    return StatisticsSummary(
      totalSessions: sessions.length,
      totalDistanceMeters: totalDistance,
      totalDurationSeconds: totalDuration,
      totalCaloriesKcal: totalCalories,
      longestSessionDistanceMeters: longestDistance,
      currentStreakDays: _calculateStreak(sessionDates, now: now),
      dailyDistanceLast7Days: _dailyDistanceLast7Days(sessions, now: now),
    );
  }

  static DateTime _dateOnly(DateTime dt) => DateTime(dt.year, dt.month, dt.day);

  static int _calculateStreak(Set<DateTime> sessionDates, {required DateTime now}) {
    if (sessionDates.isEmpty) return 0;

    final DateTime today = _dateOnly(now);
    final DateTime yesterday = today.subtract(const Duration(days: 1));

    // La racha se considera "rota" si la sesión más reciente no fue hoy
    // ni ayer — un hueco de 2+ días sin entrenar reinicia el contador a
    // cero, aunque haya sesiones más viejas en el historial.
    final DateTime mostRecent = sessionDates.reduce((a, b) => a.isAfter(b) ? a : b);
    if (mostRecent != today && mostRecent != yesterday) return 0;

    int streak = 0;
    DateTime cursor = mostRecent;
    while (sessionDates.contains(cursor)) {
      streak += 1;
      cursor = cursor.subtract(const Duration(days: 1));
    }
    return streak;
  }

  static List<double> _dailyDistanceLast7Days(List<RideSessionRecord> sessions, {required DateTime now}) {
    final DateTime today = _dateOnly(now);
    final List<double> result = List<double>.filled(7, 0);

    for (final RideSessionRecord session in sessions) {
      final DateTime sessionDate = _dateOnly(session.startTime);
      final int daysAgo = today.difference(sessionDate).inDays;
      if (daysAgo < 0 || daysAgo > 6) continue; // fuera de la ventana de 7 días
      final int index = 6 - daysAgo; // índice 6 = hoy, índice 0 = hace 6 días
      result[index] += session.distanceMeters;
    }

    return result;
  }
}
