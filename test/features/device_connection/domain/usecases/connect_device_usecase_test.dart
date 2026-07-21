import 'package:dartz/dartz.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/device_connection/domain/repositories/device_repository.dart';
import 'package:rouvy_pro/features/device_connection/domain/usecases/connect_device_usecase.dart';

class MockDeviceRepository extends Mock implements DeviceRepository {}

void main() {
  late ConnectDeviceUseCase useCase;
  late MockDeviceRepository repository;

  setUp(() {
    repository = MockDeviceRepository();
    useCase = ConnectDeviceUseCase(repository);
  });

  const String deviceId = 'AA:BB:CC:DD:EE:FF';

  test('delega en repository.connect con el ID correcto', () async {
    when(() => repository.connect(deviceId)).thenAnswer((_) async => const Right(null));

    final result = await useCase(const ConnectDeviceParams(deviceId: deviceId));

    expect(result, const Right<Failure, void>(null));
    verify(() => repository.connect(deviceId)).called(1);
  });

  test('propaga ServerFailure si la conexión falla', () async {
    const ServerFailure failure = ServerFailure('No se pudo conectar con el dispositivo.');
    when(() => repository.connect(deviceId)).thenAnswer((_) async => const Left(failure));

    final result = await useCase(const ConnectDeviceParams(deviceId: deviceId));

    expect(result, const Left<Failure, void>(failure));
  });
}
