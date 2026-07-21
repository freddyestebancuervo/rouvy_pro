import 'dart:async';

import 'package:dartz/dartz.dart';

import '../../features/device_connection/domain/entities/ble_device.dart';
import '../../features/device_connection/domain/entities/device_connection_status.dart';
import '../../features/device_connection/domain/entities/sport_device_type.dart';
import '../../features/device_connection/domain/entities/telemetry_snapshot.dart';
import '../../features/device_connection/domain/repositories/device_repository.dart';
import '../../core/error/failures.dart';
import '../fixtures/demo_ble_devices_fixture.dart';

/// Implementación de `DeviceRepository` para el modo demo. **Nunca**
/// importa `flutter_blue_plus` — simula el ciclo completo de
/// escaneo→conexión→telemetría con `Timer`s y los fixtures de
/// `demo_ble_devices_fixture.dart`.
///
/// Reemplazo por la implementación real: ver `docs/DEMO_MODE.md`.
class FakeDeviceRepository implements DeviceRepository {
  final Map<String, BleDevice> _knownDevices = <String, BleDevice>{};
  final Map<String, StreamController<TelemetrySnapshot>> _telemetryControllers =
      <String, StreamController<TelemetrySnapshot>>{};
  final Map<String, DemoTelemetryGenerator> _generators = <String, DemoTelemetryGenerator>{};
  final Map<String, Timer> _telemetryTimers = <String, Timer>{};

  final StreamController<List<BleDevice>> _connectedDevicesController =
      StreamController<List<BleDevice>>.broadcast();

  @override
  Stream<List<BleDevice>> scanForDevices() {
    final StreamController<List<BleDevice>> controller = StreamController<List<BleDevice>>.broadcast();
    // Simula que los dispositivos "aparecen" progresivamente durante el
    // escaneo, no todos de golpe — más parecido a un escaneo BLE real.
    final List<BleDevice> fixture = buildDemoScannableDevicesFixture();
    final List<BleDevice> found = <BleDevice>[];

    Timer(const Duration(milliseconds: 400), () {
      if (fixture.isNotEmpty) {
        found.add(fixture[0]);
        controller.add(List<BleDevice>.from(found));
      }
    });
    if (fixture.length > 1) {
      Timer(const Duration(milliseconds: 900), () {
        found.add(fixture[1]);
        controller.add(List<BleDevice>.from(found));
      });
    }

    return controller.stream;
  }

  @override
  Future<Either<Failure, void>> stopScan() async => const Right(null);

  @override
  Future<Either<Failure, void>> connect(String deviceId) async {
    final List<BleDevice> fixture = buildDemoScannableDevicesFixture();
    BleDevice? base = _knownDevices[deviceId];
    for (final BleDevice candidate in fixture) {
      if (candidate.id == deviceId) {
        base = candidate;
        break;
      }
    }
    // Fallback defensivo: si por alguna razón se pide conectar un ID que
    // no está ni en el fixture ni ya conocido, se crea un dispositivo
    // genérico en vez de fallar — nunca debería pasar en el flujo normal
    // de la demo (siempre se conecta a algo visto en `scanForDevices`),
    // pero es más seguro que un `!` que podría lanzar en tests o usos
    // inesperados.
    base ??= BleDevice(
      id: deviceId,
      name: 'Dispositivo demo',
      type: SportDeviceType.smartTrainer,
      status: DeviceConnectionStatus.disconnected,
    );

    _updateDevice(base.copyWith(status: DeviceConnectionStatus.connecting));
    await Future<void>.delayed(const Duration(milliseconds: 800));

    _updateDevice(base.copyWith(status: DeviceConnectionStatus.connected));
    _startTelemetry(deviceId, isHeartRateMonitor: base.type == SportDeviceType.heartRateMonitor);

    return const Right(null);
  }

  @override
  Future<Either<Failure, void>> disconnect(String deviceId) async {
    _stopTelemetry(deviceId);
    final BleDevice? current = _knownDevices[deviceId];
    if (current != null) {
      _updateDevice(current.copyWith(status: DeviceConnectionStatus.disconnected));
    }
    return const Right(null);
  }

  @override
  Future<Either<Failure, void>> forgetDevice(String deviceId) async {
    await disconnect(deviceId);
    _knownDevices.remove(deviceId);
    _emitConnectedDevices();
    return const Right(null);
  }

  @override
  Stream<List<BleDevice>> get connectedDevicesStream => _connectedDevicesController.stream;

  @override
  Stream<TelemetrySnapshot> telemetryStreamFor(String deviceId) {
    return _telemetryControllers
        .putIfAbsent(deviceId, () => StreamController<TelemetrySnapshot>.broadcast())
        .stream;
  }

  @override
  Future<Either<Failure, bool>> hasBlePermissions() async => const Right(true);

  @override
  Future<Either<Failure, bool>> requestBlePermissions() async => const Right(true);

  @override
  Stream<bool> get isBluetoothEnabled => Stream<bool>.value(true);

  // -----------------------------------------------------------------

  void _startTelemetry(String deviceId, {required bool isHeartRateMonitor}) {
    _stopTelemetry(deviceId);
    final DemoTelemetryGenerator generator =
        DemoTelemetryGenerator(deviceId: deviceId, isHeartRateMonitor: isHeartRateMonitor);
    _generators[deviceId] = generator;

    final StreamController<TelemetrySnapshot> controller =
        _telemetryControllers.putIfAbsent(deviceId, () => StreamController<TelemetrySnapshot>.broadcast());

    _telemetryTimers[deviceId] = Timer.periodic(const Duration(seconds: 1), (_) {
      controller.add(generator.next());
    });
  }

  void _stopTelemetry(String deviceId) {
    _telemetryTimers.remove(deviceId)?.cancel();
    _generators.remove(deviceId);
  }

  void _updateDevice(BleDevice device) {
    _knownDevices[device.id] = device;
    _emitConnectedDevices();
  }

  void _emitConnectedDevices() {
    _connectedDevicesController.add(_knownDevices.values.toList(growable: false));
  }
}
