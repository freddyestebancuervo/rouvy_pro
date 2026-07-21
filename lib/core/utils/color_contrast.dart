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

    // `.r`/`.g`/`.b` ya vienen normalizados 0.0-1.0 — `.red`/`.green`/`.blue`
    // (enteros 0-255) están deprecados desde Flutter 3.27.
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }
}
