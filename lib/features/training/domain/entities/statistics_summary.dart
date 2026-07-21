import 'package:equatable/equatable.dart';

/// Resumen estadístico calculado a partir de una lista de
/// `RideSessionRecord` — no se persiste en ningún lado, se recalcula en
/// el cliente cada vez que cambia el historial (`rideSessionsProvider`).
/// Mantenerlo así de simple es intencional: agregaciones más pesadas
/// (curva de potencia, promedios ponderados por duración) son trabajo
/// del backend objetivo cuando el volumen de sesiones por usuario lo
/// justifique (ver `docs/TECHNICAL_SPECIFICATION_M0_M1.md`, cuello de
/// botella #3) — hoy, con como mucho unas decenas de sesiones recientes
/// cargadas en memoria, calcularlo en el cliente es más que suficiente.
class StatisticsSummary extends Equatable {
  const StatisticsSummary({
    this.totalSessions = 0,
    this.totalDistanceMeters = 0,
    this.totalDurationSeconds = 0,
    this.totalCaloriesKcal = 0,
    this.longestSessionDistanceMeters = 0,
    this.currentStreakDays = 0,
    this.dailyDistanceLast7Days = const <double>[0, 0, 0, 0, 0, 0, 0],
  });

  final int totalSessions;
  final double totalDistanceMeters;
  final int totalDurationSeconds;
  final double totalCaloriesKcal;
  final double longestSessionDistanceMeters;

  /// Días consecutivos (incluyendo hoy si ya hay sesión) con al menos una
  /// sesión registrada — se corta en cuanto encuentra un día sin ninguna.
  final int currentStreakDays;

  /// Distancia total por día de los últimos 7 días, en orden
  /// cronológico (índice 0 = hace 6 días, índice 6 = hoy) — lo que
  /// alimenta el gráfico de barras semanal.
  final List<double> dailyDistanceLast7Days;

  double get averageDistanceMeters => totalSessions == 0 ? 0 : totalDistanceMeters / totalSessions;

  @override
  List<Object?> get props => [
        totalSessions,
        totalDistanceMeters,
        totalDurationSeconds,
        totalCaloriesKcal,
        longestSessionDistanceMeters,
        currentStreakDays,
        dailyDistanceLast7Days,
      ];
}
