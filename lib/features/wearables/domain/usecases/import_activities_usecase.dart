import 'package:dartz/dartz.dart';
import 'package:equatable/equatable.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../entities/external_activity.dart';
import '../entities/wearable_provider_type.dart';
import '../repositories/wearable_repository.dart';

class ImportActivitiesUseCase implements UseCase<List<ExternalActivity>, ImportActivitiesParams> {
  ImportActivitiesUseCase(this._repository);

  final WearableRepository _repository;

  @override
  Future<Either<Failure, List<ExternalActivity>>> call(ImportActivitiesParams params) {
    return _repository.importActivities(params.provider, since: params.since);
  }
}

class ImportActivitiesParams extends Equatable {
  const ImportActivitiesParams({required this.provider, this.since});

  final WearableProviderType provider;
  final DateTime? since;

  @override
  List<Object?> get props => [provider, since];
}
