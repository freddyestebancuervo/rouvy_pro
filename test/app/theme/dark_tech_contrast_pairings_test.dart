import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/app/theme/app_colors.dart';
import 'package:rouvy_pro/app/theme/app_gradients.dart';
import 'package:rouvy_pro/app/theme/app_theme.dart';
import 'package:rouvy_pro/core/design_system/dark_tech_controls.dart';
import 'package:rouvy_pro/core/utils/color_contrast.dart';

/// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01A — regresión de PARES reales de
/// primer plano/fondo, no de tokens aislados.
///
/// El foundation original (KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01) validó
/// cada color por separado (p. ej. "¿pasa X contra blanco?"). Eso no
/// garantiza que cada par foreground/background realmente usado en el
/// código pase — dos pares opuestos pueden compartir un color con
/// resultados distintos (blanco SOBRE `brandPurple` pasa, `brandPurple`
/// COMO TEXTO sobre una superficie oscura no). Estos tests fijan el
/// contraste real de cada componente, con el umbral correcto según si es
/// texto (WCAG AA normal, ≥4.5:1) o un elemento no-textual como un ícono/
/// borde (WCAG 1.4.11, ≥3.0:1).
void main() {
  group('Defecto #1 — onError / error', () {
    test('DarkTech.onError sobre DarkTech.error cumple AA texto normal', () {
      expect(ColorContrast.meetsAaNormalText(DarkTech.onError, DarkTech.error), isTrue);
    });

    test('blanco sobre DarkTech.error NO cumple — por eso onError no es blanco', () {
      expect(ColorContrast.meetsAaNormalText(Colors.white, DarkTech.error), isFalse);
    });

    test('AppTheme.darkTech.colorScheme.onError/.error es el par accesible real', () {
      final ThemeData theme = AppTheme.darkTech;
      expect(ColorContrast.meetsAaNormalText(theme.colorScheme.onError, theme.colorScheme.error), isTrue);
    });
  });

  group('Defecto #2 — GhostButton / TextButton: interactiveText sobre las 3 superficies', () {
    test('interactiveText sobre background cumple AA texto normal', () {
      expect(ColorContrast.meetsAaNormalText(DarkTech.interactiveText, DarkTech.background), isTrue);
    });

    test('interactiveText sobre surface cumple AA texto normal', () {
      expect(ColorContrast.meetsAaNormalText(DarkTech.interactiveText, DarkTech.surface), isTrue);
    });

    test('interactiveText sobre surfaceElevated cumple AA texto normal', () {
      expect(ColorContrast.meetsAaNormalText(DarkTech.interactiveText, DarkTech.surfaceElevated), isTrue);
    });

    // Regresión directa del defecto: brandPurple, el color previamente
    // usado, reprueba en las 3 superficies como color de texto.
    test('brandPurple (color anterior) reprueba AA como texto en las 3 superficies — por qué se reemplazó', () {
      expect(ColorContrast.meetsAaNormalText(DarkTech.brandPurple, DarkTech.background), isFalse);
      expect(ColorContrast.meetsAaNormalText(DarkTech.brandPurple, DarkTech.surface), isFalse);
      expect(ColorContrast.meetsAaNormalText(DarkTech.brandPurple, DarkTech.surfaceElevated), isFalse);
    });

    test('AppTheme.darkTech.textButtonTheme usa interactiveText, no brandPurple', () {
      final ThemeData theme = AppTheme.darkTech;
      final Color? foreground = theme.textButtonTheme.style?.foregroundColor?.resolve(<WidgetState>{});
      expect(foreground, DarkTech.interactiveText);
      expect(ColorContrast.meetsAaNormalText(foreground!, DarkTech.surfaceElevated), isTrue);
    });
  });

  group('Defecto #3 — bottom-nav: etiqueta vs ícono seleccionados', () {
    test('etiqueta seleccionada sobre el fondo del nav cumple AA texto normal', () {
      expect(
        ColorContrast.meetsAaNormalText(DarkTechBottomNavStyle.selectedLabelColor, DarkTechBottomNavStyle.background),
        isTrue,
      );
    });

    test('etiqueta NO seleccionada sobre el fondo del nav cumple AA texto normal', () {
      expect(
        ColorContrast.meetsAaNormalText(
          DarkTechBottomNavStyle.unselectedLabelColor,
          DarkTechBottomNavStyle.background,
        ),
        isTrue,
      );
    });

    // Regresión directa: el color de ícono seleccionado (brandBlue) NO
    // debe usarse como texto — es exactamente el error que se corrigió.
    test('el color de ícono seleccionado reprueba AA como texto — por eso la etiqueta usa un token distinto', () {
      expect(
        ColorContrast.meetsAaNormalText(
          DarkTechBottomNavStyle.selectedIconColor,
          DarkTechBottomNavStyle.background,
        ),
        isFalse,
      );
      expect(DarkTechBottomNavStyle.selectedLabelColor, isNot(DarkTechBottomNavStyle.selectedIconColor));
    });

    test('el ícono seleccionado sí cumple el umbral no-textual (≥3.0:1) sobre el fondo del nav', () {
      expect(
        ColorContrast.ratio(DarkTechBottomNavStyle.selectedIconColor, DarkTechBottomNavStyle.background),
        greaterThanOrEqualTo(ColorContrast.wcagAaLargeText),
      );
    });
  });

  group('CTA gradient — muestreo a lo largo de primaryCta, no solo las paradas', () {
    Color lerpAt(double t) => Color.lerp(DarkTech.brandPurple, DarkTech.brandBlue, t)!;

    // AppGradients.primaryCta es un LinearGradient de 2 paradas
    // interpoladas linealmente en sRGB por el motor de Flutter — muestrear
    // Color.lerp entre esas mismas 2 paradas reproduce fielmente cualquier
    // punto intermedio que el gradiente realmente pinta.
    for (final double t in <double>[0.0, 0.25, 0.5, 0.75, 1.0]) {
      test('t=$t bajo texto blanco cumple AA texto normal', () {
        expect(AppGradients.primaryCta.colors, <Color>[DarkTech.brandPurple, DarkTech.brandBlue]);
        expect(ColorContrast.meetsAaNormalText(Colors.white, lerpAt(t)), isTrue);
      });
    }
  });
}
