import 'package:equatable/equatable.dart';

/// Qué métrica evalúa el criterio de desbloqueo — mantenerlo como enum
/// (en vez de una función arbitraria por logro) es lo que permite que
/// `AchievementEvaluator` sea una única función pura y testeable en vez
/// de un `if/else` distinto por cada logro nuevo que se agregue.
enum AchievementCriterion {
  totalDistanceMeters,
  totalSessions,
  streakDays,
  singleSessionDistanceMeters,
  singleSessionDurationSeconds,
  singleSessionCalories,
}

/// Definición ESTÁTICA de un logro — el catálogo completo vive en
/// `AchievementCatalog.all`, no en una base de datos. Añadir un logro
/// nuevo es agregar una entrada a esa lista, sin tocar Firestore ni
/// ningún backend — coherente con que todo esto se calcula localmente a
/// partir del historial ya cargado (ver `AchievementEvaluator`).
class Achievement extends Equatable {
  const Achievement({
    required this.id,
    required this.titleEs,
    required this.titleEn,
    required this.criterion,
    required this.threshold,
  });

  final String id;
  final String titleEs;
  final String titleEn;
  final AchievementCriterion criterion;

  /// Unidad depende de [criterion] — metros para los de distancia,
  /// segundos para los de duración, kcal para los de calorías, número
  /// entero simple para sesiones/racha.
  final double threshold;

  @override
  List<Object?> get props => [id, titleEs, titleEn, criterion, threshold];
}

/// Catálogo completo — 10 logros cubriendo las categorías descritas en el
/// documento funcional original (distancia acumulada, consistencia,
/// rendimiento en una sola sesión). Deliberadamente en español/inglés
/// embebidos aquí (no vía `AppLocalizations`) porque `Achievement` es una
/// entidad de DOMINIO — no puede depender de `BuildContext`; la pantalla
/// elige `titleEs`/`titleEn` según el locale activo al momento de
/// mostrarlo.
abstract class AchievementCatalog {
  static const List<Achievement> all = <Achievement>[
    Achievement(
      id: 'first_ride',
      titleEs: 'Primera pedaleada',
      titleEn: 'First ride',
      criterion: AchievementCriterion.totalSessions,
      threshold: 1,
    ),
    Achievement(
      id: 'distance_50km',
      titleEs: '50 km recorridos',
      titleEn: '50 km ridden',
      criterion: AchievementCriterion.totalDistanceMeters,
      threshold: 50000,
    ),
    Achievement(
      id: 'distance_250km',
      titleEs: '250 km recorridos',
      titleEn: '250 km ridden',
      criterion: AchievementCriterion.totalDistanceMeters,
      threshold: 250000,
    ),
    Achievement(
      id: 'distance_1000km',
      titleEs: '1.000 km recorridos',
      titleEn: '1,000 km ridden',
      criterion: AchievementCriterion.totalDistanceMeters,
      threshold: 1000000,
    ),
    Achievement(
      id: 'sessions_10',
      titleEs: '10 sesiones completadas',
      titleEn: '10 sessions completed',
      criterion: AchievementCriterion.totalSessions,
      threshold: 10,
    ),
    Achievement(
      id: 'sessions_50',
      titleEs: '50 sesiones completadas',
      titleEn: '50 sessions completed',
      criterion: AchievementCriterion.totalSessions,
      threshold: 50,
    ),
    Achievement(
      id: 'streak_3',
      titleEs: '3 días seguidos',
      titleEn: '3 days in a row',
      criterion: AchievementCriterion.streakDays,
      threshold: 3,
    ),
    Achievement(
      id: 'streak_7',
      titleEs: 'Una semana completa',
      titleEn: 'A full week',
      criterion: AchievementCriterion.streakDays,
      threshold: 7,
    ),
    Achievement(
      id: 'century_ride',
      titleEs: 'Century — 100 km en una sola sesión',
      titleEn: 'Century — 100 km in one session',
      criterion: AchievementCriterion.singleSessionDistanceMeters,
      threshold: 100000,
    ),
    Achievement(
      id: 'endurance_2h',
      titleEs: 'Más de 2 horas seguidas',
      titleEn: 'Over 2 hours straight',
      criterion: AchievementCriterion.singleSessionDurationSeconds,
      threshold: 7200,
    ),
  ];
}
