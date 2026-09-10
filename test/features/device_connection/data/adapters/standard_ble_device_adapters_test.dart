import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/ble/ble_uuids.dart';
import 'package:rouvy_pro/features/device_connection/data/adapters/standard_ble_device_adapters.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/telemetry_snapshot.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/telemetry_source.dart';

void main() {
  group('Standard BLE device adapters', () {
    final DateTime timestamp = DateTime.utc(2026, 9, 9, 12);

    test(
      'FTMS adapter delegates Indoor Bike Data packets to the existing parser',
      () {
        const FtmsBleDeviceAdapter adapter = FtmsBleDeviceAdapter();

        final TelemetrySnapshot? snapshot = adapter.parseNotification(
          deviceId: 'trainer-1',
          characteristicUuid: BleUuids.indoorBikeData,
          value: _ftmsPacket(),
          timestamp: timestamp,
        );

        expect(snapshot, isNotNull);
        expect(snapshot!.deviceId, 'trainer-1');
        expect(snapshot.source, TelemetrySourceKind.ftms);
        expect(snapshot.timestamp, timestamp);
        expect(snapshot.speedKmh, 30.0);
        expect(snapshot.cadenceRpm, 90);
        expect(snapshot.powerWatts, 250);
        expect(snapshot.heartRateBpm, 150);
      },
    );

    test(
      'Heart Rate adapter delegates Heart Rate Measurement packets to the existing parser',
      () {
        const HeartRateBleDeviceAdapter adapter = HeartRateBleDeviceAdapter();

        final TelemetrySnapshot? snapshot = adapter.parseNotification(
          deviceId: 'hr-1',
          characteristicUuid: BleUuids.heartRateMeasurement,
          value: Uint8List.fromList(<int>[0x00, 0x48]),
          timestamp: timestamp,
        );

        expect(snapshot, isNotNull);
        expect(snapshot!.deviceId, 'hr-1');
        expect(snapshot.source, TelemetrySourceKind.heartRate);
        expect(snapshot.timestamp, timestamp);
        expect(snapshot.heartRateBpm, 72);
        expect(snapshot.speedKmh, isNull);
        expect(snapshot.powerWatts, isNull);
        expect(snapshot.cadenceRpm, isNull);
      },
    );

    test(
      'Cycling Power adapter delegates power/cadence packets to the existing parser',
      () {
        final CyclingPowerBleDeviceAdapter adapter =
            CyclingPowerBleDeviceAdapter();

        final TelemetrySnapshot? first = adapter.parseNotification(
          deviceId: 'power-1',
          characteristicUuid: BleUuids.cyclingPowerMeasurement,
          value: _cyclingPowerPacket(crankRevolutions: 10, crankEventTime: 0),
          timestamp: timestamp,
        );
        final TelemetrySnapshot? second = adapter.parseNotification(
          deviceId: 'power-1',
          characteristicUuid: BleUuids.cyclingPowerMeasurement,
          value: _cyclingPowerPacket(
            crankRevolutions: 11,
            crankEventTime: 1024,
          ),
          timestamp: timestamp.add(const Duration(seconds: 1)),
        );

        expect(first, isNotNull);
        expect(first!.source, TelemetrySourceKind.cyclingPower);
        expect(first.powerWatts, 250);
        expect(first.cadenceRpm, isNull);
        expect(second, isNotNull);
        expect(second!.source, TelemetrySourceKind.cyclingPower);
        expect(second.powerWatts, 250);
        expect(second.cadenceRpm, 60);
      },
    );

    test(
      'CSC adapter delegates speed/cadence packets to the existing parser',
      () {
        final CscBleDeviceAdapter adapter = CscBleDeviceAdapter();

        final TelemetrySnapshot? first = adapter.parseNotification(
          deviceId: 'csc-1',
          characteristicUuid: BleUuids.cscMeasurement,
          value: _cscPacket(
            wheelRevolutions: 0,
            wheelEventTime: 0,
            crankRevolutions: 10,
            crankEventTime: 0,
          ),
          timestamp: timestamp,
        );
        final TelemetrySnapshot? second = adapter.parseNotification(
          deviceId: 'csc-1',
          characteristicUuid: BleUuids.cscMeasurement,
          value: _cscPacket(
            wheelRevolutions: 10,
            wheelEventTime: 1024,
            crankRevolutions: 11,
            crankEventTime: 1024,
          ),
          timestamp: timestamp.add(const Duration(seconds: 1)),
        );

        expect(first, isNotNull);
        expect(first!.source, TelemetrySourceKind.csc);
        expect(first.speedKmh, isNull);
        expect(first.cadenceRpm, isNull);
        expect(second, isNotNull);
        expect(second!.source, TelemetrySourceKind.csc);
        expect(second.speedKmh, closeTo(75.78, 0.01));
        expect(second.cadenceRpm, 60);
      },
    );

    test(
      'wrong characteristic UUID is ignored safely without fabricated telemetry',
      () {
        const HeartRateBleDeviceAdapter adapter = HeartRateBleDeviceAdapter();

        final TelemetrySnapshot? snapshot = adapter.parseNotification(
          deviceId: 'hr-1',
          characteristicUuid: BleUuids.batteryLevel,
          value: Uint8List.fromList(<int>[0x00, 0x48]),
          timestamp: timestamp,
        );

        expect(snapshot, isNull);
      },
    );
  });

  group('Standard BLE adapter state isolation', () {
    final DateTime timestamp = DateTime.utc(2026, 9, 9, 13);

    test(
      'two CSC adapter instances keep cumulative wheel/crank state isolated',
      () {
        final CscBleDeviceAdapter adapterA = CscBleDeviceAdapter();
        final CscBleDeviceAdapter adapterB = CscBleDeviceAdapter();

        adapterA.parseNotification(
          deviceId: 'csc-a',
          characteristicUuid: BleUuids.cscMeasurement,
          value: _cscPacket(
            wheelRevolutions: 0,
            wheelEventTime: 0,
            crankRevolutions: 0,
            crankEventTime: 0,
          ),
          timestamp: timestamp,
        );

        final TelemetrySnapshot? firstB = adapterB.parseNotification(
          deviceId: 'csc-b',
          characteristicUuid: BleUuids.cscMeasurement,
          value: _cscPacket(
            wheelRevolutions: 10,
            wheelEventTime: 1024,
            crankRevolutions: 10,
            crankEventTime: 1024,
          ),
          timestamp: timestamp.add(const Duration(seconds: 1)),
        );

        expect(firstB, isNotNull);
        expect(firstB!.deviceId, 'csc-b');
        expect(firstB.speedKmh, isNull);
        expect(firstB.cadenceRpm, isNull);
      },
    );

    test(
      'two Cycling Power adapter instances keep crank cadence state isolated',
      () {
        final CyclingPowerBleDeviceAdapter adapterA =
            CyclingPowerBleDeviceAdapter();
        final CyclingPowerBleDeviceAdapter adapterB =
            CyclingPowerBleDeviceAdapter();

        adapterA.parseNotification(
          deviceId: 'power-a',
          characteristicUuid: BleUuids.cyclingPowerMeasurement,
          value: _cyclingPowerPacket(crankRevolutions: 0, crankEventTime: 0),
          timestamp: timestamp,
        );

        final TelemetrySnapshot? firstB = adapterB.parseNotification(
          deviceId: 'power-b',
          characteristicUuid: BleUuids.cyclingPowerMeasurement,
          value: _cyclingPowerPacket(
            crankRevolutions: 10,
            crankEventTime: 1024,
          ),
          timestamp: timestamp.add(const Duration(seconds: 1)),
        );

        expect(firstB, isNotNull);
        expect(firstB!.deviceId, 'power-b');
        expect(firstB.powerWatts, 250);
        expect(firstB.cadenceRpm, isNull);
      },
    );
  });

  group('Standard BLE adapter reset behavior', () {
    final DateTime timestamp = DateTime.utc(2026, 9, 9, 14);

    test('Cycling Power reset clears previous crank packet state', () {
      final CyclingPowerBleDeviceAdapter adapter =
          CyclingPowerBleDeviceAdapter();

      adapter.parseNotification(
        deviceId: 'power-1',
        characteristicUuid: BleUuids.cyclingPowerMeasurement,
        value: _cyclingPowerPacket(crankRevolutions: 10, crankEventTime: 0),
        timestamp: timestamp,
      );
      adapter.reset();
      final TelemetrySnapshot? snapshot = adapter.parseNotification(
        deviceId: 'power-1',
        characteristicUuid: BleUuids.cyclingPowerMeasurement,
        value: _cyclingPowerPacket(crankRevolutions: 11, crankEventTime: 1024),
        timestamp: timestamp.add(const Duration(seconds: 1)),
      );

      expect(snapshot, isNotNull);
      expect(snapshot!.cadenceRpm, isNull);
    });

    test('CSC reset clears previous wheel and crank packet state', () {
      final CscBleDeviceAdapter adapter = CscBleDeviceAdapter();

      adapter.parseNotification(
        deviceId: 'csc-1',
        characteristicUuid: BleUuids.cscMeasurement,
        value: _cscPacket(
          wheelRevolutions: 0,
          wheelEventTime: 0,
          crankRevolutions: 10,
          crankEventTime: 0,
        ),
        timestamp: timestamp,
      );
      adapter.reset();
      final TelemetrySnapshot? snapshot = adapter.parseNotification(
        deviceId: 'csc-1',
        characteristicUuid: BleUuids.cscMeasurement,
        value: _cscPacket(
          wheelRevolutions: 10,
          wheelEventTime: 1024,
          crankRevolutions: 11,
          crankEventTime: 1024,
        ),
        timestamp: timestamp.add(const Duration(seconds: 1)),
      );

      expect(snapshot, isNotNull);
      expect(snapshot!.speedKmh, isNull);
      expect(snapshot.cadenceRpm, isNull);
    });
  });
}

