import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/injection.dart';
import '../../domain/entities/ble_device.dart';
import '../../domain/repositories/device_repository.dart';
import '../../domain/usecases/connect_device_usecase.dart';
import '../../domain/usecases/disconnect_device_usecase.dart';
import '../../domain/usecases/forget_device_usecase.dart';
import '../../domain/usecases/observe_connected_devices_usecase.dart';
import '../../domain/usecases/observe_telemetry_usecase.dart';
import '../../domain/usecases/request_ble_permissions_usecase.dart';
import '../../domain/usecases/scan_devices_usecase.dart';
import '../../domain/usecases/stop_scan_usecase.dart';

final deviceRepositoryProvider = Provider<DeviceRepository>((Ref ref) => sl<DeviceRepository>());

final scanDevicesUseCaseProvider = Provider<ScanDevicesUseCase>((Ref ref) => sl<ScanDevicesUseCase>());
final stopScanUseCaseProvider = Provider<StopScanUseCase>((Ref ref) => sl<StopScanUseCase>());
final connectDeviceUseCaseProvider =
    Provider<ConnectDeviceUseCase>((Ref ref) => sl<ConnectDeviceUseCase>());
final disconnectDeviceUseCaseProvider =
    Provider<DisconnectDeviceUseCase>((Ref ref) => sl<DisconnectDeviceUseCase>());
final forgetDeviceUseCaseProvider = Provider<ForgetDeviceUseCase>((Ref ref) => sl<ForgetDeviceUseCase>());
final observeConnectedDevicesUseCaseProvider =
    Provider<ObserveConnectedDevicesUseCase>((Ref ref) => sl<ObserveConnectedDevicesUseCase>());
final observeTelemetryUseCaseProvider =
    Provider<ObserveTelemetryUseCase>((Ref ref) => sl<ObserveTelemetryUseCase>());
final requestBlePermissionsUseCaseProvider =
    Provider<RequestBlePermissionsUseCase>((Ref ref) => sl<RequestBlePermissionsUseCase>());

/// Fuente única de verdad de "qué dispositivos conoce la app ahora mismo"
/// (conectados, conectando o reconectando) — alimenta directamente la
/// pantalla de gestión de dispositivos.
final connectedDevicesProvider = StreamProvider<List<BleDevice>>((Ref ref) {
  return ref.watch(observeConnectedDevicesUseCaseProvider)();
});

/// `true` si el adaptador Bluetooth del teléfono está encendido. Se separa
/// de los permisos porque son dos requisitos independientes: se puede
/// tener permiso concedido y aun así el Bluetooth apagado.
final bluetoothEnabledProvider = StreamProvider<bool>((Ref ref) {
  return ref.watch(deviceRepositoryProvider).isBluetoothEnabled;
});

/// Telemetría en vivo de UN dispositivo — se usa tanto en la fila de cada
/// dispositivo conectado (mini-lectura) como, más adelante, en el HUD de
/// entrenamiento combinando varios a la vez.
final deviceTelemetryProvider = StreamProvider.family((Ref ref, String deviceId) {
  return ref.watch(observeTelemetryUseCaseProvider)(deviceId);
});
