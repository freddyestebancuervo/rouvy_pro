import 'dart:async';

import 'package:dartz/dartz.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/ble_device.dart';
import 'package:rouvy_pro/features/device_connection/domain/repositories/device_repository.dart';
import 'package:rouvy_pro/features/device_connection/domain/usecases/observe_connected_devices_usecase.dart';
import 'package:rouvy_pro/features/device_connection/domain/usecases/observe_telemetry_usecase.dart';
import 'package:rouvy_pro/features/device_connection/presentation/providers/device_providers.dart';
import 'package:rouvy_pro/features/routes_catalog/domain/entities/training_route.dart';
import 'package:rouvy_pro/features/routes_catalog/domain/repositories/routes_repository.dart';
import 'package:rouvy_pro/features/routes_catalog/presentation/providers/routes_providers.dart';
import 'package:rouvy_pro/features/training/data/datasources/ride_session_snapshot_local_datasource.dart';
import 'package:rouvy_pro/features/training/presentation/pages/training_hud_page.dart';
import 'package:rouvy_pro/features/training/presentation/providers/ride_session_controller.dart';
import 'package:rouvy_pro/features/training/presentation/providers/ride_session_snapshot_providers.dart';
import 'package:rouvy_pro/l10n/generated/app_localizations.dart';

class MockDeviceRepository extends Mock implements DeviceRepository {}

class FakeSnapshotDataSource implements RideSessionSnapshotLocalDataSource {
  FakeSnapshotDataSource({this.stored});

  RideSessionSnapshotData? stored;

  @override
  Future<void> save(RideSessionSnapshotData snapshot) async => stored = snapshot;

  @override
  Future<RideSessionSnapshotData?> load() async => stored;

  @override
  Future<void> clear() async => stored = null;
}

class _FixedRoutesRepository implements RoutesRepository {
  _FixedRoutesRepository(this.routes);

  final List<TrainingRoute> routes;

  @override
  Future<Either<Failure, List<TrainingRoute>>> fetchCatalog() async => Right(routes);

  @override
  Future<Either<Failure, TrainingRoute>> fetchById(String routeId) async {
    final TrainingRoute? route = routes.where((TrainingRoute r) => r.id == routeId).firstOrNull;
    if (route == null) return const Left(ServerFailure('No se encontró la ruta solicitada.'));
    return Right(route);
  }
}

const TrainingRoute _routeB = TrainingRoute(
  id: 'route-b',
  name: 'Ruta B (la que el usuario tenía abierta)',
  distanceMeters: 5000,
  elevationGainMeters: 0,
  difficulty: RouteDifficulty.easy,
  contentType: RouteContentType.staticRoute,
  descriptionEs: 'd',
  descriptionEn: 'd',
);

/// KORIXA-MVP-VERTICAL-SLICE-02 — Sección 8/9, items 16-17: si el
/// snapshot guardado pertenece a la ruta A y el usuario abrió
/// `TrainingHudPage` con la ruta B (deep-link/URL distinta), "Continuar
/// sesión" tiene que recuperar A — nunca pisarla con B. "Descartar" en
/// cambio arranca B normalmente.
void main() {
  late MockDeviceRepository repository;
  late StreamController<List<BleDevice>> devicesController;

  Widget wrap({
    required FakeSnapshotDataSource snapshotDataSource,
    required RoutesRepository routesRepository,
    required String? routeId,
  }) {
    return ProviderScope(
      overrides: <Override>[
        rideSessionSnapshotDataSourceProvider.overrideWithValue(snapshotDataSource),
        routesRepositoryProvider.overrideWithValue(routesRepository),
        observeConnectedDevicesUseCaseProvider.overrideWithValue(ObserveConnectedDevicesUseCase(repository)),
        observeTelemetryUseCaseProvider.overrideWithValue(ObserveTelemetryUseCase(repository)),
      ],
      child: MaterialApp(
        locale: const Locale('es'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: TrainingHudPage(routeId: routeId),
      ),
    );
  }

  RideSessionSnapshotData routeASnapshot() {
    return RideSessionSnapshotData(
      startTimeIso: DateTime(2026, 1, 1, 8).toIso8601String(),
      elapsedSeconds: 480,
      distanceMeters: 2400,
      caloriesKcal: 60,
      connectedDeviceCount: 0,
      savedAtIso: DateTime.now().toIso8601String(),
      routeId: 'route-a',
      routeName: 'Ruta A (la del snapshot guardado)',
      routeTotalDistanceMeters: 3000,
    );
  }

  setUp(() {
    repository = MockDeviceRepository();
    devicesController = StreamController<List<BleDevice>>.broadcast();
    when(() => repository.connectedDevicesStream).thenAnswer((_) => devicesController.stream);
  });

  tearDown(() async {
    await devicesController.close();
  });

  testWidgets(
    '16. "Continuar sesión" recupera la ruta A del snapshot — la ruta B de la URL/deep-link NUNCA la pisa',
    (WidgetTester tester) async {
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          rideSessionSnapshotDataSourceProvider.overrideWithValue(FakeSnapshotDataSource(stored: routeASnapshot())),
          routesRepositoryProvider.overrideWithValue(_FixedRoutesRepository(const <TrainingRoute>[_routeB])),
          observeConnectedDevicesUseCaseProvider.overrideWithValue(ObserveConnectedDevicesUseCase(repository)),
          observeTelemetryUseCaseProvider.overrideWithValue(ObserveTelemetryUseCase(repository)),
        ],
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(
            locale: Locale('es'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: TrainingHudPage(routeId: 'route-b'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // El diálogo de recuperación aparece antes de arrancar nada.
      expect(find.text('Sesión sin finalizar encontrada'), findsOneWidget);

      await tester.tap(find.text('Continuar sesión'));
      await tester.pumpAndSettle();

      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.isRouteBacked, isTrue);
      expect(state.target!.routeId, 'route-a'); // la del snapshot — NUNCA 'route-b'
      expect(state.target!.routeName, 'Ruta A (la del snapshot guardado)');
      expect(state.telemetry.distanceMeters, 2400); // distancia recuperada, no reiniciada

      // Cancela los timers del controller ANTES de que el framework de
      // widget tests verifique "no quedan timers pendientes" — `dispose()`
      // en `addTearDown` corre DESPUÉS de esa verificación, muy tarde.
      container.dispose();
    },
  );

  testWidgets(
    '17. "Descartar" tira el snapshot de la ruta A y arranca la ruta B normalmente',
    (WidgetTester tester) async {
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          rideSessionSnapshotDataSourceProvider.overrideWithValue(FakeSnapshotDataSource(stored: routeASnapshot())),
          routesRepositoryProvider.overrideWithValue(_FixedRoutesRepository(const <TrainingRoute>[_routeB])),
          observeConnectedDevicesUseCaseProvider.overrideWithValue(ObserveConnectedDevicesUseCase(repository)),
          observeTelemetryUseCaseProvider.overrideWithValue(ObserveTelemetryUseCase(repository)),
        ],
      );
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(
            locale: Locale('es'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: TrainingHudPage(routeId: 'route-b'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Descartar'));
      await tester.pumpAndSettle();

      final RideSessionState state = container.read(rideSessionControllerProvider);
      expect(state.isRouteBacked, isTrue);
      expect(state.target!.routeId, 'route-b'); // arrancó B, no A
      expect(state.telemetry.distanceMeters, 0); // sesión nueva, no la distancia recuperada de A
      expect(state.phase, RideSessionPhase.active);

      container.dispose();
    },
  );
}
