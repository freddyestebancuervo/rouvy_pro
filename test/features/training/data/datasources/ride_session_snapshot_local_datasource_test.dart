import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rouvy_pro/features/training/data/datasources/ride_session_snapshot_local_datasource.dart';
import 'package:rouvy_pro/features/training/domain/entities/ride_session_target.dart';

void main() {
  late RideSessionSnapshotLocalDataSourceImpl dataSource;

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    dataSource = RideSessionSnapshotLocalDataSourceImpl(prefs);
  });

  RideSessionSnapshotData buildSnapshot({DateTime? savedAt}) {
    return RideSessionSnapshotData(
      startTimeIso: DateTime(2026, 1, 1, 8).toIso8601String(),
      elapsedSeconds: 600,
      distanceMeters: 5000,
      caloriesKcal: 120,
      connectedDeviceCount: 1,
      savedAtIso: (savedAt ?? DateTime.now()).toIso8601String(),
    );
  }

  test('load() devuelve null cuando no hay ningún snapshot guardado', () async {
    expect(await dataSource.load(), isNull);
  });

  test('save() → load() conserva todos los campos', () async {
    final RideSessionSnapshotData original = buildSnapshot();

    await dataSource.save(original);
    final RideSessionSnapshotData? loaded = await dataSource.load();

    expect(loaded, isNotNull);
    expect(loaded!.elapsedSeconds, 600);
    expect(loaded.distanceMeters, 5000);
    expect(loaded.caloriesKcal, 120);
    expect(loaded.connectedDeviceCount, 1);
  });

  test('clear() elimina el snapshot guardado', () async {
    await dataSource.save(buildSnapshot());
    await dataSource.clear();

    expect(await dataSource.load(), isNull);
  });

  test('un snapshot más viejo que maxRecoverableAge se descarta automáticamente', () async {
    final DateTime tooOld = DateTime.now().subtract(const Duration(hours: 4));
    await dataSource.save(buildSnapshot(savedAt: tooOld));

    expect(await dataSource.load(), isNull);
  });

  test('un snapshot dentro de maxRecoverableAge sí se recupera', () async {
    final DateTime recent = DateTime.now().subtract(const Duration(minutes: 30));
    await dataSource.save(buildSnapshot(savedAt: recent));

    expect(await dataSource.load(), isNotNull);
  });

  // -------------------------------------------------------------------
  // KORIXA-MVP-VERTICAL-SLICE-02 — metadata de ruta en el snapshot de
  // recuperación (Sección 9 del encargo, items 1-5).
  // -------------------------------------------------------------------
  group('metadata de ruta en el snapshot de recuperación', () {
    RideSessionSnapshotData buildRouteSnapshot() {
      return RideSessionSnapshotData(
        startTimeIso: DateTime(2026, 1, 1, 8).toIso8601String(),
        elapsedSeconds: 480,
        distanceMeters: 2400,
        caloriesKcal: 60,
        connectedDeviceCount: 1,
        savedAtIso: DateTime.now().toIso8601String(),
        routeId: 'route-mvp-local-loop',
        routeName: 'Vuelta de prueba MVP',
        routeTotalDistanceMeters: 3000,
      );
    }

    test('1. un snapshot route-aware nuevo serializa routeId/routeName/routeTotalDistanceMeters', () {
      final Map<String, dynamic> json = buildRouteSnapshot().toJson();

      expect(json['routeId'], 'route-mvp-local-loop');
      expect(json['routeName'], 'Vuelta de prueba MVP');
      expect(json['routeTotalDistanceMeters'], 3000);
    });

    test('2. un snapshot route-aware nuevo deserializa el target reconstruible', () {
      final Map<String, dynamic> json = buildRouteSnapshot().toJson();

      final RideSessionSnapshotData restored = RideSessionSnapshotData.fromJson(json);

      expect(restored.recoveredTarget, isNotNull);
      expect(restored.recoveredTarget!.routeId, 'route-mvp-local-loop');
      expect(restored.recoveredTarget!.routeName, 'Vuelta de prueba MVP');
      expect(restored.recoveredTarget!.routeTotalDistanceMeters, 3000);
    });

    test('3. un snapshot VIEJO (guardado antes de este slice, sin campos de ruta) sigue parseando', () {
      final Map<String, dynamic> legacyJson = <String, dynamic>{
        'startTimeIso': DateTime(2026, 1, 1, 8).toIso8601String(),
        'elapsedSeconds': 300,
        'distanceMeters': 4000,
        'caloriesKcal': 90,
        'connectedDeviceCount': 1,
        'savedAtIso': DateTime.now().toIso8601String(),
        // routeId/routeName/routeTotalDistanceMeters deliberadamente
        // ausentes — así se veían TODOS los snapshots antes de este slice.
      };

      final RideSessionSnapshotData restored = RideSessionSnapshotData.fromJson(legacyJson);

      expect(restored.distanceMeters, 4000); // los campos "de siempre" siguen intactos
      expect(restored.recoveredTarget, isNull); // fail-safe: se recupera como sesión libre
    });

    test('4. un snapshot de sesión libre nueva (sin ruta) sigue siendo route-unaware', () {
      final RideSessionSnapshotData freeRide = RideSessionSnapshotData(
        startTimeIso: DateTime(2026, 1, 1, 8).toIso8601String(),
        elapsedSeconds: 300,
        distanceMeters: 4000,
        caloriesKcal: 90,
        connectedDeviceCount: 1,
        savedAtIso: DateTime.now().toIso8601String(),
        // routeId/routeName/routeTotalDistanceMeters explícitamente null.
      );

      final RideSessionSnapshotData roundTripped = RideSessionSnapshotData.fromJson(freeRide.toJson());

      expect(roundTripped.recoveredTarget, isNull);
    });

    test(
      '5. metadata de ruta MALFORMADA (routeId vacío, o distancia <= 0) falla seguro — recupera como sesión libre',
      () {
        final RideSessionSnapshotData emptyId = RideSessionSnapshotData.fromJson(<String, dynamic>{
          ...buildRouteSnapshot().toJson(),
          'routeId': '',
        });
        expect(emptyId.recoveredTarget, isNull);

        final RideSessionSnapshotData emptyName = RideSessionSnapshotData.fromJson(<String, dynamic>{
          ...buildRouteSnapshot().toJson(),
          'routeName': '',
        });
        expect(emptyName.recoveredTarget, isNull);

        final RideSessionSnapshotData zeroDistance = RideSessionSnapshotData.fromJson(<String, dynamic>{
          ...buildRouteSnapshot().toJson(),
          'routeTotalDistanceMeters': 0,
        });
        expect(zeroDistance.recoveredTarget, isNull);

        final RideSessionSnapshotData negativeDistance = RideSessionSnapshotData.fromJson(<String, dynamic>{
          ...buildRouteSnapshot().toJson(),
          'routeTotalDistanceMeters': -100,
        });
        expect(negativeDistance.recoveredTarget, isNull);

        // Solo routeId presente, sin nombre/distancia — corrupción parcial.
        final RideSessionSnapshotData partial = RideSessionSnapshotData.fromJson(<String, dynamic>{
          ...buildRouteSnapshot().toJson(),
          'routeName': null,
          'routeTotalDistanceMeters': null,
        });
        expect(partial.recoveredTarget, isNull);
      },
    );

    test('save() → load() a través de SharedPreferences (JSON real) conserva el target reconstruible', () async {
      await dataSource.save(buildRouteSnapshot());

      final RideSessionSnapshotData? loaded = await dataSource.load();

      expect(loaded, isNotNull);
      expect(loaded!.recoveredTarget, isNotNull);
      expect(loaded.recoveredTarget!.routeId, 'route-mvp-local-loop');
    });

    test('un JSON con routeTotalDistanceMeters de tipo entero (no double) se parsea igual (num? -> double?)', () {
      // `jsonDecode` de un valor guardado como entero produce un `int` de
      // Dart, no un `double` — `(num?)?.toDouble()` ya cubre este caso
      // (mismo patrón que `distanceMeters`/`caloriesKcal` existentes).
      final Map<String, dynamic> decoded = jsonDecode(jsonEncode(<String, dynamic>{
        ...buildRouteSnapshot().toJson(),
        'routeTotalDistanceMeters': 3000, // entero, no 3000.0
      })) as Map<String, dynamic>;

      final RideSessionSnapshotData restored = RideSessionSnapshotData.fromJson(decoded);

      expect(restored.recoveredTarget, isA<RideSessionTarget>());
      expect(restored.recoveredTarget!.routeTotalDistanceMeters, 3000.0);
    });
  });
}
