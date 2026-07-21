import 'package:flutter/material.dart';

import '../../../../l10n/generated/app_localizations.dart';
import '../../domain/entities/device_connection_status.dart';

/// Barras de señal estilo "wifi" — 1 a 4 barras según [SignalQuality].
/// Se recibe el RSSI crudo (no el enum ya calculado) para que el widget
/// sea la única fuente de la escala visual; `BleDevice.signalQuality` en
/// el dominio decide los umbrales en dBm, este widget solo dibuja.
class SignalStrengthIndicator extends StatelessWidget {
  const SignalStrengthIndicator({required this.rssi, super.key});

  final int? rssi;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    if (rssi == null) {
      // Antes de este fix, un lector de pantalla no anunciaba NADA aquí —
      // las 4 barras coloreadas eran puramente decorativas para quien no
      // puede verlas. `Semantics` con `label` es lo mínimo necesario para
      // que TalkBack/VoiceOver comuniquen la misma información que un
      // usuario vidente obtiene mirando el color/altura de las barras.
      return Semantics(
        label: l10n.noSignalLabel,
        child: Icon(Icons.signal_cellular_null, size: 18, color: Theme.of(context).colorScheme.outline),
      );
    }

    final SignalQuality quality = SignalQuality.fromRssi(rssi!);
    final int activeBars = switch (quality) {
      SignalQuality.excellent => 4,
      SignalQuality.good => 3,
      SignalQuality.weak => 2,
      SignalQuality.veryWeak => 1,
    };

    final Color color = switch (quality) {
      SignalQuality.excellent || SignalQuality.good => Colors.green,
      SignalQuality.weak => Colors.orange,
      SignalQuality.veryWeak => Colors.red,
    };

    final String semanticLabel = switch (quality) {
      SignalQuality.excellent => l10n.signalExcellent,
      SignalQuality.good => l10n.signalGood,
      SignalQuality.weak => l10n.signalWeak,
      SignalQuality.veryWeak => l10n.signalVeryWeak,
    };

    return Semantics(
      label: semanticLabel,
      // `excludeSemantics` en los hijos evita que el lector de pantalla
      // además intente describir cada `Container` individual como un
      // elemento gráfico sin nombre — con esto, solo se anuncia el
      // `label` de arriba, una vez, de forma clara.
      child: ExcludeSemantics(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: List<Widget>.generate(4, (int index) {
            final double height = 5.0 + (index * 3);
            final bool isActive = index < activeBars;
            return Padding(
              padding: const EdgeInsets.only(left: 1.5),
              child: Container(
                width: 3,
                height: height,
                decoration: BoxDecoration(
                  color: isActive ? color : Theme.of(context).colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(1),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}
