import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../repositories/auth_repository.dart';

class LogoutUseCase implements UseCase<void, NoParams> {
  LogoutUseCase(this._repository);

  final AuthRepository _repository;

  @override
  Future<Either<Failure, void>> call(NoParams params) {
    return _repository.logout();
  }
}
