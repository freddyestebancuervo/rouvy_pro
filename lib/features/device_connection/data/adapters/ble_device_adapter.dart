import 'dart:typed_data';

import '../../domain/entities/telemetry_snapshot.dart';
import '../../domain/entities/telemetry_source.dart';

class BleDeviceCapability {
  const BleDeviceCapability({
    required this.serviceUuid,
    required this.characteristicUuids,
  });

  final String serviceUuid;
  final Set<String> characteristicUuids;

  bool exposes(String characteristicUuid) {
    return characteristicUuids.contains(characteristicUuid.toLowerCase());
  }
}

abstract class BleDeviceAdapter {
  TelemetrySourceKind get source;
  String get serviceUuid;
  String get telemetryCharacteristicUuid;

  bool supports(BleDeviceCapability capability) {
    return capability.serviceUuid == serviceUuid &&
        capability.exposes(telemetryCharacteristicUuid);
  }

  TelemetrySnapshot? parseNotification({
    required String deviceId,
    required String characteristicUuid,
    required Uint8List value,
    required DateTime timestamp,
  });

  void reset();
}
