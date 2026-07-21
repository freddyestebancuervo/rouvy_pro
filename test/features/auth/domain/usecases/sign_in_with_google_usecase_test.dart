import 'package:dartz/dartz.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/core/usecase/usecase.dart';
import 'package:rouvy_pro/features/auth/domain/entities/user_entity.dart';
import 'package:rouvy_pro/features/auth/domain/repositories/auth_repository.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/sign_in_with_google_usecase.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

void main() {
  late SignInWithGoogleUseCase useCase;
  late MockAuthRepository repository;

  setUp(() {
    repository = MockAuthRepository();
    useCase = SignInWithGoogleUseCase(repository);
  });

  const UserEntity tUser = UserEntity(
    id: '1',
    email: 'rider@gmail.com',
    displayName: 'Rider',
    emailVerified: true,
    providerType: AuthProviderType.google,
  );

  test('delega en repository.signInWithGoogle y propaga el resultado', () async {
    when(() => repository.signInWithGoogle()).thenAnswer((_) async => const Right(tUser));

    final result = await useCase(const NoParams());

    expect(result, const Right<Failure, UserEntity>(tUser));
    verify(() => repository.signInWithGoogle()).called(1);
  });

  test('propaga AuthFailure cuando el usuario cancela el selector de cuentas', () async {
    const AuthFailure failure = AuthFailure('Inicio de sesión cancelado.');
    when(() => repository.signInWithGoogle()).thenAnswer((_) async => const Left(failure));

    final result = await useCase(const NoParams());

    expect(result, const Left<Failure, UserEntity>(failure));
  });
}
