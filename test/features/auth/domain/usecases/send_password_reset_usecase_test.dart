import 'package:dartz/dartz.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/auth/domain/repositories/auth_repository.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/send_password_reset_usecase.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

void main() {
  late SendPasswordResetUseCase useCase;
  late MockAuthRepository repository;

  setUp(() {
    repository = MockAuthRepository();
    useCase = SendPasswordResetUseCase(repository);
  });

  const String email = 'rider@ridepro.com';

  test('envía el correo de recuperación con el email correcto', () async {
    when(() => repository.sendPasswordResetEmail(email)).thenAnswer((_) async => const Right(null));

    final result = await useCase(const SendPasswordResetParams(email: email));

    expect(result, const Right<Failure, void>(null));
    verify(() => repository.sendPasswordResetEmail(email)).called(1);
  });

  test('devuelve AuthFailure si el correo no existe', () async {
    const AuthFailure failure = AuthFailure('No existe una cuenta con ese correo.');
    when(() => repository.sendPasswordResetEmail(email)).thenAnswer((_) async => const Left(failure));

    final result = await useCase(const SendPasswordResetParams(email: email));

    expect(result, const Left<Failure, void>(failure));
  });
}
