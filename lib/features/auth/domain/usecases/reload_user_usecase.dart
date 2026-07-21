import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../entities/user_entity.dart';
import '../repositories/auth_repository.dart';

/// Se usa mientras el usuario está en la pantalla de "verifica tu correo",
/// haciendo polling cada pocos segundos para detectar cuándo confirmó el
/// enlace enviado por email.
class ReloadUserUseCase implements UseCase<UserEntity?, NoParams> {
  ReloadUserUseCase(this._repository);

  final AuthRepository _repository;

  @override
  Future<Either<Failure, UserEntity?>> call(NoParams params) {
    return _repository.reloadCurrentUser();
  }
}
