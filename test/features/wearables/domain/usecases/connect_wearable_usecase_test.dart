import 'package:dartz/dartz.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/wearables/domain/entities/wearable_provider_type.dart';
import 'package:rouvy_pro/features/wearables/domain/repositories/wearable_repository.dart';
import 'package:rouvy_pro/features/wearables/domain/usecases/connect_wearable_usecase.dart';

class MockWearableRepository extends Mock implements WearableRepository {}

void main() {
  late ConnectWearableUseCase useCase;
  late MockWearableRepository repository;

  setUp(() {
    repository = MockWearableRepository();
    useCase = ConnectWearableUseCase(repository);
  });

  test('delega en repository.connect con el proveedor correcto', () async {
    when(() => repository.connect(WearableProviderType.appleHealth))
        .thenAnswer((_) async => const Right(null));

    final result = await useCase(const ConnectWearableParams(provider: WearableProviderType.appleHealth));

    expect(result, const Right<Failure, void>(null));
    verify(() => repository.connect(WearableProviderType.appleHealth)).called(1);
  });

  test('propaga el Failure cuando el repositorio falla (p. ej. permisos denegados)', () async {
    const UnexpectedFailure failure = UnexpectedFailure('Permisos de Apple Health denegados.');
    when(() => repository.connect(WearableProviderType.appleHealth))
        .thenAnswer((_) async => const Left(failure));

    final result = await useCase(const ConnectWearableParams(provider: WearableProviderType.appleHealth));

    expect(result, const Left<Failure, void>(failure));
  });
}
