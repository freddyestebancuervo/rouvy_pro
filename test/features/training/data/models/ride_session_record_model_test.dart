import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/features/device_connection/domain/entities/aggregated_telemetry.dart';
import 'package:rouvy_pro/features/training/data/models/ride_session_record_model.dart';
import 'package:rouvy_pro/features/training/domain/entities/ride_session_summary.dart';

void main() {
  group('RideSessionRecordModel', () {
    test('fromSummary() extrae los campos correctos de la telemetría final', () {
      final RideSessionSummary summary = RideSessionSummary(
        startTime: DateTime(2026, 3, 1, 8),
        endTime: DateTime(2026, 3, 1, 9, 30),
        finalTelemetry: const AggregatedTelemetry(
          distanceMeters: 30500,
          caloriesKcal: 720,
          powerWatts: 215,
          cadenceRpm: 88,
          heartRateBpm: 148,
        ),
        connectedDeviceCount: 2,
      );

      final RideSessionRecordModel model = RideSessionRecordModel.fromSummary(summary);

      expect(model.distanceMeters, 30500);
      expect(model.caloriesKcal, 720);
      expect(model.lastPowerWatts, 215);
      expect(model.lastCadenceRpm, 88);
      expect(model.lastHeartRateBpm, 148);
      expect(model.deviceCount, 2);
      expect(model.startTime, DateTime(2026, 3, 1, 8));
    });

    test('toMap() → fromMap() conserva los datos (round-trip)', () {
      final RideSessionRecordModel original = RideSessionRecordModel(
        id: 'ignored-on-write',
        startTime: DateTime(2026, 3, 1, 8),
        endTime: DateTime(2026, 3, 1, 9),
        distanceMeters: 28000,
        caloriesKcal: 650,
        lastPowerWatts: 190,
        lastCadenceRpm: 85,
        lastHeartRateBpm: 140,
        deviceCount: 1,
      );

      final Map<String, dynamic> map = original.toMap();
      final RideSessionRecordModel restored = RideSessionRecordModel.fromMap(map, 'doc-123');

      expect(restored.id, 'doc-123');
      expect(restored.startTime, original.startTime);
      expect(restored.endTime, original.endTime);
      expect(restored.distanceMeters, original.distanceMeters);
      expect(restored.caloriesKcal, original.caloriesKcal);
      expect(restored.lastPowerWatts, original.lastPowerWatts);
      expect(restored.deviceCount, original.deviceCount);
    });

    test('fromMap() usa valores por defecto seguros cuando faltan campos opcionales', () {
      final RideSessionRecordModel model = RideSessionRecordModel.fromMap(
        <String, dynamic>{
          'startTime': Timestamp.fromDate(DateTime(2026, 1, 1)),
          'endTime': Timestamp.fromDate(DateTime(2026, 1, 1, 1)),
          // distanceMeters, caloriesKcal, lastPowerWatts, deviceCount
          // deliberadamente ausentes.
        },
        'doc-456',
      );

      expect(model.distanceMeters, 0);
      expect(model.caloriesKcal, 0);
      expect(model.lastPowerWatts, isNull);
      expect(model.deviceCount, 0);
    });
  });

  // -------------------------------------------------------------------
  // KORIXA-MVP-VERTICAL-SLICE-01 — metadata de ruta (Sección 17 del
  // encargo, items 21-25).
  // -------------------------------------------------------------------
  group('RideSessionRecordModel — metadata de ruta', () {
    test('21. fromSummary() extrae la metadata de ruta cuando la sesión fue route-aware', () {
      final RideSessionSummary summary = RideSessionSummary(
        startTime: DateTime(2026, 3, 1, 8),
        endTime: DateTime(2026, 3, 1, 8, 20),
        finalTelemetry: const AggregatedTelemetry(distanceMeters: 1000, caloriesKcal: 40),
        connectedDeviceCount: 1,
        routeId: 'route-mvp-local-loop',
        routeName: 'Vuelta de prueba MVP',
        routeTotalDistanceMeters: 3000,
        routeCompleted: true,
      );

      final RideSessionRecordModel model = RideSessionRecordModel.fromSummary(summary);

      expect(model.routeId, 'route-mvp-local-loop');
      expect(model.routeName, 'Vuelta de prueba MVP');
      expect(model.routeDistanceMeters, 3000);
      expect(model.routeCompleted, isTrue);
      expect(model.isRouteBacked, isTrue);
    });

    test('fromSummary() deja los 4 campos de ruta en null para una sesión libre — nunca a medias', () {
      final RideSessionSummary summary = RideSessionSummary(
        startTime: DateTime(2026, 3, 1, 8),
        endTime: DateTime(2026, 3, 1, 9),
        finalTelemetry: const AggregatedTelemetry(distanceMeters: 5000),
        connectedDeviceCount: 1,
      );

      final RideSessionRecordModel model = RideSessionRecordModel.fromSummary(summary);

      expect(model.routeId, isNull);
      expect(model.routeName, isNull);
      expect(model.routeDistanceMeters, isNull);
      expect(model.routeCompleted, isNull);
      expect(model.isRouteBacked, isFalse);
    });

    test('22. toMap() → fromMap() conserva la metadata de ruta (round-trip nuevo)', () {
      final RideSessionRecordModel original = RideSessionRecordModel(
        id: 'ignored-on-write',
        startTime: DateTime(2026, 3, 1, 8),
        endTime: DateTime(2026, 3, 1, 8, 20),
        distanceMeters: 3000,
        caloriesKcal: 90,
        deviceCount: 1,
        routeId: 'route-mvp-local-loop',
        routeName: 'Vuelta de prueba MVP',
        routeDistanceMeters: 3000,
        routeCompleted: true,
      );

      final Map<String, dynamic> map = original.toMap();
      final RideSessionRecordModel restored = RideSessionRecordModel.fromMap(map, 'doc-789');

      expect(restored.routeId, 'route-mvp-local-loop');
      expect(restored.routeName, 'Vuelta de prueba MVP');
      expect(restored.routeDistanceMeters, 3000);
      expect(restored.routeCompleted, isTrue);
    });

    test(
      '23/24. un mapa VIEJO sin ningún campo de ruta (sesión libre grabada antes de este slice) se sigue parseando sin fallar',
      () {
        final RideSessionRecordModel restored = RideSessionRecordModel.fromMap(
          <String, dynamic>{
            'startTime': Timestamp.fromDate(DateTime(2026, 1, 1)),
            'endTime': Timestamp.fromDate(DateTime(2026, 1, 1, 1)),
            'distanceMeters': 12000,
            'caloriesKcal': 300,
            'deviceCount': 1,
            // routeId/routeName/routeDistanceMeters/routeCompleted
            // deliberadamente ausentes — así se veían TODOS los
            // documentos existentes antes de este slice.
          },
          'doc-old-free-ride',
        );

        expect(restored.distanceMeters, 12000); // los campos "de siempre" siguen intactos
        expect(restored.routeId, isNull);
        expect(restored.routeName, isNull);
        expect(restored.routeDistanceMeters, isNull);
        expect(restored.routeCompleted, isNull);
        expect(restored.isRouteBacked, isFalse);
      },
    );

    test('25. un registro route-aware expone routeName para el historial', () {
      final RideSessionRecordModel record = RideSessionRecordModel.fromMap(
        <String, dynamic>{
          'startTime': Timestamp.fromDate(DateTime(2026, 3, 1)),
          'endTime': Timestamp.fromDate(DateTime(2026, 3, 1, 0, 20)),
          'distanceMeters': 3000,
          'caloriesKcal': 90,
          'routeId': 'route-mvp-local-loop',
          'routeName': 'Vuelta de prueba MVP',
          'routeDistanceMeters': 3000,
          'routeCompleted': true,
        },
        'doc-route-session',
      );

      expect(record.routeName, 'Vuelta de prueba MVP');
    });
  });
}
