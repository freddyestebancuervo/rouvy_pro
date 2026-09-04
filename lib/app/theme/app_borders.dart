import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_gradients.dart';

/// Reglas de borde/"neón" — Korixa Dark Tech (KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01).
///
/// Los diseños de referencia usan iluminación de borde morado/cian, pero
/// NUNCA como resplandor fuerte en todas las cards (Sección 6 del
/// encargo: "no reproducir esto como glow fuerte en cada card"). Tres
/// niveles, de uso decreciente en frecuencia:
///
/// - [neutral]: borde ordinario de card/lista — el 99% de los casos.
/// - [active]: item seleccionado/enfocado — color de marca sólido, sin
///   gradiente ni resplandor, contraste no-textual verificado (3.72:1).
/// - [heroDecoration]: acento raro en pantallas emocionales — el ÚNICO
///   nivel que usa el gradiente de marca como borde, y solo debe
///   aparecer en un elemento por pantalla como mucho.
///
/// Deliberadamente sin `CustomPainter`: un borde con gradiente se logra
/// con un `Container` decorado (gradiente) + `Padding` interior +
/// `Container` hijo (superficie sólida) — ver [heroGradientBorder]. Si en
/// el futuro hace falta algo más elaborado (glow difuminado real), eso sí
/// justificaría un `CustomPainter`, pero no en esta fundación.
abstract class AppBorders {
  static const double neutralWidth = 1;
  static const double activeWidth = 1.5;
  static const double heroWidth = 1.5;

  static const BorderSide neutral = BorderSide(color: DarkTech.border, width: neutralWidth);

  static const BorderSide active = BorderSide(color: DarkTech.borderActive, width: activeWidth);

  /// Envuelve [child] en un borde con [AppGradients.primary] — uso raro,
  /// solo pantallas emocionales, un elemento por pantalla como máximo.
  static Widget heroGradientBorder({
    required Widget child,
    required BorderRadius borderRadius,
    double width = heroWidth,
  }) {
    return Container(
      decoration: BoxDecoration(gradient: AppGradients.primary, borderRadius: borderRadius),
      padding: EdgeInsets.all(width),
      child: ClipRRect(
        borderRadius: BorderRadius.all(Radius.circular((borderRadius.topLeft.x - width).clamp(0, double.infinity))),
        child: child,
      ),
    );
  }
}
