import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../entities/user_entity.dart';
import '../repositories/auth_repository.dart';

class GetCurrentUserUseCase implements UseCase<UserEntity?, NoParams> {
  GetCurrentUserUseCase(this._repository);

  final AuthRepository _repository;

  @override
  Future<Either<Failure, UserEntity?>> call(NoParams params) {
    return _repository.getCurrentUser();
  }
}
