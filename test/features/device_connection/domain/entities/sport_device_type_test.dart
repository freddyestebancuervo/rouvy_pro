import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/sport_device_type.dart';

void main() {
  group('SportDeviceType.fromAdvertisedServices', () {
    test('clasifica como smartTrainer cuando anuncia Fitness Machine Service', () {
      final SportDeviceType type = SportDeviceType.fromAdvertisedServices(
        <String>['00001826-0000-1000-8000-00805f9b34fb'],
      );
      expect(type, SportDeviceType.smartTrainer);
    });

    test('prioriza smartTrainer sobre powerMeter si anuncia ambos servicios', () {
      final SportDeviceType type = SportDeviceType.fromAdvertisedServices(<String>[
        '00001818-0000-1000-8000-00805f9b34fb', // cycling power
        '00001826-0000-1000-8000-00805f9b34fb', // fitness machine
      ]);
      expect(type, SportDeviceType.smartTrainer);
    });

    test('clasifica como heartRateMonitor cuando solo anuncia Heart Rate Service', () {
      final SportDeviceType type = SportDeviceType.fromAdvertisedServices(
        <String>['0000180d-0000-1000-8000-00805f9b34fb'],
      );
      expect(type, SportDeviceType.heartRateMonitor);
    });

    test('clasifica como unknown si no anuncia ningún servicio reconocido', () {
      final SportDeviceType type = SportDeviceType.fromAdvertisedServices(
        <String>['0000180f-0000-1000-8000-00805f9b34fb'], // battery service, no deportivo
      );
      expect(type, SportDeviceType.unknown);
    });

    test('la comparación de UUIDs no distingue mayúsculas/minúsculas', () {
      final SportDeviceType type = SportDeviceType.fromAdvertisedServices(
        <String>['0000180D-0000-1000-8000-00805F9B34FB'],
      );
      expect(type, SportDeviceType.heartRateMonitor);
    });
  });
}
