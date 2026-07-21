import 'package:dartz/dartz.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/device_connection/domain/entities/aggregated_telemetry.dart';
import 'package:rouvy_pro/features/training/domain/entities/ride_session_summary.dart';
import 'package:rouvy_pro/features/training/domain/repositories/ride_session_repository.dart';
import 'package:rouvy_pro/features/training/domain/usecases/save_ride_session_usecase.dart';

class MockRideSessionRepository extends Mock implements RideSessionRepository {}

void main() {
  late SaveRideSessionUseCase useCase;
  late MockRideSessionRepository repository;

  setUp(() {
    repository = MockRideSessionRepository();
    useCase = SaveRideSessionUseCase(repository);
  });

  final RideSessionSummary summary = RideSessionSummary(
    startTime: DateTime(2026, 1, 1, 8),
    endTime: DateTime(2026, 1, 1, 9),
    finalTelemetry: const AggregatedTelemetry(distanceMeters: 25000, caloriesKcal: 600, powerWatts: 200),
    connectedDeviceCount: 1,
  );

  test('delega en repository.saveSession con el resumen correcto', () async {
    when(() => repository.saveSession(summary)).thenAnswer((_) async => const Right(null));

    final result = await useCase(SaveRideSessionParams(summary: summary));

    expect(result, const Right<Failure, void>(null));
    verify(() => repository.saveSession(summary)).called(1);
  });

  test('propaga el Failure si falla el guardado (p. ej. sin conexión)', () async {
    const NetworkFailure failure = NetworkFailure();
    when(() => repository.saveSession(summary)).thenAnswer((_) async => const Left(failure));

    final result = await useCase(SaveRideSessionParams(summary: summary));

    expect(result, const Left<Failure, void>(failure));
  });
}
