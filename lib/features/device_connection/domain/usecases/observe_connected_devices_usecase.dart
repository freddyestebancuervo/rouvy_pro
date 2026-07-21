import '../entities/ble_device.dart';
import '../repositories/device_repository.dart';

class ObserveConnectedDevicesUseCase {
  ObserveConnectedDevicesUseCase(this._repository);

  final DeviceRepository _repository;

  Stream<List<BleDevice>> call() => _repository.connectedDevicesStream;
}
