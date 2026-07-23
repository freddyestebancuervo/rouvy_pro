import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/injection.dart';
import '../../domain/entities/workout.dart';
import '../../domain/repositories/workouts_repository.dart';

final workoutsRepositoryProvider = Provider<WorkoutsRepository>((Ref ref) => sl<WorkoutsRepository>());

/// Filtro "Míos" del listado — vive fuera de `WorkoutsListPage` para que el
/// `SegmentedButton` y el `FutureProvider.family` de abajo compartan la
/// misma fuente de verdad sin pasar el valor a mano por props.
final workoutsMineOnlyFilterProvider = StateProvider.autoDispose<bool>((Ref ref) => false);

/// `mineOnly: false` incluye catálogo y públicos de otros usuarios además
/// de los propios (ver `WorkoutsRepository.fetchAll`).
final workoutsListProvider =
    FutureProvider.autoDispose.family<List<Workout>, bool>((Ref ref, bool mineOnly) async {
  final result = await ref.watch(workoutsRepositoryProvider).fetchAll(mineOnly: mineOnly);
  return result.fold((failure) => throw failure, (workouts) => workouts);
});

final workoutDetailProvider =
    FutureProvider.autoDispose.family<WorkoutDetail, String>((Ref ref, String id) async {
  final result = await ref.watch(workoutsRepositoryProvider).fetchById(id);
  return result.fold((failure) => throw failure, (workout) => workout);
});

final workoutFormControllerProvider =
    AsyncNotifierProvider.autoDispose<WorkoutFormController, void>(WorkoutFormController.new);

/// Controller de mutaciones (crear/editar/archivar) — mismo patrón que
/// `ProfileController`: expone `AsyncValue<void>` para que la UI muestre
/// loading/error del envío sin mezclarlo con el `AsyncValue` de lectura de
/// `workoutsListProvider`/`workoutDetailProvider`.
class WorkoutFormController extends AutoDisposeAsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<WorkoutDetail?> create(CreateWorkoutParams params) async {
    state = const AsyncLoading();
    final result = await ref.read(workoutsRepositoryProvider).create(params);
    return result.fold(
      (failure) {
        state = AsyncError(failure, StackTrace.current);
        return null;
      },
      (workout) {
        state = const AsyncData(null);
        ref.invalidate(workoutsListProvider);
        return workout;
      },
    );
  }

  /// Nombrado `updateWorkout` (no `update`) porque `AsyncNotifierBase` ya
  /// declara un método `update(cb)` propio de Riverpod — reusar ese nombre
  /// rompería el override.
  Future<WorkoutDetail?> updateWorkout(String id, UpdateWorkoutParams params) async {
    state = const AsyncLoading();
    final result = await ref.read(workoutsRepositoryProvider).update(id, params);
    return result.fold(
      (failure) {
        state = AsyncError(failure, StackTrace.current);
        return null;
      },
      (workout) {
        state = const AsyncData(null);
        ref.invalidate(workoutsListProvider);
        ref.invalidate(workoutDetailProvider(id));
        return workout;
      },
    );
  }

  Future<bool> archive(String id) async {
    state = const AsyncLoading();
    final result = await ref.read(workoutsRepositoryProvider).archive(id);
    return result.fold(
      (failure) {
        state = AsyncError(failure, StackTrace.current);
        return false;
      },
      (_) {
        state = const AsyncData(null);
        ref.invalidate(workoutsListProvider);
        ref.invalidate(workoutDetailProvider(id));
        return true;
      },
    );
  }
}
