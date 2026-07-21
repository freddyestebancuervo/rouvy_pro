import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/wearable_connection.dart';
import '../../domain/entities/wearable_connection_status.dart';
import '../../domain/entities/wearable_provider_type.dart';
import '../providers/wearable_actions_controller.dart';
import 'wearable_provider_ui.dart';

bool _isOnDeviceHealthProvider(WearableProviderType provider) {
  return provider == WearableProviderType.appleHealth || provider == WearableProviderType.googleFit;
}

class WearableProviderTile extends ConsumerWidget {
  const WearableProviderTile({required this.connection, super.key});

  final WearableConnection connection;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final bool isPending = ref.watch(pendingWearableActionsProvider).contains(connection.provider);
    final WearableActionsController actions = ref.read(wearableActionsControllerProvider.notifier);

    // Un adapter mock puede terminar en `connected`-equivalente solo si en
    // el futuro se decide simular también ese estado; hoy
    // `WearableRepositoryImpl` los mantiene siempre en
    // `pendingPartnerApproval` tras conectar (ver esa clase) — se
    // recalcula aquí igualmente por claridad de la condición, no por
    // necesidad estricta con el estado actual del repositorio.
    final bool showSimulatedBadge = connection.status == WearableConnectionStatus.pendingPartnerApproval;

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
                  child: Icon(connection.provider.icon, color: Theme.of(context).colorScheme.onPrimaryContainer),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(connection.provider.label(l10n), style: Theme.of(context).textTheme.titleSmall),
                      Row(
                        children: <Widget>[
                          Container(
                            width: 8,
                            height: 8,
                            margin: const EdgeInsets.only(right: 6),
                            decoration:
                                BoxDecoration(color: connection.status.color(context), shape: BoxShape.circle),
                          ),
                          Text(
                            connection.status.label(l10n),
                            style: Theme.of(context)
                                .textTheme
                                .bodySmall
                                ?.copyWith(color: Theme.of(context).colorScheme.outline),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                if (isPending)
                  const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                else
                  _ActionButton(connection: connection, actions: actions, l10n: l10n),
              ],
            ),
            if (showSimulatedBadge) ...<Widget>[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.amber.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Icon(Icons.science_outlined, size: 16, color: Colors.amber.shade800),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        l10n.wearableSimulatedBadge,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.amber.shade800),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            if (connection.status == WearableConnectionStatus.error && connection.errorMessage != null) ...<Widget>[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.errorContainer.withValues(alpha: 0.4),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(connection.errorMessage!, style: Theme.of(context).textTheme.bodySmall),
                    if (_isOnDeviceHealthProvider(connection.provider)) ...<Widget>[
                      const SizedBox(height: 4),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: actions.openHealthSettings,
                          child: Text(l10n.openSettingsAction),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
            // Tarea B3: advisorio informativo — distinto contenedor y
            // color del bloque de error de arriba, precisamente para que
            // no se lea como "algo falló" cuando no es el caso.
            if (connection.advisoryMessage != null) ...<Widget>[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Icon(Icons.info_outline, size: 16, color: Theme.of(context).colorScheme.outline),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(connection.advisoryMessage!, style: Theme.of(context).textTheme.bodySmall),
                    ),
                  ],
                ),
              ),
            ],
            if (connection.lastSyncAt != null) ...<Widget>[
              const SizedBox(height: 6),
              Text(
                l10n.wearableLastSyncLabel(_formatDate(connection.lastSyncAt!)),
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.outline),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatDate(DateTime date) {
    return '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')} '
        '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.connection, required this.actions, required this.l10n});

  final WearableConnection connection;
  final WearableActionsController actions;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final bool isConnectedOrSimulated = connection.status == WearableConnectionStatus.connected ||
        connection.status == WearableConnectionStatus.pendingPartnerApproval;

    if (!isConnectedOrSimulated) {
      return TextButton(
        onPressed: () => actions.connect(connection.provider),
        child: Text(l10n.wearableConnectAction),
      );
    }

    return PopupMenuButton<String>(
      icon: const Icon(Icons.more_vert),
      onSelected: (String value) {
        if (value == 'import') actions.importActivities(connection.provider);
        if (value == 'disconnect') actions.disconnect(connection.provider);
      },
      itemBuilder: (BuildContext context) => <PopupMenuEntry<String>>[
        PopupMenuItem<String>(value: 'import', child: Text(l10n.wearableImportAction)),
        PopupMenuItem<String>(value: 'disconnect', child: Text(l10n.wearableDisconnectAction)),
      ],
    );
  }
}
