import 'dart:typed_data';

import '../../../../core/ble/ble_uuids.dart';
import '../../domain/entities/telemetry_snapshot.dart';
import '../../domain/entities/telemetry_source.dart';
import '../parsers/csc_parser.dart';
import '../parsers/cycling_power_parser.dart';
import '../parsers/ftms_parser.dart';
import '../parsers/heart_rate_parser.dart';
import 'ble_device_adapter.dart';

class FtmsBleDeviceAdapter extends _StandardBleDeviceAdapter {
  const FtmsBleDeviceAdapter();

  @override
  TelemetrySourceKind get source => TelemetrySourceKind.ftms;

  @override
  String get serviceUuid => BleUuids.fitnessMachine;

  @override
  String get telemetryCharacteristicUuid => BleUuids.indoorBikeData;

  @override
  TelemetrySnapshot? parseNotification({
    required String deviceId,
    required String characteristicUuid,
    required Uint8List value,
    required DateTime timestamp,
  }) {
    if (!_matchesCharacteristic(characteristicUuid)) return null;
    final FtmsIndoorBikeData data = FtmsParser.parseIndoorBikeData(value);
    return TelemetrySnapshot(
      deviceId: deviceId,
      source: source,
      timestamp: timestamp,
      speedKmh: data.speedKmh,
      powerWatts: data.powerWatts,
      cadenceRpm: data.cadenceRpm,
      heartRateBpm: data.heartRateBpm,
    );
  }
}

class HeartRateBleDeviceAdapter extends _StandardBleDeviceAdapter {
  const HeartRateBleDeviceAdapter();

  @override
  TelemetrySourceKind get source => TelemetrySourceKind.heartRate;

  @override
  String get serviceUuid => BleUuids.heartRate;

  @override
  String get telemetryCharacteristicUuid => BleUuids.heartRateMeasurement;

  @override
  TelemetrySnapshot? parseNotification({
    required String deviceId,
    required String characteristicUuid,
    required Uint8List value,
    required DateTime timestamp,
  }) {
    if (!_matchesCharacteristic(characteristicUuid)) return null;
    final int? bpm = HeartRateParser.parseHeartRateMeasurement(value);
    if (bpm == null) return null;
    return TelemetrySnapshot(
      deviceId: deviceId,
      source: source,
      timestamp: timestamp,
      heartRateBpm: bpm,
    );
  }
}

class CyclingPowerBleDeviceAdapter extends _StandardBleDeviceAdapter {
  CyclingPowerBleDeviceAdapter({CyclingPowerParser? parser})
      : _parser = parser ?? CyclingPowerParser();

  final CyclingPowerParser _parser;

  @override
  TelemetrySourceKind get source => TelemetrySourceKind.cyclingPower;

  @override
  String get serviceUuid => BleUuids.cyclingPower;

  @override
  String get telemetryCharacteristicUuid => BleUuids.cyclingPowerMeasurement;

  @override
  TelemetrySnapshot? parseNotification({
    required String deviceId,
    required String characteristicUuid,
    required Uint8List value,
    required DateTime timestamp,
  }) {
    if (!_matchesCharacteristic(characteristicUuid)) return null;
    final CyclingPowerReading? reading = _parser.parse(value);
    if (reading == null) return null;
    return TelemetrySnapshot(
      deviceId: deviceId,
      source: source,
      timestamp: timestamp,
      powerWatts: reading.powerWatts,
      cadenceRpm: reading.cadenceRpm,
    );
  }

  @override
  void reset() => _parser.reset();
}

class CscBleDeviceAdapter extends _StandardBleDeviceAdapter {
  CscBleDeviceAdapter({CscParser? parser}) : _parser = parser ?? CscParser();

  final CscParser _parser;

  @override
  TelemetrySourceKind get source => TelemetrySourceKind.csc;

  @override
  String get serviceUuid => BleUuids.cyclingSpeedCadence;

  @override
  String get telemetryCharacteristicUuid => BleUuids.cscMeasurement;

  @override
  TelemetrySnapshot? parseNotification({
    required String deviceId,
    required String characteristicUuid,
    required Uint8List value,
    required DateTime timestamp,
  }) {
    if (!_matchesCharacteristic(characteristicUuid)) return null;
    final CscReading reading = _parser.parse(value);
    return TelemetrySnapshot(
      deviceId: deviceId,
      source: source,
      timestamp: timestamp,
      speedKmh: reading.speedKmh,
      cadenceRpm: reading.cadenceRpm,
    );
  }

  @override
  void reset() => _parser.reset();
}

abstract class _StandardBleDeviceAdapter implements BleDeviceAdapter {
  const _StandardBleDeviceAdapter();

  @override
  bool supports(BleDeviceCapability capability) {
    return capability.serviceUuid == serviceUuid &&
        capability.exposes(telemetryCharacteristicUuid);
  }

  @override
  void reset() {}

  bool _matchesCharacteristic(String characteristicUuid) {
    return characteristicUuid.toLowerCase() ==
        telemetryCharacteristicUuid.toLowerCase();
  }
}
