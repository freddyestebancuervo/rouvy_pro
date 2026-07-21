import 'package:dartz/dartz.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/exceptions.dart';
import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/aggregated_telemetry.dart';
import 'package:rouvy_pro/features/training/data/datasources/ride_session_remote_datasource.dart';
import 'package:rouvy_pro/features/training/data/models/ride_session_record_model.dart';
import 'package:rouvy_pro/features/training/data/repositories/ride_session_repository_impl.dart';
import 'package:rouvy_pro/features/training/domain/entities/ride_session_summary.dart';

class MockRideSessionRemoteDataSource extends Mock implements RideSessionRemoteDataSource {}

void main() {
  late MockRideSessionRemoteDataSource dataSource;
  late RideSessionRepositoryImpl repository;

  setUpAll(() {
    registerFallbackValue(
      RideSessionRecordModel(
        id: '',
        startTime: DateTime(2026),
        endTime: DateTime(2026),
        distanceMeters: 0,
        caloriesKcal: 0,
      ),
    );
  });

  setUp(() {
    dataSource = MockRideSessionRemoteDataSource();
    repository = RideSessionRepositoryImpl(remoteDataSource: dataSource);
  });

  final RideSessionSummary summary = RideSessionSummary(
    startTime: DateTime(2026, 1, 1, 8),
    endTime: DateTime(2026, 1, 1, 9),
    finalTelemetry: const AggregatedTelemetry(distanceMeters: 20000, caloriesKcal: 500),
    connectedDeviceCount: 1,
  );

  group('Escritura offline (semántica optimista de Firestore)', () {
    // Con `persistenceEnabled: true` (ver main.dart y docs/OFFLINE_FIRST.md),
    // el SDK de Firestore resuelve el `Future` de una escritura en cuanto
    // queda persistida LOCALMENTE — sin esperar confirmación del
    // servidor. Desde la perspectiva de este repositorio (y de
    // `RideSessionRemoteDataSourceImpl`, que solo hace `await ref.add(...)`),
    // una escritura hecha sin conexión se ve EXACTAMENTE igual que una
    // escritura online: el `Future` se completa sin lanzar. Por eso este
    // test no necesita simular "estar offline" de ningún modo especial —
    // simular que el datasource resuelve con éxito ES, correctamente,
    // el mismo camino de código que cubre el caso offline real.
    test('saveSession() resuelve como éxito cuando la escritura queda en cola local (offline)', () async {
      when(() => dataSource.saveSession(any())).thenAnswer((_) async {});

      final result = await repository.saveSession(summary);

      expect(result, const Right<Failure, void>(null));
    });
  });

  group('Errores genuinos (distintos de "estaba offline")', () {
    test('un ServerException real (p. ej. permisos denegados) sí se propaga como Failure', () async {
      when(() => dataSource.saveSession(any()))
          .thenThrow(const ServerException('Permisos insuficientes.'));

      final result = await repository.saveSession(summary);

      expect(result.isLeft(), isTrue);
      result.fold(
        (Failure failure) => expect(failure, isA<ServerFailure>()),
        (_) => fail('se esperaba un Failure'),
      );
    });

    test(
      'sin sesión de usuario (caso real: el usuario cerró sesión mientras la app estaba offline) '
      'se traduce en un Failure claro, no en un crash silencioso',
      () async {
        when(() => dataSource.saveSession(any()))
            .thenThrow(const ServerException('No hay una sesión activa para guardar el entrenamiento.'));

        final result = await repository.saveSession(summary);

        expect(result.isLeft(), isTrue);
      },
    );
  });

  group('Sincronización del historial (lectura en tiempo real)', () {
    test(
      'recentSessions expone directamente el stream del datasource — Firestore ya resuelve '
      'la fusión entre caché local y datos del servidor internamente, sin lógica propia de merge',
      () async {
        final RideSessionRecordModel cached = RideSessionRecordModel.fromSummary(summary);
        when(() => dataSource.recentSessions)
            .thenAnswer((_) => Stream<List<RideSessionRecordModel>>.value(<RideSessionRecordModel>[cached]));

        final result = await repository.recentSessions.first;

        expect(result, hasLength(1));
        expect(result.first.distanceMeters, 20000);
      },
    );
  });
}
