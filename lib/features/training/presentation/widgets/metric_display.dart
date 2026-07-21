import 'package:flutter/material.dart';

/// Celda de métrica del HUD — número grande legible de un vistazo (el
/// ciclista lo mira mientras pedalea, no puede leer texto pequeño), con
/// la unidad más pequeña al lado y la etiqueta debajo.
class MetricDisplay extends StatelessWidget {
  const MetricDisplay({
    required this.label,
    required this.value,
    required this.unit,
    this.color,
    super.key,
  });

  final String label;
  final String value;
  final String unit;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final Color effectiveColor = color ?? Theme.of(context).colorScheme.onSurface;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        RichText(
          text: TextSpan(
            children: <InlineSpan>[
              TextSpan(
                text: value,
                style: Theme.of(context).textTheme.displaySmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      color: effectiveColor,
                    ),
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
