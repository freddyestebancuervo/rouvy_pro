import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/network/network_info.dart';
import 'package:rouvy_pro/core/sync/firestore_sync_service.dart';
import 'package:rouvy_pro/core/sync/sync_status.dart';

class MockFirebaseFirestore extends Mock implements FirebaseFirestore {}

/// Doble de prueba simple en vez de un mock de `NetworkInfo` con
/// mocktail — el test necesita controlar EXACTAMENTE cuándo se emite cada
/// evento de conectividad (para verificar el orden de los `SyncStatus`
/// resultantes), lo cual es más directo con un `StreamController` propio
/// que configurando expectativas de mocktail evento a evento.
class FakeNetworkInfo implements NetworkInfo {
  final StreamController<bool> controller = StreamController<bool>.broadcast();

  @override
  Future<bool> get isConnected async => true;

  @override
  Stream<bool> get onConnectivityChanged => controller.stream;
}

void main() {
  late FakeNetworkInfo networkInfo;
  late MockFirebaseFirestore firestore;
  late FirestoreSyncService service;

  setUp(() {
    networkInfo = FakeNetworkInfo();
    firestore = MockFirebaseFirestore();
    when(() => firestore.waitForPendingWrites()).thenAnswer((_) async {});
    service = FirestoreSyncService(networkInfo: networkInfo, firestore: firestore);
  });

  tearDown(() {
    service.dispose();
    networkInfo.controller.close();
  });

  test('emite offline en cuanto se pierde la conectividad', () async {
    service.start();

    final Future<SyncStatus> first = service.statusStream.first;
    networkInfo.controller.add(false);

    expect(await first, SyncStatus.offline);
  });

  test(
    'al recuperar la conexión tras estar offline, pasa por syncingPendingWrites antes de online',
    () async {
      service.start();

      final List<SyncStatus> emitted = <SyncStatus>[];
      final StreamSubscription<SyncStatus> sub = service.statusStream.listen(emitted.add);

      networkInfo.controller.add(false); // offline
      await Future<void>.delayed(Duration.zero);
      networkInfo.controller.add(true); // vuelve la conexión
      await Future<void>.delayed(Duration.zero);

      expect(emitted, <SyncStatus>[
        SyncStatus.offline,
        SyncStatus.syncingPendingWrites,
        SyncStatus.online,
      ]);
      verify(() => firestore.waitForPendingWrites()).called(1);
      await sub.cancel();
    },
  );

  test('si nunca estuvo offline, una notificación de "conectado" NO dispara waitForPendingWrites', () async {
    service.start();

    networkInfo.controller.add(true);
    await Future<void>.delayed(Duration.zero);

    verifyNever(() => firestore.waitForPendingWrites());
  });

  test('un fallo de waitForPendingWrites no deja el servicio en un estado roto', () async {
    when(() => firestore.waitForPendingWrites()).thenThrow(Exception('conexión perdida de nuevo'));
    service.start();

    final List<SyncStatus> emitted = <SyncStatus>[];
    final StreamSubscription<SyncStatus> sub = service.statusStream.listen(emitted.add);

    networkInfo.controller.add(false);
    await Future<void>.delayed(Duration.zero);
    networkInfo.controller.add(true);
    await Future<void>.delayed(Duration.zero);

    // A pesar del error, el servicio sigue reportando `online` (mejor
    // esfuerzo) en vez de quedarse colgado en `syncingPendingWrites` para
    // siempre.
    expect(emitted.last, SyncStatus.online);
    await sub.cancel();
  });
}
