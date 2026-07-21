import 'package:dartz/dartz.dart';
import 'package:equatable/equatable.dart';

import '../../../../core/error/failures.dart';
import '../../../../core/usecase/usecase.dart';
import '../entities/ride_session_summary.dart';
import '../repositories/ride_session_repository.dart';

class SaveRideSessionUseCase implements UseCase<void, SaveRideSessionParams> {
  SaveRideSessionUseCase(this._repository);

  final RideSessionRepository _repository;

  @override
  Future<Either<Failure, void>> call(SaveRideSessionParams params) {
    return _repository.saveSession(params.summary);
  }
}

class SaveRideSessionParams extends Equatable {
  const SaveRideSessionParams({required this.summary});

  final RideSessionSummary summary;

  @override
  List<Object?> get props => [summary];
}
