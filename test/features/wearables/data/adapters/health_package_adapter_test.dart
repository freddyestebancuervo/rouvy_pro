import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/core/error/exceptions.dart';
import 'package:rouvy_pro/core/health/health_availability.dart';
import 'package:rouvy_pro/core/health/health_permission_status.dart';
import 'package:rouvy_pro/core/health/health_platform_gateway.dart';
import 'package:rouvy_pro/features/wearables/data/adapters/health_package_adapter.dart';
import 'package:rouvy_pro/features/wearables/domain/entities/external_activity.dart';
import 'package:rouvy_pro/features/wearables/domain/entities/wearable_provider_type.dart';

/// Doble de prueba controlable — permite simular los 5 estados exigidos
/// sin depender de un dispositivo real con HealthKit/Health Connect. Esto
/// es exactamente lo que la capa de abstracción (`HealthPlatformGateway`)
/// hace posible: `HealthPackageAdapter` no sabe que esto no es HealthKit.
class FakeHealthPlatformGateway implements HealthPlatformGateway {
  HealthPermissionStatus statusToReturn = HealthPermissionStatus.granted;
  bool openSettingsCalled = false;
  List<HealthWorkout> workoutsToReturn = const <HealthWorkout>[];

  @override
  Future<HealthAvailability> checkAvailability() async {
    return switch (statusToReturn) {
      HealthPermissionStatus.notInstalled => HealthAvailability.notInstalled,
      HealthPermissionStatus.unavailable => HealthAvailability.unavailable,
      _ => HealthAvailability.available,
    };
  }

  @override
  Future<HealthPermissionStatus> requestPermissions() async => statusToReturn;

  @override
  Future<HealthPermissionStatus> checkPermissionStatus() async => statusToReturn;

  @override
  Future<void> openPermissionSettings() async {
    openSettingsCalled = true;
  }

  @override
  Future<List<HealthWorkout>> fetchWorkouts({required DateTime since, required DateTime until}) async {
    return workoutsToReturn;
  }
}

