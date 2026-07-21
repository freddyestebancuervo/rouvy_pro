import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/injection.dart';
import '../../domain/entities/ride_session_record.dart';
import '../../domain/entities/ride_session_summary.dart';
import '../../domain/usecases/observe_ride_sessions_usecase.dart';
import '../../domain/usecases/save_ride_session_usecase.dart';

final saveRideSessionUseCaseProvider =
    Provider<SaveRideSessionUseCase>((Ref ref) => sl<SaveRideSessionUseCase>());
final observeRideSessionsUseCaseProvider =
    Provider<ObserveRideSessionsUseCase>((Ref ref) => sl<ObserveRideSessionsUseCase>());

/// Historial reciente — alimenta `RideHistoryPage`.
final rideSessionsProvider = StreamProvider<List<RideSessionRecord>>((Ref ref) {
  return ref.watch(observeRideSessionsUseCaseProvider)();
});

/// Guarda la sesión al llegar a la pantalla de resumen. Se modela como
/// `AsyncNotifier<void>` para que `SessionSummaryPage` pueda mostrar un
/// pequeño indicador de "guardando…"/"guardado ✓"/"no se pudo guardar"
/// sin bloquear la navegación — el resumen ya se muestra con los datos en
/// memoria de `RideSessionController`, el guardado en Firestore es
/// complementario, no un requisito para ver el resumen.
final saveSessionControllerProvider =
    AsyncNotifierProvider<SaveSessionController, void>(SaveSessionController.new);

class SaveSessionController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<void> save(RideSessionSummary summary) async {
    state = const AsyncLoading();
    final result = await ref.read(saveRideSessionUseCaseProvider)(SaveRideSessionParams(summary: summary));
    state = result.fold(
      (failure) => AsyncError(failure, StackTrace.current),
      (_) => const AsyncData(null),
    );
  }
}
