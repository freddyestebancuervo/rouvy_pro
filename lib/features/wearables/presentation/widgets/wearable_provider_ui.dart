import 'package:flutter/material.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/wearable_connection_status.dart';
import '../../domain/entities/wearable_provider_type.dart';

extension WearableProviderTypeUi on WearableProviderType {
  String label(AppLocalizations l10n) => switch (this) {
        WearableProviderType.appleHealth => l10n.providerNameAppleHealth,
        WearableProviderType.googleFit => l10n.providerNameGoogleFit,
        WearableProviderType.garmin => l10n.providerNameGarmin,
        WearableProviderType.polar => l10n.providerNamePolar,
        WearableProviderType.coros => l10n.providerNameCoros,
        WearableProviderType.suunto => l10n.providerNameSuunto,
      };

  IconData get icon => switch (this) {
        WearableProviderType.appleHealth => Icons.favorite,
        WearableProviderType.googleFit => Icons.fitness_center,
        WearableProviderType.garmin => Icons.watch,
        WearableProviderType.polar => Icons.watch,
        WearableProviderType.coros => Icons.watch,
        WearableProviderType.suunto => Icons.watch,
      };
}

extension WearableConnectionStatusUi on WearableConnectionStatus {
  String label(AppLocalizations l10n) => switch (this) {
        WearableConnectionStatus.notConnected => l10n.wearableStatusNotConnected,
        WearableConnectionStatus.connecting => l10n.wearableStatusConnecting,
        WearableConnectionStatus.connected => l10n.wearableStatusConnected,
        WearableConnectionStatus.syncing => l10n.wearableStatusSyncing,
        WearableConnectionStatus.error => l10n.wearableStatusError,
        WearableConnectionStatus.pendingPartnerApproval => l10n.wearableStatusPendingApproval,
      };

  Color color(BuildContext context) => switch (this) {
        WearableConnectionStatus.connected => Colors.green,
        WearableConnectionStatus.connecting || WearableConnectionStatus.syncing => Colors.orange,
        WearableConnectionStatus.error => Colors.red,
        WearableConnectionStatus.notConnected => Theme.of(context).colorScheme.outline,
        WearableConnectionStatus.pendingPartnerApproval => Colors.amber.shade800,
      };
}
