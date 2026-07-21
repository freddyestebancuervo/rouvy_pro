import 'dart:async';

import 'package:dartz/dartz.dart';

import '../../features/training/domain/entities/ride_session_record.dart';
import '../../features/training/domain/entities/ride_session_summary.dart';
import '../../features/training/domain/repositories/ride_session_repository.dart';
import '../../core/error/failures.dart';
import '../fixtures/demo_ride_sessions_fixture.dart';

/// Implementación de `RideSessionRepository` para el modo demo — lista en
/// memoria, sembrada con `demo_ride_sessions_fixture.dart`. **Nunca**
/// importa `cloud_firestore`.
class FakeRideSessionRepository implements RideSessionRepository {
  final List<RideSessionRecord> _sessions = buildDemoRideSessionsFixture();
  final StreamController<List<RideSessionRecord>> _controller =
      StreamController<List<RideSessionRecord>>.broadcast();

  int _nextId = 1000;

  @override
  Future<Either<Failure, void>> saveSession(RideSessionSummary summary) async {
    await Future<void>.delayed(const Duration(milliseconds: 300));
    final telemetry = summary.finalTelemetry;
    _sessions.insert(
      0,
      RideSessionRecord(
        id: 'demo-session-new-${_nextId++}',
        startTime: summary.startTime,
        endTime: summary.endTime,
        distanceMeters: telemetry.distanceMeters,
        caloriesKcal: telemetry.caloriesKcal,
        lastPowerWatts: telemetry.powerWatts,
        lastCadenceRpm: telemetry.cadenceRpm,
        lastHeartRateBpm: telemetry.heartRateBpm,
        deviceCount: summary.connectedDeviceCount,
      ),
    );
    _emit();
    return const Right(null);
  }

  @override
  Stream<List<RideSessionRecord>> get recentSessions {
    // `Stream.multi` para que un suscriptor que llega tarde (p. ej. al
    // navegar a Historial después de que ya se sembró el fixture) reciba
    // el estado actual de inmediato — mismo patrón ya usado en
    // `WearableRepositoryImpl.connectionsStream` para el mismo problema.
    return Stream<List<RideSessionRecord>>.multi((StreamController<List<RideSessionRecord>> multiController) {
      multiController.add(List<RideSessionRecord>.from(_sessions));
      final StreamSubscription<List<RideSessionRecord>> sub = _controller.stream.listen(multiController.add);
      multiController.onCancel = sub.cancel;
    });
  }

  void _emit() => _controller.add(List<RideSessionRecord>.from(_sessions));
}
