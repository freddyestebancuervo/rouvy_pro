import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/ble_device.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/ble_device_compatibility_status.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/device_connection_status.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/sport_device_type.dart';

void main() {
  group('BleDevice compatibility status', () {
    const BleDevice baseDevice = BleDevice(
      id: 'device-1',
      name: 'Device',
      type: SportDeviceType.unknown,
      status: DeviceConnectionStatus.disconnected,
    );

    test('defaults to discovered', () {
      expect(
        baseDevice.compatibilityStatus,
        BleDeviceCompatibilityStatus.discovered,
      );
    });

    test('copyWith preserves compatibility when omitted', () {
      final BleDevice copied = baseDevice.copyWith(name: 'Updated');

      expect(copied.name, 'Updated');
      expect(
        copied.compatibilityStatus,
        BleDeviceCompatibilityStatus.discovered,
      );
    });

    test('copyWith changes compatibility explicitly', () {
      final BleDevice copied = baseDevice.copyWith(
        compatibilityStatus: BleDeviceCompatibilityStatus.standardCompatible,
      );

      expect(
        copied.compatibilityStatus,
        BleDeviceCompatibilityStatus.standardCompatible,
      );
    });

    test('Equatable props include compatibility state', () {
      final BleDevice compatible = baseDevice.copyWith(
        compatibilityStatus: BleDeviceCompatibilityStatus.standardCompatible,
      );

      expect(compatible, isNot(baseDevice));
    });
  });
}
