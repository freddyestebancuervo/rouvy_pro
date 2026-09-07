import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Gradientes de marca — Korixa Dark Tech (KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01).
///
/// ÚNICA fuente de verdad del gradiente morado→azul→cian: nunca declarar
/// un `LinearGradient` ad hoc en una pantalla — usar estos tokens.
///
/// Existen DOS variantes, deliberadamente, por una razón medida (no
/// estética): `DarkTech.brandCyan` (#00D9FF) da solo 1.70:1 de contraste
/// contra texto blanco — muy por debajo del mínimo AA de 4.5:1 — y ninguna
/// variante de cian razonablemente reconocible como "cian" lo resuelve
/// (ver `app_colors.dart`). Por eso:
///   - [primary] (3 paradas, morado→azul→cian) es EXCLUSIVAMENTE
///     decorativo: fondos de héroe, indicador de navegación seleccionado,
///     acentos de borde — nunca con texto/ícono legible apoyado encima de
///     la porción cian.
///   - [primaryCta] (2 paradas, morado→azul) es el ÚNICO gradiente donde
///     un texto blanco puede apoyarse con seguridad — ambas paradas
///     individualmente pasan AA normal contra blanco (5.93:1 / 5.12:1).
///     Es el que debe usar cualquier botón/CTA con etiqueta de texto.
abstract class AppGradients {
  static const LinearGradient primary = LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: <Color>[DarkTech.brandPurple, DarkTech.brandBlue, DarkTech.brandCyan],
  );

  /// Seguro para texto blanco encima en cualquier punto del gradiente —
  /// ver docblock de la clase. Usar para `PrimaryGradientButton` y
  /// cualquier otra superficie con una etiqueta de texto legible.
  static const LinearGradient primaryCta = LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: <Color>[DarkTech.brandPurple, DarkTech.brandBlue],
  );

  /// Variante vertical de [primary] — para fondos de héroe altos en
  /// pantallas emocionales (Sección 2.A: Welcome/Login/Register/Route
  /// Catalog/Route Detail), nunca en pantallas de rendimiento.
  static const LinearGradient heroVertical = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: <Color>[DarkTech.brandPurple, DarkTech.brandBlue, DarkTech.brandCyan],
  );

  /// Superposición oscura inferior para legibilidad de título sobre
  /// imagen de ruta (Sección 13) — nunca el gradiente de marca: es
  /// puramente un scrim de contraste, independiente de la identidad de
  /// color de marca.
  static const LinearGradient imageScrimBottom = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: <Color>[Colors.transparent, Color(0xE6000000)],
    stops: <double>[0.4, 1.0],
  );

  /// Panel oscuro "elevado" junto a un hero (Sección 2.A) —
  /// KORIXA-SCREEN02-LOGIN-DESKTOP-POLISH-LOGO-PANEL-20260907: reemplaza
  /// un `ColoredBox(color: DarkTech.background)` plano por la propia
  /// escala de elevación Dark Tech (superficie más clara junto a la foto,
  /// oscureciendo progresivamente hacia `background`), para que el panel
  /// no se sienta como un bloque negro sólido pegado al hero. Reusa los 3
  /// tonos de superficie ya existentes — sin color nuevo — y ambos ya
  /// pasan AA junto a `textPrimary`/`textSecondary` (ver
  /// `dark_tech_design_tokens_test.dart`), así que no introduce ningún
  /// riesgo de contraste nuevo.
  static const LinearGradient loginDesktopPanel = LinearGradient(
    begin: Alignment.centerLeft,
    end: Alignment.centerRight,
    colors: <Color>[DarkTech.surfaceElevated, DarkTech.surface, DarkTech.background],
    stops: <double>[0.0, 0.30, 0.70],
  );
}
