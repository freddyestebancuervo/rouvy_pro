import 'package:dartz/dartz.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/auth/domain/entities/user_entity.dart';
import 'package:rouvy_pro/features/auth/domain/repositories/auth_repository.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/update_profile_usecase.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

void main() {
  late UpdateProfileUseCase useCase;
  late MockAuthRepository repository;

  setUp(() {
    repository = MockAuthRepository();
    useCase = UpdateProfileUseCase(repository);
  });

  const UserEntity updatedUser = UserEntity(
    id: '1',
    email: 'rider@ridepro.com',
    displayName: 'Rider Actualizado',
    ftp: 250,
    weightKg: 70.5,
  );

  test('actualiza el perfil con los parámetros provistos', () async {
    when(
      () => repository.updateProfile(displayName: 'Rider Actualizado', photoUrl: null, ftp: 250, weightKg: 70.5),
    ).thenAnswer((_) async => const Right(updatedUser));

    final result = await useCase(
      const UpdateProfileParams(displayName: 'Rider Actualizado', ftp: 250, weightKg: 70.5),
    );

    expect(result, const Right<Failure, UserEntity>(updatedUser));
    verify(
      () => repository.updateProfile(displayName: 'Rider Actualizado', photoUrl: null, ftp: 250, weightKg: 70.5),
    ).called(1);
  });

  test('propaga ServerFailure si la actualización falla', () async {
    const ServerFailure failure = ServerFailure();
    when(
      () => repository.updateProfile(displayName: any(named: 'displayName'), photoUrl: any(named: 'photoUrl'), ftp: any(named: 'ftp'), weightKg: any(named: 'weightKg')),
    ).thenAnswer((_) async => const Left(failure));

    final result = await useCase(const UpdateProfileParams(displayName: 'X'));

    expect(result, const Left<Failure, UserEntity>(failure));
  });
}
