import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/ble/ble_permission_handler.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/ble_device.dart';
import '../providers/ble_permission_controller.dart';
import '../providers/device_providers.dart';
import '../providers/web_bluetooth_support_provider.dart';
import '../widgets/device_status_banner.dart';
import '../widgets/device_tile.dart';
import 'device_scan_sheet.dart';
import 'web_bluetooth_unavailable_page.dart';

/// Pantalla principal del módulo: punto 7 del encargo ("pantalla para
/// administrar dispositivos conectados"). Se accede desde Perfil →
/// Dispositivos conectados, y también será el punto de entrada antes de
/// cada sesión de entrenamiento (M2) si aún no hay nada conectado.
class DeviceManagementPage extends ConsumerWidget {
  const DeviceManagementPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<bool> webBluetoothSupported = ref.watch(webBluetoothSupportedProvider);

    // Gating exclusivo de ESTA pantalla — decisión de arquitectura 4 (ver
    // ARCHITECTURE_DECISIONS.md): en cualquier otra plataforma
    // (Android/iOS/desktop) `isWebBluetoothSupported()` siempre resuelve
    // `true` de inmediato, así que este `when` es efectivamente un no-op
    // fuera de Web — no introduce ningún retraso ni pantalla de carga
    // perceptible en las plataformas principales de entrenamiento.
    return Scaffold(
      appBar: AppBar(title: Text(l10n.deviceManagementTitle)),
      floatingActionButton: webBluetoothSupported.valueOrNull == false
          ? null
          : FloatingActionButton.extended(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (BuildContext context) => const DeviceScanSheet(),
              ),
              icon: const Icon(Icons.bluetooth_searching),
              label: Text(l10n.scanForDevicesButton),
            ),
      body: SafeArea(
        child: webBluetoothSupported.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (Object error, StackTrace stackTrace) => const _DeviceManagementBody(),
          data: (bool supported) =>
              supported ? const _DeviceManagementBody() : const WebBluetoothUnavailablePage(),
        ),
      ),
    );
  }
}

/// Contenido normal de la pantalla — extraído a un widget aparte para que
/// el `when` de arriba decida con claridad entre "mostrar esto" o
/// "mostrar el aviso de Web Bluetooth", sin anidar más lógica de la
/// necesaria dentro del `build` principal.
class _DeviceManagementBody extends ConsumerWidget {
  const _DeviceManagementBody();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<bool> bluetoothEnabled = ref.watch(bluetoothEnabledProvider);
    final AsyncValue<BlePermissionStatus> permissionStatus = ref.watch(blePermissionStatusProvider);
    final AsyncValue<List<BleDevice>> connectedDevices = ref.watch(connectedDevicesProvider);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        if (bluetoothEnabled.valueOrNull == false) DeviceStatusBanner(message: l10n.bluetoothOffMessage),
        if (permissionStatus.valueOrNull == BlePermissionStatus.denied)
          DeviceStatusBanner(
            message: l10n.permissionsRequiredMessage,
            actionLabel: l10n.grantPermissionAction,
            onAction: () => ref.read(blePermissionStatusProvider.notifier).request(),
          ),
        if (permissionStatus.valueOrNull == BlePermissionStatus.permanentlyDenied)
          DeviceStatusBanner(
            message: l10n.permissionsRequiredMessage,
            actionLabel: l10n.openSettingsAction,
            onAction: () => ref.read(blePermissionStatusProvider.notifier).openSettings(),
          ),
        Text(l10n.connectedDevicesSection, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        connectedDevices.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (Object error, StackTrace stackTrace) => Text(l10n.genericErrorMessage),
          data: (List<BleDevice> devices) {
            if (devices.isEmpty) {
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Text(
                  l10n.noConnectedDevicesMessage,
                  style: TextStyle(color: Theme.of(context).colorScheme.outline),
                ),
              );
            }
            return Column(
              children: devices
                  .map((BleDevice d) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: DeviceTile(device: d),
                      ))
                  .toList(),
            );
          },
        ),
        const SizedBox(height: 80), // espacio para el FAB
      ],
    );
  }
}
