import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/app/theme/app_colors.dart';
import 'package:rouvy_pro/core/utils/color_contrast.dart';

void main() {
  group('ColorContrast.ratio — casos de referencia conocidos', () {
    test('negro sobre blanco es el contraste máximo (21:1)', () {
      expect(ColorContrast.ratio(Colors.black, Colors.white), closeTo(21.0, 0.01));
    });

    test('un color contra sí mismo es 1:1 (sin contraste)', () {
      expect(ColorContrast.ratio(AppColors.primary, AppColors.primary), closeTo(1.0, 0.01));
    });

    test('el orden de los argumentos no cambia el resultado', () {
      final double ab = ColorContrast.ratio(AppColors.primary, Colors.white);
      final double ba = ColorContrast.ratio(Colors.white, AppColors.primary);
      expect(ab, ba);
    });
  });

  // Regresión: estas combinaciones fallaban WCAG AA antes de la corrección
  // de paleta documentada en `docs/ACCESSIBILITY.md` — este test evita que
  // alguien vuelva a aclarar `AppColors.primary`/`success`/`warning`/`error`
  // sin darse cuenta de que rompe el contraste con el texto blanco que se
  // pinta encima en botones/badges.
  group('AppColors — cumplimiento WCAG AA con texto blanco (regresión)', () {
    test('primary cumple AA para texto normal (botones)', () {
      expect(ColorContrast.meetsAaNormalText(AppColors.primary, Colors.white), isTrue);
    });

    test('error cumple AA para texto normal', () {
      expect(ColorContrast.meetsAaNormalText(AppColors.error, Colors.white), isTrue);
    });

    test('success cumple AA para texto normal', () {
      expect(ColorContrast.meetsAaNormalText(AppColors.success, Colors.white), isTrue);
    });

    test('warning cumple AA para texto normal', () {
      expect(ColorContrast.meetsAaNormalText(AppColors.warning, Colors.white), isTrue);
    });
  });

  group('AppColors — texto normal sobre superficies neutras', () {
    test('texto modo claro (lightOnSurface sobre lightSurface) cumple AA ampliamente', () {
      expect(ColorContrast.meetsAaNormalText(AppColors.lightOnSurface, AppColors.lightSurface), isTrue);
    });

    test('texto modo oscuro (darkOnSurface sobre darkSurface) cumple AA ampliamente', () {
      expect(ColorContrast.meetsAaNormalText(AppColors.darkOnSurface, AppColors.darkSurface), isTrue);
    });
  });
}
