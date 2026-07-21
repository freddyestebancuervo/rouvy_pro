import 'package:dartz/dartz.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/auth/domain/entities/user_entity.dart';
import 'package:rouvy_pro/features/auth/domain/repositories/auth_repository.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/login_usecase.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

void main() {
  late LoginUseCase useCase;
  late MockAuthRepository repository;

  setUp(() {
    repository = MockAuthRepository();
    useCase = LoginUseCase(repository);
  });

  const String email = 'rider@ridepro.com';
  const String password = 'securePass123';
  const UserEntity tUser = UserEntity(id: '1', email: email, displayName: 'Rider');

  test(
    'debe devolver UserEntity cuando el repositorio autentica correctamente',
    () async {
      // Arrange
      when(() => repository.login(email: email, password: password))
          .thenAnswer((_) async => const Right(tUser));

      // Act
      final result = await useCase(const LoginParams(email: email, password: password));

      // Assert: el usecase no transforma el resultado, solo delega —
      // verificamos que el repositorio se llamó con los parámetros
      // correctos y que el Either se propaga intacto.
      expect(result, const Right<Failure, UserEntity>(tUser));
      verify(() => repository.login(email: email, password: password)).called(1);
      verifyNoMoreInteractions(repository);
    },
  );

  test(
    'debe devolver AuthFailure cuando las credenciales son inválidas',
    () async {
      // Arrange
      const AuthFailure failure = AuthFailure('Correo o contraseña incorrectos.');
      when(() => repository.login(email: email, password: password))
          .thenAnswer((_) async => const Left(failure));

      // Act
      final result = await useCase(const LoginParams(email: email, password: password));

      // Assert
      expect(result, const Left<Failure, UserEntity>(failure));
    },
  );
}
