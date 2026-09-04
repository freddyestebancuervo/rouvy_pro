import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/features/device_connection/domain/entities/ble_device.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/device_connection_status.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/sport_device_type.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/telemetry_snapshot.dart';
import 'package:rouvy_pro/features/device_connection/domain/repositories/device_repository.dart';
import 'package:rouvy_pro/features/device_connection/domain/usecases/observe_connected_devices_usecase.dart';
import 'package:rouvy_pro/features/device_connection/domain/usecases/observe_telemetry_usecase.dart';
import 'package:rouvy_pro/features/device_connection/presentation/providers/device_providers.dart';
import 'package:rouvy_pro/features/training/data/datasources/ride_session_snapshot_local_datasource.dart';
import 'package:rouvy_pro/features/training/data/models/ride_session_record_model.dart';
import 'package:rouvy_pro/features/training/domain/entities/ride_session_summary.dart';
import 'package:rouvy_pro/features/training/domain/entities/ride_session_target.dart';
import 'package:rouvy_pro/features/training/presentation/providers/ride_session_controller.dart';
import 'package:rouvy_pro/features/training/presentation/providers/ride_session_snapshot_providers.dart';

class MockDeviceRepository extends Mock implements DeviceRepository {}

/// Datasource de snapshot en memoria — evita depender de
/// `shared_preferences`/DI real en estos tests, y permite inspeccionar
/// directamente qué se guardó (los tests de recuperación lo leen).
class FakeSnapshotDataSource implements RideSessionSnapshotLocalDataSource {
  RideSessionSnapshotData? stored;

  @override
  Future<void> save(RideSessionSnapshotData snapshot) async => stored = snapshot;

  @override
  Future<RideSessionSnapshotData?> load() async => stored;

  @override
  Future<void> clear() async => stored = null;
}

