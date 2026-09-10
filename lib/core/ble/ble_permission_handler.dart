import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

import '../platform/android_sdk_provider.dart';
import 'ble_permission_policy.dart';

export 'ble_permission_policy.dart' show BlePermissionStatus;

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
  const BlePermissionHandler({AndroidSdkProvider? androidSdkProvider})
    : _androidSdkProvider =
          androidSdkProvider ?? const MethodChannelAndroidSdkProvider();

  final AndroidSdkProvider _androidSdkProvider;

  Future<BlePermissionStatus> requestBlePermissions() async {
    final Map<Permission, PermissionStatus> results = await <Permission>[
      Permission.bluetoothScan,
      Permission.bluetoothConnect,
      // Se sigue solicitando en todas las versiones para cubrir Android
      // ≤30 con el mismo flujo (ahí la ubicación SÍ es requisito de BLE).
      // En Android 12+ el SO la deniega automáticamente porque el manifest
      // no la declara para ese SDK (`neverForLocation`) — eso es esperado
      // y la política de abajo la ignora ahí. Exigirla con `every` en todas
      // las versiones fue el bug que impedía escanear en Android 12+
      // (T-NEW.5): un permiso irrelevante nunca debe bloquear el gate.
      Permission.locationWhenInUse,
      Permission.bluetooth, // no-op en Android, relevante en iOS
    ].request();

    final bool isAndroid =
        !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
    final bool isIOS =
        !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;
    final int? sdkInt =
        isAndroid ? await _androidSdkProvider.getAndroidSdkInt() : null;

    return evaluateBlePermissionStatus(
      isAndroid: isAndroid,
      isIOS: isIOS,
      androidSdkInt: sdkInt,
      scanStatus:
          results[Permission.bluetoothScan] ?? PermissionStatus.denied,
      connectStatus:
          results[Permission.bluetoothConnect] ?? PermissionStatus.denied,
      locationStatus:
          results[Permission.locationWhenInUse] ?? PermissionStatus.denied,
      bluetoothStatus:
          results[Permission.bluetooth] ?? PermissionStatus.denied,
    );
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
