import 'package:dartz/dartz.dart';
import 'package:equatable/equatable.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../entities/wearable_provider_type.dart';
import '../repositories/wearable_repository.dart';

class DisconnectWearableUseCase implements UseCase<void, DisconnectWearableParams> {
  DisconnectWearableUseCase(this._repository);

  final WearableRepository _repository;

  @override
  Future<Either<Failure, void>> call(DisconnectWearableParams params) {
    return _repository.disconnect(params.provider);
  }
}

class DisconnectWearableParams extends Equatable {
  const DisconnectWearableParams({required this.provider});

  final WearableProviderType provider;

  @override
  List<Object?> get props => [provider];
}
