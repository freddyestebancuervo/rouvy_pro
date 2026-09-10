import 'package:permission_handler/permission_handler.dart';

/// Resultado agregado de la solicitud de permisos, para que la UI muestre
/// un único estado en vez de inspeccionar cada `Permission` por separado.
enum BlePermissionStatus { granted, denied, permanentlyDenied }

/// Pure, unit-testable BLE permission policy — no platform channels, no
/// dialogs, no SDK detection inside. `BlePermissionHandler` gathers the
/// inputs (platform + `SDK_INT` + one status per permission) and delegates
/// the decision here, so every rule below is provable in `flutter test`.
///
/// - **Android API >= 31:** BLE scanning needs `BLUETOOTH_SCAN` +
///   `BLUETOOTH_CONNECT` only. Location is intentionally *not* required:
///   the manifest declares it only through SDK 30 (`neverForLocation`),
///   so on 31+ the OS can never grant it and it must never block scanning.
/// - **Android API <= 30 (and unknown SDK, fail-closed to legacy):** BLE
///   scanning historically requires foreground location, and
///   `permission_handler` maps `bluetoothScan`/`bluetoothConnect` to
///   non-granted pseudo-states there — so only location decides.
/// - **iOS:** only the Bluetooth permission decides; Android runtime
///   permissions and location are irrelevant.
/// - `permanentlyDenied` is reported only when a *required* permission for
///   that platform/version is permanently denied. An irrelevant permission
///   can never cause `denied` nor `permanentlyDenied`.
BlePermissionStatus evaluateBlePermissionStatus({
  required bool isAndroid,
  required bool isIOS,
  required int? androidSdkInt,
  required PermissionStatus scanStatus,
  required PermissionStatus connectStatus,
  required PermissionStatus locationStatus,
  required PermissionStatus bluetoothStatus,
}) {
  if (isIOS && !isAndroid) {
    return _decide(<PermissionStatus>[bluetoothStatus]);
  }
  if (isAndroid && !isIOS) {
    final int? sdkInt = androidSdkInt;
    if (sdkInt != null && sdkInt >= 31) {
      return _decide(<PermissionStatus>[scanStatus, connectStatus]);
    }
    // SDK <= 30, or unknown SDK: legacy location-gated rule. Unknown falls
    // back to legacy (never to the modern rule) so an SDK-detection
    // failure can only preserve the historical behavior, never silently
    // broaden scanning to an unverified platform state.
    return _decide(<PermissionStatus>[locationStatus]);
  }
  // Web/desktop u otros: sin modelo nativo de permisos BLE en este flujo
  // (Web usa su propio gating en `WebBluetoothUnavailablePage`); se exige
  // el par moderno scan+connect, igual que en Android 12+.
  return _decide(<PermissionStatus>[scanStatus, connectStatus]);
}

BlePermissionStatus _decide(List<PermissionStatus> required) {
  if (required.every((PermissionStatus s) => s.isGranted)) {
    return BlePermissionStatus.granted;
  }
  if (required.any((PermissionStatus s) => s.isPermanentlyDenied)) {
    return BlePermissionStatus.permanentlyDenied;
  }
  return BlePermissionStatus.denied;
}
