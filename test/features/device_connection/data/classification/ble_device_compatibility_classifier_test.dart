import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/ble/ble_uuids.dart';
import 'package:rouvy_pro/features/device_connection/data/adapters/ble_device_adapter.dart';
import 'package:rouvy_pro/features/device_connection/data/adapters/ble_device_adapter_resolver.dart';
import 'package:rouvy_pro/features/device_connection/data/classification/ble_device_compatibility_classifier.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/ble_device_compatibility_status.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/sport_device_type.dart';

void main() {
  group('BleDeviceCompatibilityClassifier', () {
    const BleDeviceCompatibilityClassifier classifier =
        BleDeviceCompatibilityClassifier(
      resolver: StandardBleDeviceAdapterResolver(),
    );

    test('successful GATT FTMS match is standard compatible', () {
      final BleDeviceGattClassification result = classifier.classify(
        <BleDeviceCapability>[
          _capability(BleUuids.fitnessMachine, BleUuids.indoorBikeData),
        ],
      );

      expect(result.status, BleDeviceCompatibilityStatus.standardCompatible);
      expect(result.type, SportDeviceType.smartTrainer);
    });

    test('successful GATT Cycling Power match is standard compatible', () {
      final BleDeviceGattClassification result = classifier.classify(
        <BleDeviceCapability>[
          _capability(BleUuids.cyclingPower, BleUuids.cyclingPowerMeasurement),
        ],
      );

      expect(result.status, BleDeviceCompatibilityStatus.standardCompatible);
      expect(result.type, SportDeviceType.powerMeter);
    });

    test('successful GATT CSC match is standard compatible', () {
      final BleDeviceGattClassification result = classifier.classify(
        <BleDeviceCapability>[
          _capability(BleUuids.cyclingSpeedCadence, BleUuids.cscMeasurement),
        ],
      );

      expect(result.status, BleDeviceCompatibilityStatus.standardCompatible);
      expect(result.type, SportDeviceType.speedCadenceCombo);
    });

    test('successful GATT Heart Rate match is standard compatible', () {
      final BleDeviceGattClassification result = classifier.classify(
        <BleDeviceCapability>[
          _capability(BleUuids.heartRate, BleUuids.heartRateMeasurement),
        ],
      );

      expect(result.status, BleDeviceCompatibilityStatus.standardCompatible);
      expect(result.type, SportDeviceType.heartRateMonitor);
    });

    test('multi-standard device remains one standard-compatible device', () {
      final BleDeviceGattClassification result = classifier.classify(
        <BleDeviceCapability>[
          _capability(BleUuids.heartRate, BleUuids.heartRateMeasurement),
          _capability(BleUuids.cyclingPower, BleUuids.cyclingPowerMeasurement),
          _capability(BleUuids.fitnessMachine, BleUuids.indoorBikeData),
        ],
      );

      expect(result.status, BleDeviceCompatibilityStatus.standardCompatible);
      expect(result.type, SportDeviceType.smartTrainer);
    });

    test('successful GATT unknown service only is unsupported', () {
      final BleDeviceGattClassification result = classifier.classify(
        <BleDeviceCapability>[
          _capability(
            '12345678-1234-5678-1234-56789abcdef0',
            '12345678-1234-5678-1234-56789abcdef1',
          ),
        ],
      );

      expect(result.status, BleDeviceCompatibilityStatus.unsupported);
      expect(result.type, SportDeviceType.unknown);
    });

    test(
        'advertised standard UUID without telemetry characteristic is unsupported',
        () {
      final BleDeviceGattClassification result = classifier.classify(
        <BleDeviceCapability>[
          _capability(BleUuids.fitnessMachine, BleUuids.fitnessMachineFeature),
        ],
      );

      expect(result.status, BleDeviceCompatibilityStatus.unsupported);
    });

    test('H9-like name is not evidence for Korixa compatibility', () {
      final BleDeviceGattClassification result = classifier.classify(
        <BleDeviceCapability>[],
      );

      const String ignoredCommercialName = 'H9 Ultra';
      expect(ignoredCommercialName, contains('H9'));
      expect(
        result.status,
        isNot(BleDeviceCompatibilityStatus.korixaCompatible),
      );
      expect(result.status, isNot(BleDeviceCompatibilityStatus.korixaVerified));
    });

    test('Nordic UART alone is not a Korixa-compatible telemetry protocol', () {
      final BleDeviceGattClassification result = classifier.classify(
        <BleDeviceCapability>[_nordicUartCapability()],
      );

      expect(result.status, BleDeviceCompatibilityStatus.unsupported);
      expect(
        result.status,
        isNot(BleDeviceCompatibilityStatus.korixaCompatible),
      );
      expect(result.status, isNot(BleDeviceCompatibilityStatus.korixaVerified));
    });
  });
}

BleDeviceCapability _capability(String serviceUuid, String characteristicUuid) {
  return BleDeviceCapability(
    serviceUuid: serviceUuid,
    characteristicUuids: <String>{characteristicUuid},
  );
}

BleDeviceCapability _nordicUartCapability() {
  return const BleDeviceCapability(
    serviceUuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    characteristicUuids: <String>{
      '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
      '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    },
  );
}