void main() {
  late FakeHealthPlatformGateway gateway;
  late HealthPackageAdapter adapter;

  setUp(() {
    gateway = FakeHealthPlatformGateway();
    adapter = HealthPackageAdapter(providerType: WearableProviderType.appleHealth, gateway: gateway);
  });

  group('HealthPackageAdapter — caso GRANTED', () {
    test('connect() no lanza excepción y deja isConnected en true', () async {
      gateway.statusToReturn = HealthPermissionStatus.granted;

      await adapter.connect();

      expect(await adapter.isConnected, isTrue);
    });

    test('fetchActivities() traduce los workouts del gateway a ExternalActivity', () async {
      gateway.statusToReturn = HealthPermissionStatus.granted;
      gateway.workoutsToReturn = <HealthWorkout>[
        HealthWorkout(
          id: 'w1',
          startTime: DateTime(2026, 1, 1, 8),
          endTime: DateTime(2026, 1, 1, 9),
          activityTypeName: 'CYCLING',
          totalDistanceMeters: 25000,
          totalEnergyBurnedKcal: 600,
        ),
      ];
      await adapter.connect();

      final List<ExternalActivity> activities = await adapter.fetchActivities();

      expect(activities, hasLength(1));
      expect(activities.first.type, ExternalActivityType.cycling);
      expect(activities.first.durationSeconds, 3600);
      expect(activities.first.distanceMeters, 25000);
      expect(activities.first.provider, WearableProviderType.appleHealth);
    });
  });

  group('HealthPackageAdapter — caso DENIED', () {
    test('connect() lanza HealthException con status denied', () async {
      gateway.statusToReturn = HealthPermissionStatus.denied;

      expect(
        () => adapter.connect(),
        throwsA(isA<HealthException>().having((e) => e.status, 'status', HealthPermissionStatus.denied)),
      );
    });
  });

  group('HealthPackageAdapter — caso PERMANENTLY DENIED', () {
    test('connect() lanza HealthException con status permanentlyDenied', () async {
      gateway.statusToReturn = HealthPermissionStatus.permanentlyDenied;

      expect(
        () => adapter.connect(),
        throwsA(
          isA<HealthException>().having((e) => e.status, 'status', HealthPermissionStatus.permanentlyDenied),
        ),
      );
    });
  });

  group('HealthPackageAdapter — caso NOT INSTALLED (Health Connect)', () {
    test('connect() lanza HealthException con status notInstalled', () async {
      gateway.statusToReturn = HealthPermissionStatus.notInstalled;

      expect(
        () => adapter.connect(),
        throwsA(isA<HealthException>().having((e) => e.status, 'status', HealthPermissionStatus.notInstalled)),
      );
    });
  });

  group('HealthPackageAdapter — caso UNAVAILABLE (HealthKit no disponible)', () {
    test('connect() lanza HealthException con status unavailable', () async {
      gateway.statusToReturn = HealthPermissionStatus.unavailable;

      expect(
        () => adapter.connect(),
        throwsA(isA<HealthException>().having((e) => e.status, 'status', HealthPermissionStatus.unavailable)),
      );
    });
  });

  group('HealthPackageAdapter — sin conectar', () {
    test('fetchActivities() devuelve lista vacía sin haber llamado a connect()', () async {
      final List<ExternalActivity> activities = await adapter.fetchActivities();
      expect(activities, isEmpty);
    });

    test('isConnected es false por defecto', () async {
      expect(await adapter.isConnected, isFalse);
    });
  });

  group('HealthPackageAdapter — disconnect', () {
    test('tras disconnect(), isConnected vuelve a false', () async {
      gateway.statusToReturn = HealthPermissionStatus.granted;
      await adapter.connect();

      await adapter.disconnect();

      expect(await adapter.isConnected, isFalse);
    });
  });

  group('HealthPackageAdapter — hint tras fetches vacíos repetidos (tarea B3)', () {
    test('emptyFetchesHintMessage es null antes de 3 fetches vacíos consecutivos', () async {
      final HealthPackageAdapter iosAdapter = HealthPackageAdapter(
        providerType: WearableProviderType.appleHealth,
        gateway: gateway,
        isIOS: () => true, // simula estar en iOS sin depender del host que corre el test
      );
      gateway.statusToReturn = HealthPermissionStatus.granted;
      gateway.workoutsToReturn = const <HealthWorkout>[];
      await iosAdapter.connect();

      await iosAdapter.fetchActivities();
      expect(iosAdapter.emptyFetchesHintMessage, isNull);

      await iosAdapter.fetchActivities();
      expect(iosAdapter.emptyFetchesHintMessage, isNull);
    });

    test('emptyFetchesHintMessage no es null a partir del 3er fetch vacío consecutivo en iOS', () async {
      final HealthPackageAdapter iosAdapter = HealthPackageAdapter(
        providerType: WearableProviderType.appleHealth,
        gateway: gateway,
        isIOS: () => true,
      );
      gateway.statusToReturn = HealthPermissionStatus.granted;
      gateway.workoutsToReturn = const <HealthWorkout>[];
      await iosAdapter.connect();

      await iosAdapter.fetchActivities();
      await iosAdapter.fetchActivities();
      await iosAdapter.fetchActivities();

      expect(iosAdapter.emptyFetchesHintMessage, isNotNull);
    });

    test('el contador se resetea en cuanto llega un fetch con datos', () async {
      final HealthPackageAdapter iosAdapter = HealthPackageAdapter(
        providerType: WearableProviderType.appleHealth,
        gateway: gateway,
        isIOS: () => true,
      );
      gateway.statusToReturn = HealthPermissionStatus.granted;
      gateway.workoutsToReturn = const <HealthWorkout>[];
      await iosAdapter.connect();

      await iosAdapter.fetchActivities();
      await iosAdapter.fetchActivities();
      await iosAdapter.fetchActivities(); // 3 vacíos → hint activo
      expect(iosAdapter.emptyFetchesHintMessage, isNotNull);

      gateway.workoutsToReturn = <HealthWorkout>[
        HealthWorkout(
          id: 'w1',
          startTime: DateTime(2026, 1, 1),
          endTime: DateTime(2026, 1, 1, 1),
          activityTypeName: 'CYCLING',
        ),
      ];
      await iosAdapter.fetchActivities(); // llega un dato real → resetea

      gateway.workoutsToReturn = const <HealthWorkout>[];
      await iosAdapter.fetchActivities(); // solo 1 vacío tras el reset

      expect(iosAdapter.emptyFetchesHintMessage, isNull);
    });

    test('googleFit (Android) nunca muestra el hint, aunque tenga 3+ fetches vacíos y "sea iOS"', () async {
      // isIOS: () => true a propósito: si el hint apareciera igual, sería
      // porque el chequeo de `providerType` no está funcionando — este
      // test aísla específicamente esa condición, no la de plataforma.
      final HealthPackageAdapter googleFitAdapter = HealthPackageAdapter(
        providerType: WearableProviderType.googleFit,
        gateway: gateway,
        isIOS: () => true,
      );
      gateway.statusToReturn = HealthPermissionStatus.granted;
      gateway.workoutsToReturn = const <HealthWorkout>[];
      await googleFitAdapter.connect();

      await googleFitAdapter.fetchActivities();
      await googleFitAdapter.fetchActivities();
      await googleFitAdapter.fetchActivities();

      expect(googleFitAdapter.emptyFetchesHintMessage, isNull);
    });

    test('en Android real (isIOS: false), Apple Health tampoco mostraría el hint', () async {
      final HealthPackageAdapter adapterOnAndroid = HealthPackageAdapter(
        providerType: WearableProviderType.appleHealth,
        gateway: gateway,
        isIOS: () => false,
      );
      gateway.statusToReturn = HealthPermissionStatus.granted;
      gateway.workoutsToReturn = const <HealthWorkout>[];
      await adapterOnAndroid.connect();

      await adapterOnAndroid.fetchActivities();
      await adapterOnAndroid.fetchActivities();
      await adapterOnAndroid.fetchActivities();

      expect(adapterOnAndroid.emptyFetchesHintMessage, isNull);
    });
  });
}
