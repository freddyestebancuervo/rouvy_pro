import 'package:flutter/material.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/device_connection_status.dart';
import '../../domain/entities/sport_device_type.dart';

extension SportDeviceTypeUi on SportDeviceType {
  IconData get icon => switch (this) {
        SportDeviceType.smartTrainer => Icons.directions_bike,
        SportDeviceType.powerMeter => Icons.bolt,
        SportDeviceType.heartRateMonitor => Icons.favorite,
        SportDeviceType.cadenceSensor => Icons.autorenew,
        SportDeviceType.speedSensor => Icons.speed,
        SportDeviceType.speedCadenceCombo => Icons.speed,
        SportDeviceType.unknown => Icons.bluetooth,
      };

  String label(AppLocalizations l10n) => switch (this) {
        SportDeviceType.smartTrainer => l10n.deviceTypeSmartTrainer,
        SportDeviceType.powerMeter => l10n.deviceTypePowerMeter,
        SportDeviceType.heartRateMonitor => l10n.deviceTypeHeartRateMonitor,
        SportDeviceType.cadenceSensor => l10n.deviceTypeCadenceSensor,
        SportDeviceType.speedSensor => l10n.deviceTypeSpeedSensor,
        SportDeviceType.speedCadenceCombo => l10n.deviceTypeSpeedCadenceCombo,
        SportDeviceType.unknown => l10n.deviceTypeUnknown,
      };
}

extension DeviceConnectionStatusUi on DeviceConnectionStatus {
  String label(AppLocalizations l10n) => switch (this) {
        DeviceConnectionStatus.connected => l10n.statusConnected,
        DeviceConnectionStatus.connecting => l10n.statusConnecting,
        DeviceConnectionStatus.reconnecting => l10n.statusReconnecting,
        DeviceConnectionStatus.disconnected => l10n.statusDisconnected,
        DeviceConnectionStatus.connectionFailed => l10n.statusConnectionFailed,
        DeviceConnectionStatus.scanning => l10n.statusScanning,
      };

  Color color(BuildContext context) => switch (this) {
        DeviceConnectionStatus.connected => Colors.green,
        DeviceConnectionStatus.connecting || DeviceConnectionStatus.reconnecting => Colors.orange,
        DeviceConnectionStatus.connectionFailed => Colors.red,
        DeviceConnectionStatus.disconnected ||
        DeviceConnectionStatus.scanning =>
          Theme.of(context).colorScheme.outline,
      };
}
