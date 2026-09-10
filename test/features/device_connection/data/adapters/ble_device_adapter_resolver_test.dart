import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/ble/ble_uuids.dart';
import 'package:rouvy_pro/features/device_connection/data/adapters/ble_device_adapter.dart';
import 'package:rouvy_pro/features/device_connection/data/adapters/ble_device_adapter_resolver.dart';
import 'package:rouvy_pro/features/device_connection/data/adapters/standard_ble_device_adapters.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/telemetry_source.dart';

void main() {
  group('BleDeviceAdapterResolver', () {
    const StandardBleDeviceAdapterResolver resolver =
        StandardBleDeviceAdapterResolver();

    test('FTMS capability resolves to the standard FTMS adapter', () {
      final List<BleDeviceAdapter> adapters = resolver.resolve(
        <BleDeviceCapability>[
          _capability(BleUuids.fitnessMachine, BleUuids.indoorBikeData),
        ],
      );

      expect(adapters, hasLength(1));
      expect(adapters.single, isA<FtmsBleDeviceAdapter>());
      expect(adapters.single.source, TelemetrySourceKind.ftms);
    });

    test(
      'Heart Rate capability resolves to the standard Heart Rate adapter',
      () {
        final List<BleDeviceAdapter> adapters = resolver.resolve(
          <BleDeviceCapability>[
            _capability(BleUuids.heartRate, BleUuids.heartRateMeasurement),
          ],
        );

        expect(adapters, hasLength(1));
        expect(adapters.single, isA<HeartRateBleDeviceAdapter>());
        expect(adapters.single.source, TelemetrySourceKind.heartRate);
      },
    );

    test(
      'Cycling Power capability resolves to the standard Cycling Power adapter',
      () {
        final List<BleDeviceAdapter> adapters = resolver.resolve(
          <BleDeviceCapability>[
            _capability(
              BleUuids.cyclingPower,
              BleUuids.cyclingPowerMeasurement,
            ),
          ],
        );

        expect(adapters, hasLength(1));
        expect(adapters.single, isA<CyclingPowerBleDeviceAdapter>());
        expect(adapters.single.source, TelemetrySourceKind.cyclingPower);
      },
    );

    test('CSC capability resolves to the standard CSC adapter', () {
      final List<BleDeviceAdapter> adapters = resolver.resolve(
        <BleDeviceCapability>[
          _capability(BleUuids.cyclingSpeedCadence, BleUuids.cscMeasurement),
        ],
      );

      expect(adapters, hasLength(1));
      expect(adapters.single, isA<CscBleDeviceAdapter>());
      expect(adapters.single.source, TelemetrySourceKind.csc);
    });

    test('unsupported/no-match capability returns an empty safe result', () {
      final List<BleDeviceAdapter> adapters = resolver.resolve(
        <BleDeviceCapability>[
          _capability(BleUuids.battery, BleUuids.batteryLevel),
        ],
      );

      expect(adapters, isEmpty);
    });

    test(
      'service without its telemetry characteristic is not treated as supported',
      () {
        final List<BleDeviceAdapter> adapters = resolver.resolve(
          <BleDeviceCapability>[
            _capability(
              BleUuids.fitnessMachine,
              BleUuids.fitnessMachineFeature,
            ),
          ],
        );

        expect(adapters, isEmpty);
      },
    );

    test(
      'multiple capabilities resolve deterministically by standard priority',
      () {
        final List<BleDeviceAdapter>
        adapters = resolver.resolve(<BleDeviceCapability>[
          _capability(BleUuids.heartRate, BleUuids.heartRateMeasurement),
          _capability(BleUuids.cyclingSpeedCadence, BleUuids.cscMeasurement),
          _capability(BleUuids.fitnessMachine, BleUuids.indoorBikeData),
          _capability(BleUuids.cyclingPower, BleUuids.cyclingPowerMeasurement),
        ]);

        expect(
          adapters.map((BleDeviceAdapter adapter) => adapter.source),
          <TelemetrySourceKind>[
            TelemetrySourceKind.ftms,
            TelemetrySourceKind.cyclingPower,
            TelemetrySourceKind.csc,
            TelemetrySourceKind.heartRate,
          ],
        );
      },
    );

    test('resolution is case-insensitive', () {
      final List<BleDeviceAdapter> adapters = resolver
          .resolve(<BleDeviceCapability>[
            _capability(
              BleUuids.heartRate.toUpperCase(),
              BleUuids.heartRateMeasurement.toUpperCase(),
            ),
          ]);

      expect(adapters.single, isA<HeartRateBleDeviceAdapter>());
    });
  });
}

BleDeviceCapability _capability(String serviceUuid, String characteristicUuid) {
  return BleDeviceCapability(
    serviceUuid: serviceUuid,
    characteristicUuids: <String>{characteristicUuid},
  );
}
