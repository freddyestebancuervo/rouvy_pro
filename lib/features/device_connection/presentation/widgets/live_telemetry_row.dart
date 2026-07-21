import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/telemetry_snapshot.dart';
import '../providers/device_providers.dart';

/// Muestra la última lectura de un dispositivo conectado — solo los
/// campos que ese dispositivo realmente reporta (un pulsómetro solo
/// muestra FC, un rodillo muestra velocidad/potencia/cadencia). Se
/// reconstruye únicamente esta fila en cada notificación BLE (~1/s), no
/// la tarjeta completa del dispositivo, gracias a que vive en su propio
/// `Consumer`.
class LiveTelemetryRow extends ConsumerWidget {
  const LiveTelemetryRow({required this.deviceId, super.key});

  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final AsyncValue<TelemetrySnapshot> telemetry = ref.watch(deviceTelemetryProvider(deviceId));

    return telemetry.when(
      loading: () => const SizedBox.shrink(),
      error: (Object error, StackTrace stackTrace) => const SizedBox.shrink(),
      data: (TelemetrySnapshot snapshot) {
        final List<Widget> chips = <Widget>[
          if (snapshot.speedKmh != null)
            _MetricChip(label: l10n.liveSpeedLabel, value: '${snapshot.speedKmh!.toStringAsFixed(1)} km/h'),
          if (snapshot.powerWatts != null)
            _MetricChip(label: l10n.livePowerLabel, value: '${snapshot.powerWatts} W'),
          if (snapshot.cadenceRpm != null)
            _MetricChip(label: l10n.liveCadenceLabel, value: '${snapshot.cadenceRpm} rpm'),
          if (snapshot.heartRateBpm != null)
            _MetricChip(label: l10n.liveHeartRateLabel, value: '${snapshot.heartRateBpm} bpm'),
        ];

        if (chips.isEmpty) return const SizedBox.shrink();

        return Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Wrap(spacing: 12, children: chips),
        );
      },
    );
  }
}

class _MetricChip extends StatelessWidget {
  const _MetricChip({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return RichText(
      text: TextSpan(
        style: Theme.of(context).textTheme.bodySmall,
        children: <InlineSpan>[
          TextSpan(text: '$label ', style: TextStyle(color: Theme.of(context).colorScheme.outline)),
          TextSpan(
            text: value,
            style: TextStyle(fontWeight: FontWeight.w600, color: Theme.of(context).colorScheme.onSurface),
          ),
        ],
      ),
    );
  }
}
