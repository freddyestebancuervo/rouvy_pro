import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/exceptions.dart';
import 'package:rouvy_pro/core/health/health_permission_status.dart';
import 'package:rouvy_pro/features/wearables/data/adapters/wearable_adapter.dart';
import 'package:rouvy_pro/features/wearables/data/repositories/wearable_repository_impl.dart';
import 'package:rouvy_pro/features/wearables/domain/entities/wearable_connection.dart';
import 'package:rouvy_pro/features/wearables/domain/entities/wearable_connection_status.dart';
import 'package:rouvy_pro/features/wearables/domain/entities/wearable_provider_type.dart';

class MockWearableAdapter extends Mock implements WearableAdapter {}

void main() {
  late MockWearableAdapter appleHealthAdapter;
  late WearableRepositoryImpl repository;

  setUp(() {
    appleHealthAdapter = MockWearableAdapter();
    when(() => appleHealthAdapter.providerType).thenReturn(WearableProviderType.appleHealth);
    when(() => appleHealthAdapter.requiresPartnerApproval).thenReturn(false);

    repository = WearableRepositoryImpl(
      adapters: <WearableProviderType, WearableAdapter>{WearableProviderType.appleHealth: appleHealthAdapter},
    );
  });

  test('connect() exitoso deja el estado en connected', () async {
    when(() => appleHealthAdapter.connect()).thenAnswer((_) async {});

    final List<WearableConnection> emissions = <WearableConnection>[];
    final sub = repository.connectionsStream.listen((list) => emissions.add(list.first));

    await repository.connect(WearableProviderType.appleHealth);
    await Future<void>.delayed(Duration.zero);

    expect(emissions.last.status, WearableConnectionStatus.connected);
    expect(emissions.last.errorMessage, isNull);
    await sub.cancel();
  });

  test('connect() con permiso denegado permanentemente deja el estado en error con mensaje', () async {
    when(() => appleHealthAdapter.connect()).thenThrow(
      const HealthException('Permiso denegado permanentemente.', status: HealthPermissionStatus.permanentlyDenied),
    );

    final List<WearableConnection> emissions = <WearableConnection>[];
    final sub = repository.connectionsStream.listen((list) => emissions.add(list.first));

    await repository.connect(WearableProviderType.appleHealth);
    await Future<void>.delayed(Duration.zero);

    expect(emissions.last.status, WearableConnectionStatus.error);
    expect(emissions.last.errorMessage, 'Permiso denegado permanentemente.');
    await sub.cancel();
  });

  test('un nuevo suscriptor recibe el estado ACTUAL de inmediato, no solo cambios futuros', () async {
    when(() => appleHealthAdapter.connect()).thenAnswer((_) async {});
    await repository.connect(WearableProviderType.appleHealth);

    // Suscripción TARDÍA — después de que el estado ya cambió.
    final List<WearableConnection> first = await repository.connectionsStream.first;

    expect(first.first.status, WearableConnectionStatus.connected);
  });
}
