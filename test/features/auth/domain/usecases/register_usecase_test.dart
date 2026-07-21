import 'package:dartz/dartz.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/auth/domain/entities/user_entity.dart';
import 'package:rouvy_pro/features/auth/domain/repositories/auth_repository.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/register_usecase.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

void main() {
  late RegisterUseCase useCase;
  late MockAuthRepository repository;

  setUp(() {
    repository = MockAuthRepository();
    useCase = RegisterUseCase(repository);
  });

  const String email = 'newrider@ridepro.com';
  const String password = 'securePass123';
  const String displayName = 'New Rider';
  const UserEntity tUser = UserEntity(id: '2', email: email, displayName: displayName);

  test('debe devolver UserEntity cuando el registro es exitoso', () async {
    when(
      () => repository.register(email: email, password: password, displayName: displayName),
    ).thenAnswer((_) async => const Right(tUser));

    final result = await useCase(
      const RegisterParams(email: email, password: password, displayName: displayName),
    );

    expect(result, const Right<Failure, UserEntity>(tUser));
    verify(
      () => repository.register(email: email, password: password, displayName: displayName),
    ).called(1);
  });

  test('debe devolver ServerFailure cuando el correo ya está en uso', () async {
    const ServerFailure failure = ServerFailure('Ya existe una cuenta con ese correo.');
    when(
      () => repository.register(email: email, password: password, displayName: displayName),
    ).thenAnswer((_) async => const Left(failure));

    final result = await useCase(
      const RegisterParams(email: email, password: password, displayName: displayName),
    );

    expect(result, const Left<Failure, UserEntity>(failure));
  });
}
