import '../entities/ride_session_record.dart';
import '../repositories/ride_session_repository.dart';

class ObserveRideSessionsUseCase {
  ObserveRideSessionsUseCase(this._repository);

  final RideSessionRepository _repository;

  Stream<List<RideSessionRecord>> call() => _repository.recentSessions;
}