Uint8List _ftmsPacket() {
  return Uint8List.fromList(<int>[
    0x44,
    0x02,
    0xB8,
    0x0B,
    0xB4,
    0x00,
    0xFA,
    0x00,
    0x96,
  ]);
}

Uint8List _cyclingPowerPacket({
  required int crankRevolutions,
  required int crankEventTime,
}) {
  return Uint8List.fromList(<int>[
    0x20,
    0x00,
    0xFA,
    0x00,
    crankRevolutions & 0xFF,
    (crankRevolutions >> 8) & 0xFF,
    crankEventTime & 0xFF,
    (crankEventTime >> 8) & 0xFF,
  ]);
}

Uint8List _cscPacket({
  required int wheelRevolutions,
  required int wheelEventTime,
  required int crankRevolutions,
  required int crankEventTime,
}) {
  return Uint8List.fromList(<int>[
    0x03,
    wheelRevolutions & 0xFF,
    (wheelRevolutions >> 8) & 0xFF,
    (wheelRevolutions >> 16) & 0xFF,
    (wheelRevolutions >> 24) & 0xFF,
    wheelEventTime & 0xFF,
    (wheelEventTime >> 8) & 0xFF,
    crankRevolutions & 0xFF,
    (crankRevolutions >> 8) & 0xFF,
    crankEventTime & 0xFF,
    (crankEventTime >> 8) & 0xFF,
  ]);
}
