import '../entities/telemetry_snapshot.dart';
import '../repositories/device_repository.dart';

class ObserveTelemetryUseCase {
  ObserveTelemetryUseCase(this._repository);

  final DeviceRepository _repository;

  Stream<TelemetrySnapshot> call(String deviceId) => _repository.telemetryStreamFor(deviceId);
}
