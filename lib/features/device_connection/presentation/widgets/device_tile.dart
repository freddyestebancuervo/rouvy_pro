import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/ble_device.dart';
import '../../domain/entities/device_connection_status.dart';
import '../providers/device_actions_controller.dart';
import 'battery_indicator.dart';
import 'device_type_ui.dart';
import 'live_telemetry_row.dart';
import 'signal_strength_indicator.dart';

/// Fila reutilizada tanto en la lista de "Conectados" como en la de
/// "Dispositivos disponibles" (resultados de escaneo) — el parámetro
/// [showConnectAction] es lo único que cambia el conjunto de botones
/// mostrados entre ambos contextos.
class DeviceTile extends ConsumerWidget {
  const DeviceTile({required this.device, this.showConnectAction = false, super.key});

  final BleDevice device;

  /// `true` en la lista de escaneo (dispositivo aún no conectado, se
  /// ofrece "Conectar"); `false` en la lista de conectados (se ofrece
  /// "Desconectar"/"Olvidar" y el menú de más opciones).
  final bool showConnectAction;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool isPending = ref.watch(pendingDeviceActionsProvider).contains(device.id);
    final DeviceActionsController actions = ref.read(deviceActionsControllerProvider.notifier);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                CircleAvatar(
                  backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                  child: Icon(device.type.icon, color: Theme.of(context).colorScheme.onPrimaryContainer),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        device.name,
                        style: Theme.of(context).textTheme.titleSmall,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Row(
                        children: <Widget>[
                          Container(
                            width: 8,
                            height: 8,
                            margin: const EdgeInsets.only(right: 6),
                            decoration: BoxDecoration(
                              color: device.status.color(context),
                              shape: BoxShape.circle,
                            ),
                          ),
                          Flexible(
                            child: Text(
                              '${device.type.label(l10n)} · ${device.status.label(l10n)}',
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(color: Theme.of(context).colorScheme.outline),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                SignalStrengthIndicator(rssi: device.rssi),
                const SizedBox(width: 10),
                BatteryIndicator(batteryLevel: device.batteryLevel),
                const SizedBox(width: 4),
                _buildTrailingAction(context, ref, l10n, isPending, actions),
              ],
            ),
            if (device.isConnected) LiveTelemetryRow(deviceId: device.id),
          ],
        ),
      ),
    );
  }

  Widget _buildTrailingAction(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
    bool isPending,
    DeviceActionsController actions,
  ) {
    if (isPending) {
      return const SizedBox(
        height: 20,
        width: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
    }

    if (showConnectAction) {
      final bool alreadyConnected = device.status == DeviceConnectionStatus.connected ||
          device.status == DeviceConnectionStatus.connecting;
      return TextButton(
        onPressed: alreadyConnected ? null : () => actions.connect(device.id),
        child: Text(l10n.connectAction),
      );
    }

    return PopupMenuButton<String>(
      icon: const Icon(Icons.more_vert),
      onSelected: (String value) async {
        switch (value) {
          case 'disconnect':
            await actions.disconnect(device.id);
          case 'forget':
            final bool? confirmed = await showDialog<bool>(
              context: context,
              builder: (BuildContext dialogContext) => AlertDialog(
                title: Text(l10n.forgetDeviceConfirmTitle),
                content: Text(l10n.forgetDeviceConfirmMessage),
                actions: <Widget>[
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(false),
                    child: Text(l10n.cancelAction),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.of(dialogContext).pop(true),
                    child: Text(l10n.confirmAction),
                  ),
                ],
              ),
            );
            if (confirmed == true) await actions.forget(device.id);
        }
      },
      itemBuilder: (BuildContext context) => <PopupMenuEntry<String>>[
        PopupMenuItem<String>(value: 'disconnect', child: Text(l10n.disconnectAction)),
        PopupMenuItem<String>(value: 'forget', child: Text(l10n.forgetDeviceAction)),
      ],
    );
  }
}
