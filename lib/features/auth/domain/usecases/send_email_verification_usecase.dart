import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../repositories/auth_repository.dart';

class SendEmailVerificationUseCase implements UseCase<void, NoParams> {
  SendEmailVerificationUseCase(this._repository);

  final AuthRepository _repository;

  @override
  Future<Either<Failure, void>> call(NoParams params) {
    return _repository.sendEmailVerification();
  }
}
