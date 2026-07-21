import 'package:dartz/dartz.dart';
import 'package:equatable/equatable.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../entities/user_entity.dart';
import '../repositories/auth_repository.dart';

class UpdateProfileUseCase implements UseCase<UserEntity, UpdateProfileParams> {
  UpdateProfileUseCase(this._repository);

  final AuthRepository _repository;

  @override
  Future<Either<Failure, UserEntity>> call(UpdateProfileParams params) {
    return _repository.updateProfile(
      displayName: params.displayName,
      photoUrl: params.photoUrl,
      ftp: params.ftp,
      weightKg: params.weightKg,
    );
  }
}

class UpdateProfileParams extends Equatable {
  const UpdateProfileParams({
    this.displayName,
    this.photoUrl,
    this.ftp,
    this.weightKg,
  });

  final String? displayName;
  final String? photoUrl;
  final int? ftp;
  final double? weightKg;

  @override
  List<Object?> get props => [displayName, photoUrl, ftp, weightKg];
}
