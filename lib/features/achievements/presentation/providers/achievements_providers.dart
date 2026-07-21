import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../training/domain/entities/ride_session_record.dart';
import '../../../training/domain/entities/statistics_summary.dart';
import '../../../training/presentation/providers/ride_history_providers.dart';
import '../../../training/presentation/providers/statistics_providers.dart';
import '../../domain/entities/unlocked_achievement.dart';
import '../../domain/services/achievement_evaluator.dart';

/// Combina `statisticsSummaryProvider` (agregados) y `rideSessionsProvider`
/// (lista completa, para los criterios de una sola sesión) — ninguno de
/// los dos dispara una consulta nueva a Firestore, ambos ya estaban
/// siendo observados por Estadísticas/Historial.
final achievementsProvider = Provider<AsyncValue<List<UnlockedAchievement>>>((Ref ref) {
  final AsyncValue<StatisticsSummary> summaryState = ref.watch(statisticsSummaryProvider);
  final AsyncValue<List<RideSessionRecord>> sessionsState = ref.watch(rideSessionsProvider);

  if (summaryState.isLoading || sessionsState.isLoading) return const AsyncLoading();
  if (summaryState.hasError) return AsyncError(summaryState.error!, summaryState.stackTrace!);
  if (sessionsState.hasError) return AsyncError(sessionsState.error!, sessionsState.stackTrace!);

  return AsyncData(
    AchievementEvaluator.evaluate(
      summary: summaryState.requireValue,
      sessions: sessionsState.requireValue,
    ),
  );
});
