import '../entities/ble_device.dart';
import '../repositories/device_repository.dart';

/// A diferencia del resto de casos de uso (que devuelven
/// `Either<Failure, T>` para una operación puntual), este expone
/// directamente el `Stream` del repositorio: escanear es inherentemente
/// continuo, y envolver cada evento del stream en un `Either` no aportaría
/// nada — un escaneo BLE no "falla" evento a evento, o no arranca en
/// absoluto (eso sí se maneja como `Either` en `RequestBlePermissionsUseCase`
/// antes de siquiera llamar a este caso de uso).
class ScanDevicesUseCase {
  ScanDevicesUseCase(this._repository);

  final DeviceRepository _repository;

  Stream<List<BleDevice>> call() => _repository.scanForDevices();
}
