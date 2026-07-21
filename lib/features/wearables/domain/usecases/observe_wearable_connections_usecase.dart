import '../entities/wearable_connection.dart';
import '../repositories/wearable_repository.dart';

class ObserveWearableConnectionsUseCase {
  ObserveWearableConnectionsUseCase(this._repository);

  final WearableRepository _repository;

  Stream<List<WearableConnection>> call() => _repository.connectionsStream;
}
