import 'package:dartz/dartz.dart';
import 'package:equatable/equatable.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../entities/wearable_provider_type.dart';
import '../repositories/wearable_repository.dart';

class ConnectWearableUseCase implements UseCase<void, ConnectWearableParams> {
  ConnectWearableUseCase(this._repository);

  final WearableRepository _repository;

  @override
  Future<Either<Failure, void>> call(ConnectWearableParams params) {
    return _repository.connect(params.provider);
  }
}

class ConnectWearableParams extends Equatable {
  const ConnectWearableParams({required this.provider});

  final WearableProviderType provider;

  @override
  List<Object?> get props => [provider];
}
