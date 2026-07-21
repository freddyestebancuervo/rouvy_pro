import 'package:dartz/dartz.dart';
import 'package:equatable/equatable.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../repositories/auth_repository.dart';

class SendPasswordResetUseCase implements UseCase<void, SendPasswordResetParams> {
  SendPasswordResetUseCase(this._repository);

  final AuthRepository _repository;

  @override
  Future<Either<Failure, void>> call(SendPasswordResetParams params) {
    return _repository.sendPasswordResetEmail(params.email);
  }
}

class SendPasswordResetParams extends Equatable {
  const SendPasswordResetParams({required this.email});

  final String email;

  @override
  List<Object?> get props => [email];
}
