import 'dart:math';

import '../../features/device_connection/domain/entities/ble_device.dart';
import '../../features/device_connection/domain/entities/device_connection_status.dart';
import '../../features/device_connection/domain/entities/sport_device_type.dart';
import '../../features/device_connection/domain/entities/telemetry_snapshot.dart';

/// Dispositivos que aparecen al "escanear" en modo demo — un rodillo
/// inteligente y un pulsómetro, los dos tipos que más importan para el
/// HUD de entrenamiento.
List<BleDevice> buildDemoScannableDevicesFixture() {
  return const <BleDevice>[
    BleDevice(
      id: 'demo-trainer-1',
      name: 'Wahoo KICKR CORE (demo)',
      type: SportDeviceType.smartTrainer,
      status: DeviceConnectionStatus.disconnected,
      rssi: -55,
      manufacturer: 'Wahoo (simulado)',
    ),
    BleDevice(
      id: 'demo-hrm-1',
      name: 'Polar H10 (demo)',
      type: SportDeviceType.heartRateMonitor,
      status: DeviceConnectionStatus.disconnected,
      rssi: -62,
      manufacturer: 'Polar (simulado)',
    ),
  ];
}

/// Genera `TelemetrySnapshot` con variación aleatoria pero acotada y
/// realista — no números totalmente aleatorios (que se verían "falsos"
/// en la demo), sino una caminata aleatoria alrededor de valores típicos
/// de un ciclista en zona aeróbica/tempo.
class DemoTelemetryGenerator {
  DemoTelemetryGenerator({required this.deviceId, required this.isHeartRateMonitor});

  final String deviceId;
  final bool isHeartRateMonitor;

  final Random _random = Random();
  double _speedKmh = 28;
  int _powerWatts = 180;
  int _cadenceRpm = 85;
  int _heartRateBpm = 138;

  TelemetrySnapshot next() {
    if (isHeartRateMonitor) {
      _heartRateBpm = (_heartRateBpm + _randomStep(3)).clamp(110, 175).round();
      return TelemetrySnapshot(deviceId: deviceId, timestamp: DateTime.now(), heartRateBpm: _heartRateBpm);
    }

    _speedKmh = (_speedKmh + _randomStep(1.5)).clamp(15, 45).toDouble();
    _powerWatts = (_powerWatts + _randomStep(8)).clamp(90, 320).round();
    _cadenceRpm = (_cadenceRpm + _randomStep(3)).clamp(60, 105).round();

    return TelemetrySnapshot(
      deviceId: deviceId,
      timestamp: DateTime.now(),
      speedKmh: _speedKmh,
      powerWatts: _powerWatts,
      cadenceRpm: _cadenceRpm,
    );
  }

  double _randomStep(double maxStep) => (_random.nextDouble() * 2 - 1) * maxStep;
}
