import '../../features/training/domain/entities/ride_session_record.dart';

/// 6 sesiones simuladas de los últimos 10 días — suficientes para que
/// Estadísticas muestre una racha real, el gráfico semanal tenga datos en
/// varios días, y Logros tenga algunos ya desbloqueados y otros en
/// progreso (no todos en 0%, ni todos desbloqueados — la demo debe verse
/// "a mitad de camino", como un usuario real).
List<RideSessionRecord> buildDemoRideSessionsFixture() {
  final DateTime now = DateTime.now();

  RideSessionRecord session({
    required int daysAgo,
    required int hour,
    required Duration duration,
    required double distanceMeters,
    required double caloriesKcal,
    int? lastPowerWatts,
    int? lastCadenceRpm,
    int? lastHeartRateBpm,
  }) {
    final DateTime start = DateTime(now.year, now.month, now.day, hour).subtract(Duration(days: daysAgo));
    return RideSessionRecord(
      id: 'demo-session-$daysAgo-$hour',
      startTime: start,
      endTime: start.add(duration),
      distanceMeters: distanceMeters,
      caloriesKcal: caloriesKcal,
      lastPowerWatts: lastPowerWatts,
      lastCadenceRpm: lastCadenceRpm,
      lastHeartRateBpm: lastHeartRateBpm,
      deviceCount: 2,
    );
  }

  return <RideSessionRecord>[
    session(
      daysAgo: 0,
      hour: 7,
      duration: const Duration(minutes: 42),
      distanceMeters: 21500,
      caloriesKcal: 480,
      lastPowerWatts: 210,
      lastCadenceRpm: 88,
      lastHeartRateBpm: 148,
    ),
    session(
      daysAgo: 1,
      hour: 18,
      duration: const Duration(hours: 1, minutes: 5),
      distanceMeters: 32000,
      caloriesKcal: 720,
      lastPowerWatts: 195,
      lastCadenceRpm: 85,
      lastHeartRateBpm: 152,
    ),
    session(
      daysAgo: 2,
      hour: 7,
      duration: const Duration(minutes: 35),
      distanceMeters: 18000,
      caloriesKcal: 400,
      lastPowerWatts: 180,
      lastCadenceRpm: 82,
      lastHeartRateBpm: 140,
    ),
    // Hueco intencional en el día 3 — para que la racha demo no sea
    // "perfecta" (más realista, y ejercita el caso de racha cortada).
    session(
      daysAgo: 4,
      hour: 19,
      duration: const Duration(hours: 2, minutes: 10),
      distanceMeters: 68000,
      caloriesKcal: 1550,
      lastPowerWatts: 230,
      lastCadenceRpm: 90,
      lastHeartRateBpm: 160,
    ),
    session(
      daysAgo: 6,
      hour: 8,
      duration: const Duration(minutes: 50),
      distanceMeters: 25000,
      caloriesKcal: 560,
      lastPowerWatts: 200,
      lastCadenceRpm: 86,
      lastHeartRateBpm: 145,
    ),
    session(
      daysAgo: 8,
      hour: 17,
      duration: const Duration(minutes: 28),
      distanceMeters: 14000,
      caloriesKcal: 310,
      lastPowerWatts: 175,
      lastCadenceRpm: 80,
      lastHeartRateBpm: 138,
    ),
  ];
}
