import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/ble_device.dart';
import '../providers/device_scan_controller.dart';
import '../widgets/device_tile.dart';

/// Hoja modal que encapsula el ciclo de vida completo del escaneo: arranca
/// automáticamente al abrirse y se detiene al cerrarse (swipe-down o botón
/// atrás) — así nunca queda un escaneo BLE corriendo en segundo plano
/// consumiendo batería después de que el usuario ya cerró la pantalla.
class DeviceScanSheet extends ConsumerStatefulWidget {
  const DeviceScanSheet({super.key});

  @override
  ConsumerState<DeviceScanSheet> createState() => _DeviceScanSheetState();
}

class _DeviceScanSheetState extends ConsumerState<DeviceScanSheet> {
  @override
  void initState() {
    super.initState();
    // Se difiere al final del frame actual: `startScan` termina
    // disparando un `state =` durante el build inicial de la hoja si se
    // llamara síncronamente aquí, lo cual Flutter no permite.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(deviceScanControllerProvider.notifier).startScan();
    });
  }

  @override
  void dispose() {
    ref.read(deviceScanControllerProvider.notifier).stopScan();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DeviceScanState scanState = ref.watch(deviceScanControllerProvider);

    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      expand: false,
      builder: (BuildContext context, ScrollController scrollController) {
        return Column(
          children: <Widget>[
            const SizedBox(height: 12),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.outlineVariant,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Text(l10n.availableDevicesSection, style: Theme.of(context).textTheme.titleMedium),
                  ),
                  if (scanState.isScanning)
                    const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                ],
              ),
            ),
            if (scanState.isScanning)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  l10n.scanningInProgressMessage,
                  style: TextStyle(color: Theme.of(context).colorScheme.outline),
                ),
              ),
            Expanded(
              child: scanState.devices.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          l10n.noDevicesFoundMessage,
                          textAlign: TextAlign.center,
                          style: TextStyle(color: Theme.of(context).colorScheme.outline),
                        ),
                      ),
                    )
                  : ListView.separated(
                      controller: scrollController,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: scanState.devices.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (BuildContext context, int index) {
                        final BleDevice device = scanState.devices[index];
                        return DeviceTile(device: device, showConnectAction: true);
                      },
                    ),
            ),
          ],
        );
      },
    );
  }
}
