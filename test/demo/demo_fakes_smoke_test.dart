import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/demo/fakes/fake_auth_repository.dart';
import 'package:rouvy_pro/demo/fakes/fake_device_repository.dart';
import 'package:rouvy_pro/demo/fakes/fake_ride_session_repository.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/aggregated_telemetry.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/device_connection_status.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/telemetry_snapshot.dart';
import 'package:rouvy_pro/features/training/domain/entities/ride_session_summary.dart';

void main() {
  group('FakeAuthRepository', () {
    test('login() siempre resuelve con éxito y emite el usuario en authStateChanges', () async {
      final FakeAuthRepository repo = FakeAuthRepository();
      final List<dynamic> emitted = <dynamic>[];
      final StreamSubscription<dynamic> sub = repo.authStateChanges.listen(emitted.add);

      final result = await repo.login(email: 'quien-sea@ejemplo.com', password: 'cualquiera');

      expect(result.isRight(), isTrue);
      await Future<void>.delayed(Duration.zero);
      expect(emitted, isNotEmpty);
      await sub.cancel();
    });

    test('logout() limpia el usuario actual y emite null', () async {
      final FakeAuthRepository repo = FakeAuthRepository();
      await repo.login(email: 'a@b.com', password: 'x');

      final result = await repo.logout();

      expect(result.isRight(), isTrue);
      final current = await repo.getCurrentUser();
      expect(current.getOrElse(() => null), isNull);
    });

    test('updateProfile() sin sesión activa devuelve un Failure', () async {
      final FakeAuthRepository repo = FakeAuthRepository();

      final result = await repo.updateProfile(displayName: 'Nuevo nombre');

      expect(result.isLeft(), isTrue);
    });
  });

  group('FakeDeviceRepository', () {
    test('connect() transiciona a connected y empieza a emitir telemetría', () async {
      final FakeDeviceRepository repo = FakeDeviceRepository();
      final List<List<dynamic>> devicesEmitted = <List<dynamic>>[];
      final sub = repo.connectedDevicesStream.listen(devicesEmitted.add);

      await repo.connect('demo-trainer-1');
      await Future<void>.delayed(Duration.zero);

      final connectedNow = devicesEmitted.last.cast<dynamic>();
      expect(connectedNow.any((d) => d.status == DeviceConnectionStatus.connected), isTrue);

      final TelemetrySnapshot firstSnapshot =
          await repo.telemetryStreamFor('demo-trainer-1').first.timeout(const Duration(seconds: 2));
      expect(firstSnapshot.deviceId, 'demo-trainer-1');

      await sub.cancel();
    });

    test('disconnect() detiene la telemetría', () async {
      final FakeDeviceRepository repo = FakeDeviceRepository();
      await repo.connect('demo-hrm-1');

      final result = await repo.disconnect('demo-hrm-1');

      expect(result.isRight(), isTrue);
    });
  });

  group('FakeRideSessionRepository', () {
    test('recentSessions ya viene sembrado con el fixture al suscribirse', () async {
      final FakeRideSessionRepository repo = FakeRideSessionRepository();

      final sessions = await repo.recentSessions.first.timeout(const Duration(seconds: 1));

      expect(sessions, isNotEmpty);
    });

    test('saveSession() agrega una nueva sesión al principio del historial', () async {
      final FakeRideSessionRepository repo = FakeRideSessionRepository();
      final int before = (await repo.recentSessions.first).length;

      final DateTime start = DateTime.now().subtract(const Duration(hours: 1));
      final result = await repo.saveSession(
        RideSessionSummary(
          startTime: start,
          endTime: DateTime.now(),
          finalTelemetry: const AggregatedTelemetry(distanceMeters: 5000, caloriesKcal: 120),
          connectedDeviceCount: 1,
        ),
      );

      expect(result.isRight(), isTrue);
      final List after = await repo.recentSessions.first;
      expect(after.length, before + 1);
    });
  });
}
