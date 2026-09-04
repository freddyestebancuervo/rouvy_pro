import 'package:cloud_firestore/cloud_firestore.dart';

import '../../domain/entities/ride_session_record.dart';
import '../../domain/entities/ride_session_summary.dart';

class RideSessionRecordModel extends RideSessionRecord {
  const RideSessionRecordModel({
    required super.id,
    required super.startTime,
    required super.endTime,
    required super.distanceMeters,
    required super.caloriesKcal,
    super.lastPowerWatts,
    super.lastCadenceRpm,
    super.lastHeartRateBpm,
    super.deviceCount,
    super.routeId,
    super.routeName,
    super.routeDistanceMeters,
    super.routeCompleted,
  });

  factory RideSessionRecordModel.fromSummary(RideSessionSummary summary) {
    final telemetry = summary.finalTelemetry;
    return RideSessionRecordModel(
      id: '', // se asigna al escribir (Firestore genera el ID del documento)
      startTime: summary.startTime,
      endTime: summary.endTime,
      distanceMeters: telemetry.distanceMeters,
      caloriesKcal: telemetry.caloriesKcal,
      lastPowerWatts: telemetry.powerWatts,
      lastCadenceRpm: telemetry.cadenceRpm,
      lastHeartRateBpm: telemetry.heartRateBpm,
      deviceCount: summary.connectedDeviceCount,
      routeId: summary.routeId,
      routeName: summary.routeName,
      routeDistanceMeters: summary.routeTotalDistanceMeters,
      routeCompleted: summary.routeCompleted,
    );
  }

  /// KORIXA-MVP-VERTICAL-SLICE-01 — los 4 campos `route*` son opcionales
  /// y se leen con `as T?` (nunca `as T`): un documento viejo, guardado
  /// antes de este slice, simplemente no los tiene en el mapa y estas
  /// líneas devuelven `null` sin lanzar — ver
  /// `ride_session_record_model_test.dart` para la prueba explícita de
  /// compatibilidad hacia atrás.
  factory RideSessionRecordModel.fromMap(Map<String, dynamic> map, String documentId) {
    return RideSessionRecordModel(
      id: documentId,
      startTime: (map['startTime'] as Timestamp).toDate(),
      endTime: (map['endTime'] as Timestamp).toDate(),
      distanceMeters: (map['distanceMeters'] as num?)?.toDouble() ?? 0,
      caloriesKcal: (map['caloriesKcal'] as num?)?.toDouble() ?? 0,
      lastPowerWatts: map['lastPowerWatts'] as int?,
      lastCadenceRpm: map['lastCadenceRpm'] as int?,
      lastHeartRateBpm: map['lastHeartRateBpm'] as int?,
      deviceCount: map['deviceCount'] as int? ?? 0,
      routeId: map['routeId'] as String?,
      routeName: map['routeName'] as String?,
      routeDistanceMeters: (map['routeDistanceMeters'] as num?)?.toDouble(),
      routeCompleted: map['routeCompleted'] as bool?,
    );
  }

  Map<String, dynamic> toMap() {
    return <String, dynamic>{
      'startTime': Timestamp.fromDate(startTime),
      'endTime': Timestamp.fromDate(endTime),
      'distanceMeters': distanceMeters,
      'caloriesKcal': caloriesKcal,
      'lastPowerWatts': lastPowerWatts,
      'lastCadenceRpm': lastCadenceRpm,
      'lastHeartRateBpm': lastHeartRateBpm,
      'deviceCount': deviceCount,
      'routeId': routeId,
      'routeName': routeName,
      'routeDistanceMeters': routeDistanceMeters,
      'routeCompleted': routeCompleted,
    };
  }
}