void main() {
  late MockDeviceRepository repository;
  late StreamController<List<BleDevice>> devicesController;
  late StreamController<TelemetrySnapshot> telemetryController;
  late FakeSnapshotDataSource snapshotDataSource;
  late ProviderContainer container;

  const String trainerId = 'trainer-1';
  const BleDevice connectedTrainer = BleDevice(
    id: trainerId,
    name: 'Wahoo KICKR',
    type: SportDeviceType.smartTrainer,
    status: DeviceConnectionStatus.connected,
  );

  setUp(() {
    repository = MockDeviceRepository();
    devicesController = StreamController<List<BleDevice>>.broadcast();
    telemetryController = StreamController<TelemetrySnapshot>.broadcast();
    snapshotDataSource = FakeSnapshotDataSource();

    when(() => repository.connectedDevicesStream).thenAnswer((_) => devicesController.stream);
    when(() => repository.telemetryStreamFor(trainerId)).thenAnswer((_) => telemetryController.stream);

    container = ProviderContainer(
      overrides: [
        observeConnectedDevicesUseCaseProvider.overrideWithValue(ObserveConnectedDevicesUseCase(repository)),
        observeTelemetryUseCaseProvider.overrideWithValue(ObserveTelemetryUseCase(repository)),
        rideSessionSnapshotDataSourceProvider.overrideWithValue(snapshotDataSource),
      ],
    );
    addTearDown(container.dispose);
  });

  tearDown(() async {
    await devicesController.close();
    await telemetryController.close();
  });

  test('start() pone la sesión en fase activa', () {
    container.read(rideSessionControllerProvider.notifier).start();

    final RideSessionState state = container.read(rideSessionControllerProvider);
    expect(state.phase, RideSessionPhase.active);
  });

  test(
    'la telemetría de un dispositivo recién conectado se fusiona en el estado de la sesión',
    () async {
      container.read(rideSessionControllerProvider.notifier).start();

      devicesController.add(<BleDevice>[connectedTrainer]);
      await Future<void>.delayed(Duration.zero);

      telemetryController.add(
        TelemetrySnapshot(deviceId: trainerId, timestamp: DateTime.now(), speedKmh: 32, powerWatts: 210),
      );
      await Future<void>.delayed(Duration.zero);

      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.telemetry.speedKmh, 32);
      expect(state.telemetry.powerWatts, 210);
      expect(state.connectedDeviceCount, 1);
    },
  );

  test('pause() detiene la fase pero conserva la última lectura', () async {
    container.read(rideSessionControllerProvider.notifier).start();
    devicesController.add(<BleDevice>[connectedTrainer]);
    await Future<void>.delayed(Duration.zero);
    telemetryController.add(
      TelemetrySnapshot(deviceId: trainerId, timestamp: DateTime.now(), speedKmh: 25, powerWatts: 150),
    );
    await Future<void>.delayed(Duration.zero);

    container.read(rideSessionControllerProvider.notifier).pause();

    final RideSessionState state = container.read(rideSessionControllerProvider);
    expect(state.phase, RideSessionPhase.paused);
    expect(state.telemetry.speedKmh, 25); // se conserva, no se resetea a 0
  });

  test('finish() produce un resumen con la telemetría final y pasa a fase finished', () async {
    container.read(rideSessionControllerProvider.notifier).start();
    devicesController.add(<BleDevice>[connectedTrainer]);
    await Future<void>.delayed(Duration.zero);
    telemetryController.add(
      TelemetrySnapshot(deviceId: trainerId, timestamp: DateTime.now(), speedKmh: 30, powerWatts: 200),
    );
    await Future<void>.delayed(Duration.zero);

    final summary = container.read(rideSessionControllerProvider.notifier).finish();

    expect(summary.finalTelemetry.powerWatts, 200);
    expect(summary.connectedDeviceCount, 1);
    expect(container.read(rideSessionControllerProvider).phase, RideSessionPhase.finished);
  });

  test('reset() vuelve la sesión a idle', () async {
    container.read(rideSessionControllerProvider.notifier).start();
    container.read(rideSessionControllerProvider.notifier).finish();

    container.read(rideSessionControllerProvider.notifier).reset();

    expect(container.read(rideSessionControllerProvider).phase, RideSessionPhase.idle);
  });

  group('Snapshot de recuperación (tarea B1)', () {
    test('finish() limpia cualquier snapshot guardado — no queda nada que recuperar', () async {
      container.read(rideSessionControllerProvider.notifier).start();
      snapshotDataSource.stored = const RideSessionSnapshotData(
        startTimeIso: '2026-01-01T08:00:00.000',
        elapsedSeconds: 120,
        distanceMeters: 1000,
        caloriesKcal: 30,
        connectedDeviceCount: 1,
        savedAtIso: '2026-01-01T08:02:00.000',
      );

      container.read(rideSessionControllerProvider.notifier).finish();
      await Future<void>.delayed(Duration.zero);

      expect(snapshotDataSource.stored, isNull);
    });

    test('resumeFromSnapshot() continúa la distancia/calorías acumuladas, no reinicia a cero', () {
      const RideSessionSnapshotData snapshot = RideSessionSnapshotData(
        startTimeIso: '2026-01-01T08:00:00.000',
        elapsedSeconds: 300,
        distanceMeters: 2500,
        caloriesKcal: 60,
        connectedDeviceCount: 1,
        savedAtIso: '2026-01-01T08:05:00.000',
      );

      container.read(rideSessionControllerProvider.notifier).resumeFromSnapshot(snapshot);

      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.phase, RideSessionPhase.active);
      expect(state.telemetry.distanceMeters, 2500);
      expect(state.telemetry.caloriesKcal, 60);
      expect(state.elapsed, const Duration(seconds: 300));
    });

    test('checkForRecoverableSnapshot() expone lo que haya en el datasource inyectado', () async {
      snapshotDataSource.stored = const RideSessionSnapshotData(
        startTimeIso: '2026-01-01T08:00:00.000',
        elapsedSeconds: 60,
        distanceMeters: 500,
        caloriesKcal: 15,
        connectedDeviceCount: 0,
        savedAtIso: '2026-01-01T08:01:00.000',
      );

      final RideSessionSnapshotData? result =
          await container.read(rideSessionControllerProvider.notifier).checkForRecoverableSnapshot();

      expect(result, isNotNull);
      expect(result!.distanceMeters, 500);
    });

    test('discardRecoverableSnapshot() lo elimina del datasource', () async {
      snapshotDataSource.stored = const RideSessionSnapshotData(
        startTimeIso: '2026-01-01T08:00:00.000',
        elapsedSeconds: 60,
        distanceMeters: 500,
        caloriesKcal: 15,
        connectedDeviceCount: 0,
        savedAtIso: '2026-01-01T08:01:00.000',
      );

      await container.read(rideSessionControllerProvider.notifier).discardRecoverableSnapshot();

      expect(snapshotDataSource.stored, isNull);
    });
  });

  // -------------------------------------------------------------------
  // KORIXA-MVP-VERTICAL-SLICE-01 — progreso y finalización de ruta
  // (Sección 15/16 del encargo, items 6-20). Timestamps controlados a
  // mano (nunca `sleep`/tiempo real): `TelemetryAggregator.ingest()`
  // integra distancia a partir del delta entre `TelemetrySnapshot.timestamp`
  // consecutivos, nunca del reloj de pared — así estos tests son 100%
  // deterministas.
  // -------------------------------------------------------------------
  group('KORIXA-MVP-VERTICAL-SLICE-01 — progreso y finalización de ruta', () {
    const RideSessionTarget route1km =
        RideSessionTarget(routeId: 'route-1', routeName: 'Ruta de prueba', routeTotalDistanceMeters: 1000);

    final DateTime baseTime = DateTime(2026, 1, 1, 8);

    /// Envía un snapshot a `speedKmh` en `timestamp` y deja que el
    /// listener del controller lo procese (misma técnica que el resto
    /// del archivo: `Future<void>.delayed(Duration.zero)`).
    Future<void> feed(DateTime timestamp, {required double speedKmh}) async {
      telemetryController.add(
        TelemetrySnapshot(deviceId: trainerId, timestamp: timestamp, speedKmh: speedKmh, powerWatts: 150),
      );
      await Future<void>.delayed(Duration.zero);
    }

    /// Conecta el trainer y arranca una sesión "route-aware" — deja el
    /// controller listo para que los tests solo tengan que alimentar
    /// snapshots de telemetría.
    Future<void> startRouteSession() async {
      container.read(rideSessionControllerProvider.notifier).start(target: route1km);
      devicesController.add(<BleDevice>[connectedTrainer]);
      await Future<void>.delayed(Duration.zero);
    }

    test('6. estado inicial: routeProgress = 0% antes de cualquier telemetría', () async {
      await startRouteSession();

      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.isRouteBacked, isTrue);
      expect(state.routeProgress, 0);
    });

    test('7. telemetría con velocidad avanza la distancia acumulada (y el progreso)', () async {
      await startRouteSession();

      // 36 km/h = 10 m/s. Snapshot base (sin distancia, fija el punto de
      // partida) + un snapshot 10s después → 100 m acumulados.
      await feed(baseTime, speedKmh: 36);
      await feed(baseTime.add(const Duration(seconds: 10)), speedKmh: 36);

      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.telemetry.distanceMeters, 100);
      expect(state.routeProgress, closeTo(0.1, 0.0001));
    });

    test('8. velocidad cero NO avanza la distancia', () async {
      await startRouteSession();

      await feed(baseTime, speedKmh: 36);
      await feed(baseTime.add(const Duration(seconds: 10)), speedKmh: 36); // 100 m
      final double distanceAfterMoving = container.read(rideSessionControllerProvider).telemetry.distanceMeters;

      await feed(baseTime.add(const Duration(seconds: 20)), speedKmh: 0);

      final double distanceAfterStopping = container.read(rideSessionControllerProvider).telemetry.distanceMeters;
      expect(distanceAfterStopping, distanceAfterMoving);
    });

    test('9. el progreso es monótono — nunca retrocede mientras la sesión avanza', () async {
      await startRouteSession();

      final List<double> observedProgress = <double>[];
      DateTime t = baseTime;
      await feed(t, speedKmh: 36);
      observedProgress.add(container.read(rideSessionControllerProvider).routeProgress);

      for (int i = 0; i < 5; i++) {
        t = t.add(const Duration(seconds: 10));
        await feed(t, speedKmh: 36);
        observedProgress.add(container.read(rideSessionControllerProvider).routeProgress);
      }

      for (int i = 1; i < observedProgress.length; i++) {
        expect(observedProgress[i], greaterThanOrEqualTo(observedProgress[i - 1]));
      }
    });

    test('10/11. el progreso se satura en 100% — nunca visible por encima de 1.0 ni aunque el acumulado se pase', () async {
      await startRouteSession();

      DateTime t = baseTime;
      await feed(t, speedKmh: 36);
      for (int i = 0; i < 8; i++) {
        t = t.add(const Duration(seconds: 10));
        await feed(t, speedKmh: 36); // 8 * 100 m = 800 m (80%)
      }
      // Salto grande en un solo intervalo (144 km/h ≈ 40 m/s → 400 m en
      // 10 s) para forzar un overshoot REAL del acumulado por encima del
      // total exacto de la ruta (1000 m) — el punto es comprobar que,
      // aunque `telemetry.distanceMeters` sí puede pasarse, el progreso
      // mostrado NUNCA aparece por encima de 100%.
      t = t.add(const Duration(seconds: 10));
      await feed(t, speedKmh: 144); // 800 + 400 = 1200 m > 1000 m

      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.telemetry.distanceMeters, greaterThan(1000)); // el acumulado real sí se pasó…
      expect(state.routeProgress, 1.0); // …pero el progreso mostrado se satura exacto en 100%.
      expect(state.routeProgress, lessThanOrEqualTo(1.0));
      expect(state.phase, RideSessionPhase.finished); // y la ruta se autocompletó al cruzar el umbral
    });

    test('12. pause() congela el progreso — telemetría enviada mientras está pausada no se procesa', () async {
      await startRouteSession();

      await feed(baseTime, speedKmh: 36);
      await feed(baseTime.add(const Duration(seconds: 10)), speedKmh: 36); // 100 m / 10%
      final double progressBeforePause = container.read(rideSessionControllerProvider).routeProgress;

      container.read(rideSessionControllerProvider.notifier).pause();
      expect(container.read(rideSessionControllerProvider).phase, RideSessionPhase.paused);

      // La suscripción ya se canceló en pause() — este snapshot no debe
      // llegar a ningún lado.
      await feed(baseTime.add(const Duration(seconds: 20)), speedKmh: 36);

      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.routeProgress, progressBeforePause);
      expect(state.phase, RideSessionPhase.paused);
    });

    test('13. resume() continúa integrando distancia desde donde quedó, no reinicia', () async {
      await startRouteSession();

      await feed(baseTime, speedKmh: 36);
      await feed(baseTime.add(const Duration(seconds: 10)), speedKmh: 36); // 100 m
      final double distanceBeforePause = container.read(rideSessionControllerProvider).telemetry.distanceMeters;

      container.read(rideSessionControllerProvider.notifier).resume(); // no-op: todavía no está paused
      container.read(rideSessionControllerProvider.notifier).pause();
      container.read(rideSessionControllerProvider.notifier).resume();
      expect(container.read(rideSessionControllerProvider).phase, RideSessionPhase.active);

      // El stream de dispositivos es broadcast — un listener nuevo (el
      // que crea `resume()` al re-suscribirse) no recibe el evento viejo,
      // así que hay que volver a emitirlo, igual que un stream BLE real
      // seguiría reportando "conectado" periódicamente.
      devicesController.add(<BleDevice>[connectedTrainer]);
      await Future<void>.delayed(Duration.zero);

      // El aggregator nunca se resetea — este próximo snapshot sigue
      // integrando desde el `_lastTimestamp` de ANTES del pause.
      await feed(baseTime.add(const Duration(seconds: 20)), speedKmh: 36); // +100 m

      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.telemetry.distanceMeters, distanceBeforePause + 100);
      expect(state.routeProgress, closeTo(0.2, 0.0001));
    });

    test(
      '14. un hueco largo de desconexión (>10s) NO crea un salto artificial de distancia',
      () async {
        await startRouteSession();

        await feed(baseTime, speedKmh: 36);
        await feed(baseTime.add(const Duration(seconds: 10)), speedKmh: 36); // 100 m
        final double distanceBeforeGap = container.read(rideSessionControllerProvider).telemetry.distanceMeters;

        // Hueco de 60s (simula una reconexión larga) — el propio
        // `TelemetryAggregator` descarta cualquier intervalo > 10s, sin
        // cambios de este PR: se reusa tal cual.
        await feed(baseTime.add(const Duration(seconds: 70)), speedKmh: 36);

        final double distanceAfterGap = container.read(rideSessionControllerProvider).telemetry.distanceMeters;
        expect(distanceAfterGap, distanceBeforeGap); // el hueco en sí no sumó nada
      },
    );

    test('15/20. cruzar el umbral finaliza la ruta automáticamente y produce routeCompleted = true', () async {
      await startRouteSession();

      DateTime t = baseTime;
      await feed(t, speedKmh: 36);
      for (int i = 0; i < 10; i++) {
        t = t.add(const Duration(seconds: 10));
        await feed(t, speedKmh: 36); // 10 * 100 m = 1000 m = 100%
      }

      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.phase, RideSessionPhase.finished);
      expect(state.summary, isNotNull);
      expect(state.summary!.routeCompleted, isTrue);
      expect(state.summary!.routeId, 'route-1');
      expect(state.summary!.routeName, 'Ruta de prueba');
      expect(state.summary!.routeTotalDistanceMeters, 1000);
    });

    test('16/17. la finalización dispara una única vez — telemetría adicional después no re-finaliza', () async {
      await startRouteSession();

      DateTime t = baseTime;
      await feed(t, speedKmh: 36);
      for (int i = 0; i < 10; i++) {
        t = t.add(const Duration(seconds: 10));
        await feed(t, speedKmh: 36);
      }
      final RideSessionSummary firstSummary = container.read(rideSessionControllerProvider).summary!;

      // La suscripción de telemetría ya se canceló dentro de finish() —
      // este envío no debería tener ningún efecto observable.
      await feed(t.add(const Duration(seconds: 10)), speedKmh: 36);

      final RideSessionState stateAfter = container.read(rideSessionControllerProvider);
      expect(stateAfter.summary, firstSummary); // Equatable: mismo resumen, no uno nuevo
      expect(stateAfter.phase, RideSessionPhase.finished);

      // Y una llamada manual explícita a finish() (p. ej. el usuario
      // alcanza a tocar "Finalizar" justo cuando ya se autocompletó) es
      // idempotente: devuelve el MISMO resumen, no reconstruye nada.
      final RideSessionSummary secondCallResult =
          container.read(rideSessionControllerProvider.notifier).finish();
      expect(secondCallResult, firstSummary);
    });

    test('19. finalización manual antes de llegar al 100% produce routeCompleted = false', () async {
      await startRouteSession();

      await feed(baseTime, speedKmh: 36);
      await feed(baseTime.add(const Duration(seconds: 10)), speedKmh: 36); // 100 m de 1000 m = 10%

      final RideSessionSummary summary = container.read(rideSessionControllerProvider.notifier).finish();

      expect(summary.routeCompleted, isFalse);
      expect(summary.routeId, 'route-1');
      expect(container.read(rideSessionControllerProvider).phase, RideSessionPhase.finished);
    });

    test('una sesión libre (sin target) nunca queda "route-aware" ni autocompleta', () async {
      container.read(rideSessionControllerProvider.notifier).start(); // target: null, comportamiento histórico
      devicesController.add(<BleDevice>[connectedTrainer]);
      await Future<void>.delayed(Duration.zero);

      DateTime t = baseTime;
      await feed(t, speedKmh: 36);
      for (int i = 0; i < 10; i++) {
        t = t.add(const Duration(seconds: 10));
        await feed(t, speedKmh: 36);
      }

      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.isRouteBacked, isFalse);
      expect(state.routeProgress, 0);
      expect(state.phase, RideSessionPhase.active); // nunca autocompleta sin target
      expect(state.telemetry.distanceMeters, 1000); // la distancia SÍ sigue acumulando normalmente
    });

    test(
      'flujo vertical completo: seleccionar ruta → sesión route-aware → telemetría → 100% → '
      'finalización única → el resumen serializa la metadata de ruta lista para el historial',
      () async {
        // 1-3: "seleccionar la ruta" + "navegar con routeId" ya están
        // probados por separado (route_detail_page_navigation_test.dart,
        // routes_repository_impl_test.dart) — acá arranca directamente
        // desde el `RideSessionTarget` ya resuelto, que es exactamente lo
        // que `TrainingHudPage._resolveRouteThenStart()` construye tras
        // resolver la ruta tal como haría en producción.
        await startRouteSession();

        // 4-6: telemetría real → distancia → progreso 0-100%.
        DateTime t = baseTime;
        await feed(t, speedKmh: 36);
        for (int i = 0; i < 10; i++) {
          t = t.add(const Duration(seconds: 10));
          await feed(t, speedKmh: 36);
        }

        // 7-8: finalización automática, única.
        final RideSessionState finishedState = container.read(rideSessionControllerProvider);
        expect(finishedState.phase, RideSessionPhase.finished);
        final RideSessionSummary summary = finishedState.summary!;
        expect(summary.routeCompleted, isTrue);

        // 9: la serialización de persistencia (misma que usa
        // `RideSessionRepositoryImpl.saveSession`) contiene la ruta.
        final RideSessionRecordModel record = RideSessionRecordModel.fromSummary(summary);
        expect(record.routeId, 'route-1');
        expect(record.routeName, 'Ruta de prueba');
        expect(record.routeCompleted, isTrue);

        // 10: round-trip por el mapa que efectivamente viaja a/desde
        // Firestore — lo que "el historial puede mostrar routeName" (item
        // 10 del encargo) significa en la práctica: `fromMap(toMap())`
        // sigue exponiendo `routeName` intacto.
        final RideSessionRecordModel roundTripped = RideSessionRecordModel.fromMap(record.toMap(), 'doc-e2e');
        expect(roundTripped.routeName, 'Ruta de prueba');
      },
    );
  });
}
