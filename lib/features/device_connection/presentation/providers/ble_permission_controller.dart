import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/injection.dart';
import '../../../../core/ble/ble_permission_handler.dart';

/// Estado de permisos separado del `bool` simple de `requestBlePermissions`
/// del dominio porque la UI necesita distinguir tres casos con acciones
/// distintas: conceder normal (reintentar), denegado (explicar y
/// reintentar) y denegado permanentemente (solo queda abrir Ajustes).
final blePermissionStatusProvider =
    AsyncNotifierProvider<BlePermissionController, BlePermissionStatus>(BlePermissionController.new);

class BlePermissionController extends AsyncNotifier<BlePermissionStatus> {
  BlePermissionHandler get _handler => sl<BlePermissionHandler>();

  @override
  Future<BlePermissionStatus> build() async {
    final bool hasPermissions = await _handler.hasBlePermissions();
    return hasPermissions ? BlePermissionStatus.granted : BlePermissionStatus.denied;
  }

  Future<void> request() async {
    state = const AsyncLoading();
    final BlePermissionStatus status = await _handler.requestBlePermissions();
    state = AsyncData(status);
  }

  Future<void> openSettings() => _handler.openSettings();
}
