import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/device_connection/data/models/ble_device_model.dart';
import 'package:rouvy_pro/features/device_connection/data/scanning/ble_scan_result_collector.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/ble_device_compatibility_status.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/device_connection_status.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/sport_device_type.dart';

void main() {
  group('BleScanResultCollector', () {
    test('emits unknown devices instead of discarding them', () {
      final BleScanResultCollector collector = BleScanResultCollector();

      final List<BleDeviceModel> devices = collector.addAll(<BleDeviceModel>[
        _device('unknown-1', type: SportDeviceType.unknown),
      ]);

      expect(devices, hasLength(1));
      expect(devices.single.id, 'unknown-1');
      expect(devices.single.type, SportDeviceType.unknown);
      expect(
        devices.single.compatibilityStatus,
        BleDeviceCompatibilityStatus.discovered,
      );
    });

    test('standard devices still appear', () {
      final BleScanResultCollector collector = BleScanResultCollector();

      final List<BleDeviceModel> devices = collector.addAll(<BleDeviceModel>[
        _device('ftms-1', type: SportDeviceType.smartTrainer),
      ]);

      expect(devices.single.type, SportDeviceType.smartTrainer);
    });

    test('deduplicates by device ID and keeps the latest scan data', () {
      final BleScanResultCollector collector = BleScanResultCollector();

      collector.addAll(<BleDeviceModel>[
        _device('device-1', name: 'First', rssi: -75),
      ]);
      final List<BleDeviceModel> devices = collector.addAll(<BleDeviceModel>[
        _device('device-1', name: 'Second', rssi: -40),
      ]);

      expect(devices, hasLength(1));
      expect(devices.single.name, 'Second');
      expect(devices.single.rssi, -40);
    });

    test('repeated scan keeps stronger proven compatibility', () {
      final BleScanResultCollector collector = BleScanResultCollector();

      collector.addAll(<BleDeviceModel>[
        _device(
          'device-1',
          compatibilityStatus: BleDeviceCompatibilityStatus.standardCompatible,
        ),
      ]);
      final List<BleDeviceModel> devices = collector.addAll(<BleDeviceModel>[
        _device('device-1'),
      ]);

      expect(
        devices.single.compatibilityStatus,
        BleDeviceCompatibilityStatus.standardCompatible,
      );
    });

    test('repeated scan preserves proven type with stronger compatibility',
        () {
      final BleScanResultCollector collector = BleScanResultCollector();

      collector.addAll(<BleDeviceModel>[
        _device(
          'hr-1',
          type: SportDeviceType.heartRateMonitor,
          compatibilityStatus: BleDeviceCompatibilityStatus.standardCompatible,
        ),
      ]);
      final List<BleDeviceModel> devices = collector.addAll(<BleDeviceModel>[
        _device('hr-1', type: SportDeviceType.unknown),
      ]);

      expect(
        devices.single.compatibilityStatus,
        BleDeviceCompatibilityStatus.standardCompatible,
      );
      expect(devices.single.type, SportDeviceType.heartRateMonitor);
    });

    test('repeated scan refreshes RSSI while preserving proven evidence', () {
      final BleScanResultCollector collector = BleScanResultCollector();

      collector.addAll(<BleDeviceModel>[
        _device(
          'hr-2',
          type: SportDeviceType.heartRateMonitor,
          rssi: -80,
          compatibilityStatus: BleDeviceCompatibilityStatus.standardCompatible,
        ),
      ]);
      final List<BleDeviceModel> devices = collector.addAll(<BleDeviceModel>[
        _device('hr-2', type: SportDeviceType.unknown, rssi: -42),
      ]);

      expect(
        devices.single.compatibilityStatus,
        BleDeviceCompatibilityStatus.standardCompatible,
      );
      expect(devices.single.type, SportDeviceType.heartRateMonitor);
      expect(devices.single.rssi, -42);
    });
  });
}

BleDeviceModel _device(
  String id, {
  String name = 'Device',
  SportDeviceType type = SportDeviceType.unknown,
  int rssi = -60,
  BleDeviceCompatibilityStatus compatibilityStatus =
      BleDeviceCompatibilityStatus.discovered,
}) {
  return BleDeviceModel(
    id: id,
    name: name,
    type: type,
    status: DeviceConnectionStatus.disconnected,
    rssi: rssi,
    compatibilityStatus: compatibilityStatus,
  );
}
