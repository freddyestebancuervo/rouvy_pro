import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/usecase/usecase.dart';
import '../../domain/entities/ble_device.dart';
import 'device_providers.dart';

/// Estado inmutable del escaneo — se modela como una sola clase (en vez de
/// dos providers sueltos `isScanning`/`devices`) porque ambos cambian
/// juntos en los mismos puntos del ciclo de vida y la UI casi siempre los
/// necesita a la vez (el botón de escanear cambia de ícono según
/// `isScanning`, la lista se llena con `devices`).
class DeviceScanState {
  const DeviceScanState({this.devices = const <BleDevice>[], this.isScanning = false});

  final List<BleDevice> devices;
  final bool isScanning;

  DeviceScanState copyWith({List<BleDevice>? devices, bool? isScanning}) {
    return DeviceScanState(
      devices: devices ?? this.devices,
      isScanning: isScanning ?? this.isScanning,
    );
  }
}

final deviceScanControllerProvider =
    NotifierProvider<DeviceScanController, DeviceScanState>(DeviceScanController.new);

class DeviceScanController extends Notifier<DeviceScanState> {
  StreamSubscription<List<BleDevice>>? _subscription;

  @override
  DeviceScanState build() {
    ref.onDispose(() => _subscription?.cancel());
    return const DeviceScanState();
  }

  Future<void> startScan() async {
    // Se solicitan permisos justo antes de escanear, no antes — así el
    // diálogo del sistema aparece en el momento en que el usuario
    // realmente pulsó "Buscar dispositivos", con contexto claro de por qué
    // se le está pidiendo.
    final bool granted = await ref.read(requestBlePermissionsUseCaseProvider)(const NoParams()).then(
          (result) => result.fold((_) => false, (bool granted) => granted),
        );
    if (!granted) return;

    await _subscription?.cancel();
    state = state.copyWith(isScanning: true, devices: const <BleDevice>[]);

    _subscription = ref.read(scanDevicesUseCaseProvider)().listen(
      (List<BleDevice> devices) => state = state.copyWith(devices: devices),
      onDone: () => state = state.copyWith(isScanning: false),
      onError: (_) => state = state.copyWith(isScanning: false),
    );
  }

  Future<void> stopScan() async {
    await _subscription?.cancel();
    _subscription = null;
    await ref.read(stopScanUseCaseProvider)(const NoParams());
    state = state.copyWith(isScanning: false);
  }
}
