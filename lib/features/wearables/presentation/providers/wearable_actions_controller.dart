import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/entities/external_activity.dart';
import '../../domain/entities/wearable_provider_type.dart';
import '../../domain/usecases/connect_wearable_usecase.dart';
import '../../domain/usecases/disconnect_wearable_usecase.dart';
import '../../domain/usecases/import_activities_usecase.dart';
import 'wearable_providers.dart';

final pendingWearableActionsProvider =
    NotifierProvider<PendingWearableActionsNotifier, Set<WearableProviderType>>(
  PendingWearableActionsNotifier.new,
);

class PendingWearableActionsNotifier extends Notifier<Set<WearableProviderType>> {
  @override
  Set<WearableProviderType> build() => <WearableProviderType>{};

  void add(WearableProviderType p) => state = <WearableProviderType>{...state, p};
  void remove(WearableProviderType p) => state = state.where((WearableProviderType s) => s != p).toSet();
}

/// Última tanda de actividades importadas — se muestra como resumen tras
/// pulsar "Importar actividades" (p. ej. en un SnackBar con el conteo).
final lastImportedActivitiesProvider = StateProvider<List<ExternalActivity>>((Ref ref) => <ExternalActivity>[]);

final wearableActionsControllerProvider =
    AsyncNotifierProvider<WearableActionsController, void>(WearableActionsController.new);

class WearableActionsController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<void> connect(WearableProviderType provider) async {
    ref.read(pendingWearableActionsProvider.notifier).add(provider);
    final ConnectWearableUseCase useCase = ref.read(connectWearableUseCaseProvider);
    final result = await useCase(ConnectWearableParams(provider: provider));
    ref.read(pendingWearableActionsProvider.notifier).remove(provider);

    state = result.fold(
      (failure) => AsyncError(failure, StackTrace.current),
      (_) => const AsyncData(null),
    );
  }

  Future<void> disconnect(WearableProviderType provider) async {
    ref.read(pendingWearableActionsProvider.notifier).add(provider);
    final DisconnectWearableUseCase useCase = ref.read(disconnectWearableUseCaseProvider);
    final result = await useCase(DisconnectWearableParams(provider: provider));
    ref.read(pendingWearableActionsProvider.notifier).remove(provider);

    state = result.fold(
      (failure) => AsyncError(failure, StackTrace.current),
      (_) => const AsyncData(null),
    );
  }

  Future<void> importActivities(WearableProviderType provider) async {
    ref.read(pendingWearableActionsProvider.notifier).add(provider);
    final ImportActivitiesUseCase useCase = ref.read(importActivitiesUseCaseProvider);
    final result = await useCase(ImportActivitiesParams(provider: provider));
    ref.read(pendingWearableActionsProvider.notifier).remove(provider);

    state = result.fold(
      (failure) => AsyncError(failure, StackTrace.current),
      (List<ExternalActivity> activities) {
        ref.read(lastImportedActivitiesProvider.notifier).state = activities;
        return const AsyncData(null);
      },
    );
  }

  /// Solo tiene sentido para Apple Health/Google Fit — abre los ajustes
  /// del sistema donde el usuario puede conceder manualmente el permiso
  /// que la app ya no puede volver a solicitar por diálogo (denegado
  /// permanentemente en Android, o el caso ambiguo de iOS — ver
  /// `HealthPermissionStatus`).
  Future<void> openHealthSettings() {
    return ref.read(healthPlatformGatewayProvider).openPermissionSettings();
  }
}
