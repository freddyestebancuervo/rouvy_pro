import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/app/theme/app_colors.dart';
import 'package:rouvy_pro/core/utils/color_contrast.dart';

void main() {
  group('DarkTech — valores de token (Korixa Dark Tech, KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01)', () {
    test('superficies siguen la profundidad tonal esperada', () {
      expect(DarkTech.background, const Color(0xFF05060A));
      expect(DarkTech.surface, const Color(0xFF0D1017));
      expect(DarkTech.surfaceElevated, const Color(0xFF131722));
      expect(DarkTech.border, const Color(0xFF242A38));
    });

    test('marca: azul y morado base coinciden con la propuesta aprobada', () {
      expect(DarkTech.brandBlue, const Color(0xFF315CFF));
      expect(DarkTech.brandPurple, const Color(0xFF8B00FF));
      expect(DarkTech.brandCyan, const Color(0xFF00D9FF));
    });

    test('borderActive reusa brandBlue en vez de introducir un color nuevo', () {
      expect(DarkTech.borderActive, DarkTech.brandBlue);
    });

    test('disabledForeground reusa textMuted en vez de introducir un color nuevo', () {
      expect(DarkTech.disabledForeground, DarkTech.textMuted);
    });
  });

  group('DarkTech — contraste WCAG (validado programáticamente, no copiado a ciegas)', () {
    test('textPrimary cumple AA de texto normal sobre las 3 superficies', () {
      expect(ColorContrast.meetsAaNormalText(DarkTech.textPrimary, DarkTech.background), isTrue);
      expect(ColorContrast.meetsAaNormalText(DarkTech.textPrimary, DarkTech.surface), isTrue);
      expect(ColorContrast.meetsAaNormalText(DarkTech.textPrimary, DarkTech.surfaceElevated), isTrue);
    });

    test('textSecondary cumple AA de texto normal sobre las 3 superficies', () {
      expect(ColorContrast.meetsAaNormalText(DarkTech.textSecondary, DarkTech.background), isTrue);
      expect(ColorContrast.meetsAaNormalText(DarkTech.textSecondary, DarkTech.surface), isTrue);
      expect(ColorContrast.meetsAaNormalText(DarkTech.textSecondary, DarkTech.surfaceElevated), isTrue);
    });

    // `textMuted` no estaba especificado numéricamente en la propuesta
    // original ("un neutro oscuro adecuado") — este es el token que se
    // fijó tras la validación, y el test que evita que alguien lo
    // aclare/oscurezca sin darse cuenta de que rompe AA.
    test('textMuted cumple AA de texto normal sobre las 3 superficies', () {
      expect(ColorContrast.meetsAaNormalText(DarkTech.textMuted, DarkTech.background), isTrue);
      expect(ColorContrast.meetsAaNormalText(DarkTech.textMuted, DarkTech.surface), isTrue);
      expect(ColorContrast.meetsAaNormalText(DarkTech.textMuted, DarkTech.surfaceElevated), isTrue);
    });

    test('brandPurple sostiene texto blanco encima (AA normal)', () {
      expect(ColorContrast.meetsAaNormalText(Colors.white, DarkTech.brandPurple), isTrue);
    });

    test('brandBlue sostiene texto blanco encima (AA normal)', () {
      expect(ColorContrast.meetsAaNormalText(Colors.white, DarkTech.brandBlue), isTrue);
    });

    // Este es el hallazgo central que forzó el gradiente dual (ver
    // `app_gradients.dart`): brandCyan NO puede sostener texto blanco. Si
    // este test alguna vez empieza a fallar (es decir, `brandCyan` pasa a
    // cumplir AA), hay que revisar si el gradiente dual sigue siendo
    // necesario — pero mientras el valor actual siga en pie, cyan se
    // queda fuera de cualquier superficie con texto encima.
    test('brandCyan NO sostiene texto blanco — uso exclusivamente decorativo', () {
      expect(ColorContrast.meetsAaNormalText(Colors.white, DarkTech.brandCyan), isFalse);
    });

    test('brandCyan sí cumple el umbral no-textual (3.0:1) como acento sobre surface', () {
      expect(ColorContrast.ratio(DarkTech.brandCyan, DarkTech.surface), greaterThanOrEqualTo(ColorContrast.wcagAaLargeText));
    });

    test('borderActive cumple el umbral de contraste no-textual (WCAG 1.4.11) sobre surface', () {
      expect(ColorContrast.ratio(DarkTech.borderActive, DarkTech.surface), greaterThanOrEqualTo(ColorContrast.wcagAaLargeText));
    });
  });

  group('DarkTech — semántica de estado (Sección 11) no se mezcla con marca', () {
    test('success/warning/error son distintos entre sí y de los 4 tonos de marca', () {
      final Set<Color> statusColors = <Color>{DarkTech.success, DarkTech.warning, DarkTech.error};
      final Set<Color> brandColors = <Color>{
        DarkTech.brandPurple,
        DarkTech.brandPurpleBright,
        DarkTech.brandBlue,
        DarkTech.brandCyan,
      };

      expect(statusColors.length, 3, reason: 'success/warning/error deben ser 3 colores distintos');
      expect(statusColors.intersection(brandColors), isEmpty, reason: 'el estado nunca debe reusar un tono de marca');
    });
  });

  group('DarkTech — escala de dificultad de ruta (Sección 11) no reusa success/error', () {
    test('los 4 niveles de dificultad son los 4 tonos de marca, no semáforo de estado', () {
      expect(DarkTech.difficultyEasy, DarkTech.brandCyan);
      expect(DarkTech.difficultyModerate, DarkTech.brandBlue);
      expect(DarkTech.difficultyHard, DarkTech.brandPurple);
      expect(DarkTech.difficultyExtreme, DarkTech.brandPurpleBright);

      final Set<Color> difficultyColors = <Color>{
        DarkTech.difficultyEasy,
        DarkTech.difficultyModerate,
        DarkTech.difficultyHard,
        DarkTech.difficultyExtreme,
      };
      final Set<Color> statusColors = <Color>{DarkTech.success, DarkTech.warning, DarkTech.error};

      expect(difficultyColors.intersection(statusColors), isEmpty);
    });
  });

  group('AppColors legado — sigue intacto (esta tarea es aditiva, no un reemplazo)', () {
    test('AppColors.primary/success/warning/error no fueron alterados por esta tarea', () {
      expect(AppColors.primary, const Color(0xFFE82200));
      expect(AppColors.success, const Color(0xFF1F804B));
      expect(AppColors.warning, const Color(0xFFA66908));
      expect(AppColors.error, const Color(0xFFE22E1C));
    });
  });
}
