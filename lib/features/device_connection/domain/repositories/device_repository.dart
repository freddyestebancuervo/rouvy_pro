import 'package:dartz/dartz.dart';

import '../../../../core/error/failures.dart';
import '../entities/ble_device.dart';
import '../entities/telemetry_snapshot.dart';

/// Puerto (interfaz) del módulo BLE. La capa `data` (`DeviceRepositoryImpl`)
/// es la única que sabe que detrás de esto hay `flutter_blue_plus` — el
/// dominio y la presentación solo ven streams y `Either<Failure, T>`.
abstract class DeviceRepository {
  /// Inicia un escaneo y emite la lista de dispositivos encontrados,
  /// actualizándose (nuevo dispositivo o RSSI refrescado) mientras el
  /// escaneo sigue activo. El escaneo se detiene solo (timeout interno) o
  /// llamando a [stopScan].
  Stream<List<BleDevice>> scanForDevices();

  Future<Either<Failure, void>> stopScan();

  /// Conecta a un dispositivo ya visto en el escaneo (o previamente
  /// conocido, para reconexión manual). No bloquea esperando a que
  /// termine — el progreso se observa vía [connectedDevicesStream].
  Future<Either<Failure, void>> connect(String deviceId);

  Future<Either<Failure, void>> disconnect(String deviceId);

  /// Olvida el dispositivo: lo desconecta si está conectado y lo quita de
  /// la lista de reconexión automática persistida.
  Future<Either<Failure, void>> forgetDevice(String deviceId);

  /// Estado en vivo de todos los dispositivos que la app conoce (conectados,
  /// conectando, o reconectando) — la pantalla de gestión de dispositivos
  /// se construye enteramente sobre este stream.
  Stream<List<BleDevice>> get connectedDevicesStream;

  /// Telemetría en crudo de UN dispositivo — se combina con la de otros
  /// en `TelemetryAggregator` (domain/services), no aquí.
  Stream<TelemetrySnapshot> telemetryStreamFor(String deviceId);

  Future<Either<Failure, bool>> hasBlePermissions();

  Future<Either<Failure, bool>> requestBlePermissions();

  /// `true` si el adaptador Bluetooth del teléfono está encendido —
  /// distinto de los permisos: el usuario puede haber dado permiso pero
  /// tener el Bluetooth apagado.
  Stream<bool> get isBluetoothEnabled;
}
