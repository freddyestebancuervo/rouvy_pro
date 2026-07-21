import 'package:permission_handler/permission_handler.dart';

/// Resultado agregado de la solicitud de permisos, para que la UI muestre
/// un único estado en vez de inspeccionar cada `Permission` por separado.
enum BlePermissionStatus { granted, denied, permanentlyDenied }

/// Centraliza la solicitud de permisos BLE. Las plataformas difieren
/// bastante aquí:
///
/// - **Android 12+ (API 31+):** requiere `BLUETOOTH_SCAN` y
///   `BLUETOOTH_CONNECT` como permisos de tiempo de ejecución (no de
///   ubicación). En Android 11 e inferiores, en cambio, escanear BLE
///   requiere permiso de **ubicación** (`ACCESS_FINE_LOCATION`) — es una
///   particularidad histórica de Android, no un capricho de esta app.
/// - **iOS:** el permiso de Bluetooth (`NSBluetoothAlwaysUsageDescription`)
///   se solicita automáticamente al primer uso del adaptador; no hay un
///   permiso explícito que pedir desde Dart, pero `permission_handler`
///   igual expone `Permission.bluetooth` para consultarlo.
///
/// Ver también `BLE_PERMISSIONS.md` en la raíz del proyecto para los
/// permisos que deben declararse en `AndroidManifest.xml` e `Info.plist`.
class BlePermissionHandler {
  const BlePermissionHandler();

  Future<BlePermissionStatus> requestBlePermissions() async {
    final Map<Permission, PermissionStatus> results = await <Permission>[
      Permission.bluetoothScan,
      Permission.bluetoothConnect,
      // Se solicita igualmente en Android 12+ (donde no es estrictamente
      // necesario) porque `permission_handler` la ignora si el manifest no
      // la declara como "necesaria para BLE" (ver flag
      // `neverForLocation` en BLE_PERMISSIONS.md) — pedirla de más no
      // rompe nada y cubre Android ≤11 sin duplicar lógica por versión de SDK.
      Permission.locationWhenInUse,
      Permission.bluetooth, // no-op en Android, relevante en iOS
    ].request();

    if (results.values.every((PermissionStatus s) => s.isGranted)) {
      return BlePermissionStatus.granted;
    }
    if (results.values.any((PermissionStatus s) => s.isPermanentlyDenied)) {
      return BlePermissionStatus.permanentlyDenied;
    }
    return BlePermissionStatus.denied;
  }

  /// Comprueba el estado actual sin disparar el diálogo del sistema — útil
  /// para decidir si mostrar el banner de "faltan permisos" al entrar a la
  /// pantalla de dispositivos, antes de que el usuario intente escanear.
  Future<bool> hasBlePermissions() async {
    final bool scan = await Permission.bluetoothScan.isGranted;
    final bool connect = await Permission.bluetoothConnect.isGranted;
    return scan && connect;
  }

  /// Abre los ajustes de la app — único camino disponible cuando el
  /// permiso quedó `permanentlyDenied` (el diálogo del sistema ya no
  /// vuelve a aparecer en ese estado).
  Future<void> openSettings() => openAppSettings();
}
