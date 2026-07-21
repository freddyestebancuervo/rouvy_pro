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
}
