import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/sync/sync_status.dart';
import '../../core/sync/sync_status_provider.dart';
import '../../l10n/generated/app_localizations.dart';

/// Banner delgado en la parte superior de la app, visible SOLO cuando hay
/// algo que comunicar (`offline` o `syncingPendingWrites`) — en el estado
/// `online` normal no ocupa espacio ni se renderiza en absoluto.
///
/// Se monta una única vez en `RideProApp` (envolviendo el `child` del
/// `builder` de `MaterialApp.router`), no dentro de cada pantalla — así
/// funciona de forma consistente sin que cada feature nueva tenga que
/// acordarse de añadirlo.
class ConnectivitySyncBanner extends ConsumerWidget {
  const ConnectivitySyncBanner({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final SyncStatus status = ref.watch(syncStatusProvider).valueOrNull ?? SyncStatus.online;

    return Column(
      children: <Widget>[
        AnimatedSize(
          duration: const Duration(milliseconds: 200),
          child: switch (status) {
            SyncStatus.online => const SizedBox(width: double.infinity),
            SyncStatus.offline => _Banner(
                icon: Icons.cloud_off,
                message: l10n.offlineBannerMessage,
                color: Theme.of(context).colorScheme.errorContainer,
              ),
            SyncStatus.syncingPendingWrites => _Banner(
                icon: Icons.sync,
                message: l10n.syncingBannerMessage,
                color: Theme.of(context).colorScheme.primaryContainer,
                showSpinner: true,
              ),
          },
        ),
        Expanded(child: child),
      ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({
    required this.icon,
    required this.message,
    required this.color,
    this.showSpinner = false,
  });

  final IconData icon;
  final String message;
  final Color color;
  final bool showSpinner;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Container(
        width: double.infinity,
        color: color,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (showSpinner)
              const SizedBox(
                height: 14,
                width: 14,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            else
              Icon(icon, size: 16),
            const SizedBox(width: 8),
            Flexible(child: Text(message, style: Theme.of(context).textTheme.bodySmall)),
          ],
        ),
      ),
    );
  }
}
