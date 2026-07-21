import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/wearable_connection.dart';
import '../providers/wearable_actions_controller.dart';
import '../providers/wearable_providers.dart';
import '../widgets/wearable_provider_tile.dart';

class WearablesPage extends ConsumerWidget {
  const WearablesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<List<WearableConnection>> connections = ref.watch(wearableConnectionsProvider);

    ref.listen(lastImportedActivitiesProvider, (previous, next) {
      if (next.isNotEmpty && previous != next) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(l10n.activitiesImportedMessage(next.length))));
      }
    });

    return Scaffold(
      appBar: AppBar(title: Text(l10n.wearablesTitle)),
      body: SafeArea(
        child: connections.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (Object error, StackTrace stackTrace) => Center(child: Text(l10n.genericErrorMessage)),
          data: (List<WearableConnection> list) {
            // Orden estable: primero las integraciones reales (Apple
            // Health / Google Fit), luego las simuladas — refleja qué
            // funciona hoy sin necesitar leer el badge de cada una.
            final List<WearableConnection> sorted = <WearableConnection>[...list]
              ..sort((WearableConnection a, WearableConnection b) {
                final int aScore = a.provider.requiresPartnerApproval ? 1 : 0;
                final int bScore = b.provider.requiresPartnerApproval ? 1 : 0;
                return aScore.compareTo(bScore);
              });

            return ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: sorted.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (BuildContext context, int index) =>
                  WearableProviderTile(connection: sorted[index]),
            );
          },
        ),
      ),
    );
  }
}
