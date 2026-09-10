import 'package:flutter/material.dart';

import '../../../../app/theme/app_typography.dart';

/// Celda de métrica del HUD — número grande legible de un vistazo (el
/// ciclista lo mira mientras pedalea, no puede leer texto pequeño), con
/// la unidad más pequeña al lado y la etiqueta debajo.
///
/// [valueStyle] deja que quien la use elija la jerarquía tipográfica
/// correcta entre [AppTypography.metricLarge]/`metricMedium`/`metricSmall`
/// — hallazgo de auditoría: los 4 medidores del HUD tenían el mismo peso
/// visual pese a no ser igual de importantes (velocidad/potencia son
/// primarias, cadencia/frecuencia cardíaca secundarias). Si no se provee,
/// cae al tamaño anterior (`displaySmall`) para no romper otros usos.
class MetricDisplay extends StatelessWidget {
  const MetricDisplay({
    required this.label,
    required this.value,
    required this.unit,
    this.color,
    this.valueStyle,
    super.key,
  });

  final String label;
  final String value;
  final String unit;
  final Color? color;
  final TextStyle? valueStyle;

  @override
  Widget build(BuildContext context) {
    final Color effectiveColor = color ?? Theme.of(context).colorScheme.onSurface;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        RichText(
          key: const Key('metric-display-value'),
          text: TextSpan(
            children: <InlineSpan>[
              TextSpan(
                text: value,
                style: (valueStyle ?? Theme.of(context).textTheme.displaySmall?.copyWith(fontWeight: FontWeight.w800))
                    ?.copyWith(color: effectiveColor),
              ),
              TextSpan(
                text: ' $unit',
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(color: Theme.of(context).colorScheme.outline),
              ),
            ],
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: Theme.of(context).colorScheme.outline),
        ),
      ],
    );
  }
}
