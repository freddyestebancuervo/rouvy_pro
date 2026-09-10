import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/device_connection/data/models/ble_device_model.dart';
import 'package:rouvy_pro/features/device_connection/data/scanning/ble_device_evidence_merger.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/ble_device_compatibility_status.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/device_connection_status.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/sport_device_type.dart';

void main() {
  group('mergeScanWithSessionEvidence (production scan seam)', () {
    test('fresh scan without session evidence stays discovered', () {
      final BleDeviceModel scan = _scan(id: 'fresh-1');

      final BleDeviceModel merged = mergeScanWithSessionEvidence(
        scan: scan,
      );

      expect(
        merged.compatibilityStatus,
        BleDeviceCompatibilityStatus.discovered,
      );
      expect(merged.type, SportDeviceType.unknown);
    });

    test('repeated discovered scan without session evidence stays discovered',
        () {
      final BleDeviceModel first = _scan(id: 'repeat-1', rssi: -70);
      final BleDeviceModel second = _scan(id: 'repeat-1', rssi: -65);

      final BleDeviceModel afterFirst = mergeScanWithSessionEvidence(
        scan: first,
      );
      final BleDeviceModel afterSecond = mergeScanWithSessionEvidence(
        scan: second,
        sessionEvidence: afterFirst,
      );

      expect(
        afterSecond.compatibilityStatus,
        BleDeviceCompatibilityStatus.discovered,
      );
    });

    test('proven standardCompatible session is not downgraded by rescan', () {
      final BleDeviceModel session = _session(
        id: 'hr-1',
        compatibilityStatus: BleDeviceCompatibilityStatus.standardCompatible,
        type: SportDeviceType.heartRateMonitor,
      );
      final BleDeviceModel scan = _scan(id: 'hr-1');

      final BleDeviceModel merged = mergeScanWithSessionEvidence(
        scan: scan,
        sessionEvidence: session,
      );

      expect(
        merged.compatibilityStatus,
        BleDeviceCompatibilityStatus.standardCompatible,
      );
    });

    test('proven unsupported session is not downgraded by rescan', () {
      final BleDeviceModel session = _session(
        id: 'unknown-proprietary-1',
        compatibilityStatus: BleDeviceCompatibilityStatus.unsupported,
        type: SportDeviceType.unknown,
      );
      final BleDeviceModel scan = _scan(id: 'unknown-proprietary-1');

      final BleDeviceModel merged = mergeScanWithSessionEvidence(
        scan: scan,
        sessionEvidence: session,
      );

      expect(
        merged.compatibilityStatus,
        BleDeviceCompatibilityStatus.unsupported,
      );
    });

    test('proven functional type is retained with stronger compatibility', () {
      final BleDeviceModel session = _session(
        id: 'hr-2',
        compatibilityStatus: BleDeviceCompatibilityStatus.standardCompatible,
        type: SportDeviceType.heartRateMonitor,
      );
      final BleDeviceModel scan = _scan(
        id: 'hr-2',
        type: SportDeviceType.unknown,
      );

      final BleDeviceModel merged = mergeScanWithSessionEvidence(
        scan: scan,
        sessionEvidence: session,
      );

      expect(
        merged.compatibilityStatus,
        BleDeviceCompatibilityStatus.standardCompatible,
      );
      expect(merged.type, SportDeviceType.heartRateMonitor);
      expect(
        merged.type,
        isNot(SportDeviceType.unknown),
        reason: 'must not produce standardCompatible + unknown '
            'when session already proved heartRateMonitor',
      );
    });

    test('latest RSSI/name still refresh while evidence is preserved', () {
      final BleDeviceModel session = _session(
        id: 'hr-3',
        compatibilityStatus: BleDeviceCompatibilityStatus.standardCompatible,
        type: SportDeviceType.heartRateMonitor,
        rssi: -80,
        name: 'Old Name',
      );
      final BleDeviceModel scan = _scan(
        id: 'hr-3',
        rssi: -42,
        name: 'New Name',
      );

      final BleDeviceModel merged = mergeScanWithSessionEvidence(
        scan: scan,
        sessionEvidence: session,
      );

      expect(
        merged.compatibilityStatus,
        BleDeviceCompatibilityStatus.standardCompatible,
      );
      expect(merged.type, SportDeviceType.heartRateMonitor);
      expect(merged.rssi, -42);
      expect(merged.name, 'New Name');
    });

    test('process-new device with no prior evidence returns discovered', () {
      final BleDeviceModel scan = _scan(id: 'process-new-1', rssi: -60);

      final BleDeviceModel merged = mergeScanWithSessionEvidence(
        scan: scan,
        sessionEvidence: null,
      );

      expect(
        merged.compatibilityStatus,
        BleDeviceCompatibilityStatus.discovered,
      );
    });

    test('future-safe values are preserved if legitimately present', () {
      final BleDeviceModel scan = _scan(id: 'future-1');

      final BleDeviceModel compatible = mergeScanWithSessionEvidence(
        scan: scan,
        sessionEvidence: _session(
          id: 'future-1',
          compatibilityStatus: BleDeviceCompatibilityStatus.korixaCompatible,
          type: SportDeviceType.smartTrainer,
        ),
      );
      final BleDeviceModel verified = mergeScanWithSessionEvidence(
        scan: scan,
        sessionEvidence: _session(
          id: 'future-1',
          compatibilityStatus: BleDeviceCompatibilityStatus.korixaVerified,
          type: SportDeviceType.smartTrainer,
        ),
      );

      expect(
        compatible.compatibilityStatus,
        BleDeviceCompatibilityStatus.korixaCompatible,
      );
      expect(
        verified.compatibilityStatus,
        BleDeviceCompatibilityStatus.korixaVerified,
      );
    });

    test('stronger scan evidence can still upgrade (GATT path not blocked)',
        () {
      final BleDeviceModel session = _session(
        id: 'upgrade-1',
        compatibilityStatus: BleDeviceCompatibilityStatus.unsupported,
        type: SportDeviceType.unknown,
      );
      final BleDeviceModel strongerScan = _scan(
        id: 'upgrade-1',
        compatibilityStatus: BleDeviceCompatibilityStatus.standardCompatible,
        type: SportDeviceType.powerMeter,
      );

      final BleDeviceModel merged = mergeScanWithSessionEvidence(
        scan: strongerScan,
        sessionEvidence: session,
      );

      expect(
        merged.compatibilityStatus,
        BleDeviceCompatibilityStatus.standardCompatible,
      );
      expect(merged.type, SportDeviceType.powerMeter);
    });
  });
}

BleDeviceModel _scan({
  required String id,
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

BleDeviceModel _session({
  required String id,
  required BleDeviceCompatibilityStatus compatibilityStatus,
  required SportDeviceType type,
  int rssi = -70,
  String name = 'Session Device',
}) {
  return BleDeviceModel(
    id: id,
    name: name,
    type: type,
    status: DeviceConnectionStatus.connected,
    rssi: rssi,
    compatibilityStatus: compatibilityStatus,
  );
}
