import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/wearables/data/adapters/garmin_adapter.dart';
import 'package:rouvy_pro/features/wearables/domain/entities/external_activity.dart';
import 'package:rouvy_pro/features/wearables/domain/entities/wearable_provider_type.dart';

void main() {
  group('MockWearableAdapter (probado vía GarminAdapter)', () {
    test('requiresPartnerApproval siempre es true', () {
      expect(GarminAdapter().requiresPartnerApproval, isTrue);
    });

    test('providerType corresponde al proveedor correcto', () {
      expect(GarminAdapter().providerType, WearableProviderType.garmin);
    });

    test('antes de conectar, isConnected es false y fetchActivities devuelve vacío', () async {
      final GarminAdapter adapter = GarminAdapter();

      expect(await adapter.isConnected, isFalse);
      expect(await adapter.fetchActivities(), isEmpty);
    });

    test('tras connect(), isConnected es true y fetchActivities devuelve actividades simuladas', () async {
      final GarminAdapter adapter = GarminAdapter();

      await adapter.connect();
      expect(await adapter.isConnected, isTrue);

      final List<ExternalActivity> activities = await adapter.fetchActivities();
      expect(activities, isNotEmpty);
      // Todas las actividades simuladas deben distinguirse claramente de
      // datos reales mediante el prefijo MOCK- en su ID.
      expect(activities.every((ExternalActivity a) => a.id.startsWith('MOCK-garmin-')), isTrue);
      expect(activities.every((ExternalActivity a) => a.provider == WearableProviderType.garmin), isTrue);
    });

    test('tras disconnect(), isConnected vuelve a false', () async {
      final GarminAdapter adapter = GarminAdapter();

      await adapter.connect();
      await adapter.disconnect();

      expect(await adapter.isConnected, isFalse);
    });
  });
}
