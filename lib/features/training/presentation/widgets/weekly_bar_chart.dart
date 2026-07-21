import 'package:flutter/material.dart';

/// Gráfico de barras de 7 días, construido con `Container`s de altura
/// proporcional — deliberadamente sin `fl_chart` ni ningún paquete de
/// terceros nuevo. Para 7 barras simples esto es más que suficiente y
/// evita añadir una dependencia (con su propio riesgo de versión/breaking
/// changes) para algo que Flutter puro ya resuelve bien.
///
/// Usa una altura de área de barra FIJA en píxeles (no
/// `FractionallySizedBox`/`Expanded` dentro del `Column`) a propósito:
/// mezclar tamaños flexibles con el `Text` de arriba y abajo de cada
/// barra en el mismo `Column` sin restricciones explícitas es una fuente
/// común de errores de layout en Flutter ("RenderFlex children have
/// non-zero flex..." o alturas infinitas) — con un alto fijo, el cálculo
/// de cada barra es aritmética simple y predecible.
class WeeklyBarChart extends StatelessWidget {
  const WeeklyBarChart({
    required this.valuesKm,
    required this.dayLabels,
    this.fullDayNames,
    super.key,
  });

  /// 7 valores en kilómetros, índice 0 = hace 6 días, índice 6 = hoy.
  final List<double> valuesKm;

  /// 7 etiquetas cortas VISIBLES (p. ej. "L", "M", "X"...) en el mismo orden.
  final List<String> dayLabels;

  /// 7 nombres completos (p. ej. "lunes") para el lector de pantalla — sin
  /// esto, `Semantics` cae a `dayLabels`, que funciona pero es menos claro
  /// ("L, 12 kilómetros" en vez de "lunes, 12 kilómetros").
  final List<String>? fullDayNames;

  static const double _barAreaHeight = 70;
  static const double _minBarHeight = 3;

  @override
  Widget build(BuildContext context) {
    final double maxValue = valuesKm.isEmpty ? 0 : valuesKm.reduce((a, b) => a > b ? a : b);
    final double safeMax = maxValue == 0 ? 1 : maxValue; // evita división por cero

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: List<Widget>.generate(7, (int index) {
        final double value = valuesKm[index];
        final double barHeight = (value / safeMax * _barAreaHeight).clamp(_minBarHeight, _barAreaHeight);
        final bool isToday = index == 6;
        final String dayName = fullDayNames != null ? fullDayNames![index] : dayLabels[index];

        return Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            // Un único nodo Semantics por columna, en vez de que cada
            // `Text` interno se anuncie por separado — antes de este fix,
            // un lector de pantalla recorría "12", luego (sin contexto)
            // "L", como dos elementos inconexos; ahora anuncia una sola
            // frase coherente ("lunes, 12 kilómetros" / "lunes, sin
            // actividad registrada").
            child: Semantics(
              label: value > 0 ? '$dayName, ${value.toStringAsFixed(0)} km' : '$dayName, sin actividad',
              child: ExcludeSemantics(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    SizedBox(
                      height: 16,
                      child: value > 0
                          ? Text(
                              value.toStringAsFixed(0),
                              style: Theme.of(context).textTheme.labelSmall,
                              textAlign: TextAlign.center,
                            )
                          : null,
                    ),
                    SizedBox(
                      height: _barAreaHeight,
                      child: Align(
                        alignment: Alignment.bottomCenter,
                        child: Container(
                          height: barHeight,
                          decoration: BoxDecoration(
                            color: isToday
                                ? Theme.of(context).colorScheme.primary
                                : Theme.of(context).colorScheme.primary.withValues(alpha: 0.4),
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      dayLabels[index],
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            fontWeight: isToday ? FontWeight.w700 : FontWeight.w400,
                          ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }),
    );
  }
}
