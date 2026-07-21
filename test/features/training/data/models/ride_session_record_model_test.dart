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
}
