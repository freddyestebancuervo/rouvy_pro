import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/entities/ride_session_record.dart';
import '../../domain/entities/statistics_summary.dart';
import '../../domain/services/statistics_calculator.dart';
import 'ride_history_providers.dart';

/// Deriva `StatisticsSummary` de `rideSessionsProvider` — NO dispara
/// ninguna consulta nueva a Firestore, reutiliza el mismo stream que ya
/// alimenta `RideHistoryPage`. `ref.watch` de un `StreamProvider` dentro
/// de otro provider es lo que hace que este resumen se recalcule
/// automáticamente en cuanto llega una sesión nueva, sin código de
/// sincronización manual.
final statisticsSummaryProvider = Provider<AsyncValue<StatisticsSummary>>((Ref ref) {
  final AsyncValue<List<RideSessionRecord>> sessions = ref.watch(rideSessionsProvider);
  return sessions.whenData((List<RideSessionRecord> list) {
    return StatisticsCalculator.calculate(list, now: DateTime.now());
  });
});
