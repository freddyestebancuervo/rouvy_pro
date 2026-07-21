import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Calcula el ratio de contraste WCAG 2.1 entre dos colores — la misma
/// fórmula que usan las herramientas de auditoría de accesibilidad
/// (Lighthouse, axe, WebAIM). Se implementa aquí (en vez de depender de
/// un paquete externo) porque es un cálculo estándar, bien documentado y
/// pequeño — no vale la pena la dependencia extra para esto.
///
/// Referencia: https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
abstract class ColorContrast {
  /// AA para texto normal (<18pt, o <14pt en negrita).
  static const double wcagAaNormalText = 4.5;

  /// AA para texto grande (≥18pt, o ≥14pt en negrita) — el umbral es más
  /// bajo porque el texto grande sigue siendo legible con menos contraste.
  static const double wcagAaLargeText = 3.0;

  static double ratio(Color a, Color b) {
    final double la = _relativeLuminance(a);
    final double lb = _relativeLuminance(b);
    final double lighter = la > lb ? la : lb;
    final double darker = la > lb ? lb : la;
    return (lighter + 0.05) / (darker + 0.05);
  }

  static bool meetsAaNormalText(Color a, Color b) => ratio(a, b) >= wcagAaNormalText;

  static bool meetsAaLargeText(Color a, Color b) => ratio(a, b) >= wcagAaLargeText;

  static double _relativeLuminance(Color color) {
    double channel(double c) {
      return c <= 0.03928 ? c / 12.92 : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
    }

    // Se usa `.red`/`.green`/`.blue` (enteros 0-255, API estable desde las
    // primeras versiones de Flutter) en vez de los getters `.r`/`.g`/`.b`
    // (doubles normalizados) introducidos en versiones más recientes —
    // este proyecto fija `sdk: flutter: '>=3.19.0'` en `pubspec.yaml`, y
    // sin poder ejecutar `flutter pub get`/compilar en este entorno para
    // confirmar qué getters expone esa versión mínima exacta, se prefiere
    // la API de compatibilidad más amplia conocida en vez de arriesgar un
    // error de compilación no detectable aquí.
    return 0.2126 * channel(color.red / 255.0) +
        0.7152 * channel(color.green / 255.0) +
        0.0722 * channel(color.blue / 255.0);
  }
}
