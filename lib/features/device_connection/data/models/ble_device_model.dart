import 'package:flutter_blue_plus/flutter_blue_plus.dart';

import '../../domain/entities/ble_device.dart';
import '../../domain/entities/device_connection_status.dart';
import '../../domain/entities/sport_device_type.dart';

class BleDeviceModel extends BleDevice {
  const BleDeviceModel({
    required super.id,
    required super.name,
    required super.type,
    required super.status,
    super.rssi,
    super.batteryLevel,
    super.manufacturer,
    super.isAutoReconnectEnabled,
  });

  /// Construye el modelo a partir de un resultado de escaneo. El nombre
  /// puede venir vacío en el paquete de advertising (algunos fabricantes
  /// solo lo exponen tras conectar) — se usa un fallback legible en vez de
  /// mostrar una fila en blanco en la lista de escaneo.
  factory BleDeviceModel.fromScanResult(ScanResult result) {
    final String advertisedName =
        result.advertisementData.advName.isNotEmpty ? result.advertisementData.advName : result.device.platformName;

    final List<String> serviceUuids =
        result.advertisementData.serviceUuids.map((Guid g) => g.str).toList();

    return BleDeviceModel(
      id: result.device.remoteId.str,
      name: advertisedName.isNotEmpty ? advertisedName : 'Dispositivo BLE',
      type: SportDeviceType.fromAdvertisedServices(serviceUuids),
      status: DeviceConnectionStatus.disconnected,
      rssi: result.rssi,
    );
  }

  BleDeviceModel copyWithModel({
    String? name,
    SportDeviceType? type,
    DeviceConnectionStatus? status,
    int? rssi,
    int? batteryLevel,
    String? manufacturer,
    bool? isAutoReconnectEnabled,
  }) {
    return BleDeviceModel(
      id: id,
      name: name ?? this.name,
      type: type ?? this.type,
      status: status ?? this.status,
      rssi: rssi ?? this.rssi,
      batteryLevel: batteryLevel ?? this.batteryLevel,
      manufacturer: manufacturer ?? this.manufacturer,
      isAutoReconnectEnabled: isAutoReconnectEnabled ?? this.isAutoReconnectEnabled,
    );
  }
}
