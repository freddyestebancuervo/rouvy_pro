import 'package:equatable/equatable.dart';

import 'ble_device_compatibility_status.dart';
import 'device_connection_status.dart';
import 'sport_device_type.dart';

/// Entidad pura de dominio — no importa `flutter_blue_plus` ni ningún SDK
/// BLE. La capa `data` (`ble_device_model.dart`) es quien sabe convertir
/// un `BluetoothDevice` de la librería a esto.
class BleDevice extends Equatable {
  const BleDevice({
    required this.id,
    required this.name,
    required this.type,
    required this.status,
    this.rssi,
    this.batteryLevel,
    this.manufacturer,
    this.isAutoReconnectEnabled = true,
    this.compatibilityStatus = BleDeviceCompatibilityStatus.discovered,
  });

  /// Identificador único de la plataforma (MAC en Android, UUID en iOS —
  /// por eso se trata siempre como `String` opaco, nunca se parsea).
  final String id;

  final String name;
  final SportDeviceType type;
  final DeviceConnectionStatus status;

  /// `null` mientras no se ha recibido ninguna lectura de señal todavía
  /// (p. ej. justo tras conectar, antes del primer refresco de RSSI).
  final int? rssi;

  /// `null` si el dispositivo no expone Battery Service, o aún no se ha
  /// leído. No todos los rodillos conectados a corriente lo implementan.
  final int? batteryLevel;

  final String? manufacturer;

  /// Si es `true`, el datasource intenta reconectar automáticamente ante
  /// una caída de señal sin que el usuario tenga que volver a emparejar.
  /// Se guarda por dispositivo (no es un ajuste global) porque el usuario
  /// puede querer, por ejemplo, no reconectar automáticamente a un
  /// pulsómetro prestado que no es suyo.
  final bool isAutoReconnectEnabled;

  /// Evidence-based Korixa support status. Scan results default to
  /// [BleDeviceCompatibilityStatus.discovered]; stronger compatibility is
  /// assigned only after GATT service discovery evaluates real capabilities.
  final BleDeviceCompatibilityStatus compatibilityStatus;

  SignalQuality? get signalQuality =>
      rssi == null ? null : SignalQuality.fromRssi(rssi!);

  bool get isConnected => status == DeviceConnectionStatus.connected;

  BleDevice copyWith({
    String? name,
    SportDeviceType? type,
    DeviceConnectionStatus? status,
    int? rssi,
    int? batteryLevel,
    String? manufacturer,
    bool? isAutoReconnectEnabled,
    BleDeviceCompatibilityStatus? compatibilityStatus,
  }) {
    return BleDevice(
      id: id,
      name: name ?? this.name,
      type: type ?? this.type,
      status: status ?? this.status,
      rssi: rssi ?? this.rssi,
      batteryLevel: batteryLevel ?? this.batteryLevel,
      manufacturer: manufacturer ?? this.manufacturer,
      isAutoReconnectEnabled:
          isAutoReconnectEnabled ?? this.isAutoReconnectEnabled,
      compatibilityStatus: compatibilityStatus ?? this.compatibilityStatus,
    );
  }

  @override
  List<Object?> get props => [
        id,
        name,
        type,
        status,
        rssi,
        batteryLevel,
        manufacturer,
        isAutoReconnectEnabled,
        compatibilityStatus,
      ];
}
