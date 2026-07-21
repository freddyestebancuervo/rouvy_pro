import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../domain/usecases/connect_device_usecase.dart';
import '../../domain/usecases/disconnect_device_usecase.dart';
import '../../domain/usecases/forget_device_usecase.dart';
import 'device_providers.dart';

/// IDs de dispositivos con una acción en curso (conectando/desconectando).
/// Se modela como `Set<String>` en vez de un simple `isLoading` global
/// porque la pantalla de gestión puede tener varias filas — cada
/// `DeviceTile` solo debe mostrar su propio spinner, no bloquear la lista
/// entera mientras se conecta OTRO dispositivo.
final pendingDeviceActionsProvider =
    NotifierProvider<PendingDeviceActionsNotifier, Set<String>>(PendingDeviceActionsNotifier.new);

class PendingDeviceActionsNotifier extends Notifier<Set<String>> {
  @override
  Set<String> build() => <String>{};

  void add(String id) => state = <String>{...state, id};
  void remove(String id) => state = state.where((String s) => s != id).toSet();
}

final deviceActionsControllerProvider =
    AsyncNotifierProvider<DeviceActionsController, void>(DeviceActionsController.new);

class DeviceActionsController extends AsyncNotifier<void> {
  @override
  Future<void> build() async {}

  Future<void> connect(String deviceId) async {
    ref.read(pendingDeviceActionsProvider.notifier).add(deviceId);
    final ConnectDeviceUseCase useCase = ref.read(connectDeviceUseCaseProvider);
    final result = await useCase(ConnectDeviceParams(deviceId: deviceId));
    ref.read(pendingDeviceActionsProvider.notifier).remove(deviceId);

    result.fold(
      (failure) => state = AsyncError(failure, StackTrace.current),
      (_) => state = const AsyncData(null),
    );
    // No hace falta actualizar manualmente ninguna lista: el datasource
    // emite el nuevo estado por `connectedDevicesStream` en cuanto cambia,
    // y `connectedDevicesProvider` ya está escuchándolo.
  }

  Future<void> disconnect(String deviceId) async {
    ref.read(pendingDeviceActionsProvider.notifier).add(deviceId);
    final DisconnectDeviceUseCase useCase = ref.read(disconnectDeviceUseCaseProvider);
    final result = await useCase(DisconnectDeviceParams(deviceId: deviceId));
    ref.read(pendingDeviceActionsProvider.notifier).remove(deviceId);

    result.fold(
      (failure) => state = AsyncError(failure, StackTrace.current),
      (_) => state = const AsyncData(null),
    );
  }

  Future<void> forget(String deviceId) async {
    ref.read(pendingDeviceActionsProvider.notifier).add(deviceId);
    final ForgetDeviceUseCase useCase = ref.read(forgetDeviceUseCaseProvider);
    final result = await useCase(ForgetDeviceParams(deviceId: deviceId));
    ref.read(pendingDeviceActionsProvider.notifier).remove(deviceId);

    result.fold(
      (failure) => state = AsyncError(failure, StackTrace.current),
      (_) => state = const AsyncData(null),
    );
  }
}
