import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/responsive/korixa_viewport.dart';

/// KORIXA-RESPONSIVE-FOUNDATION-V1-SCREEN01-20260907 — tests puros del
/// clasificador (sin `WidgetTester`/render real): cubren la matriz
/// completa de anchos/altos representativos, los límites exactos
/// alrededor de los umbrales, y un barrido determinista amplio. Todo acá
/// es lógica pura (`KorixaViewportInfo` no depende de Flutter widgets),
/// así que puede cubrir muchísimos tamaños sin el costo de un
/// `testWidgets` real.
void main() {
  group('KorixaViewportInfo — geometría básica', () {
    test('shortestSide/longestSide toman el menor/mayor de width y height', () {
      const KorixaViewportInfo vp = KorixaViewportInfo(width: 1365, height: 599);
      expect(vp.shortestSide, 599);
      expect(vp.longestSide, 1365);
    });

    test('aspectRatio es width/height', () {
      const KorixaViewportInfo vp = KorixaViewportInfo(width: 1920, height: 1080);
      expect(vp.aspectRatio, closeTo(1.7778, 0.001));
    });

    test('orientation: width >= height cuenta como landscape (incluido el empate exacto)', () {
      expect(const KorixaViewportInfo(width: 800, height: 600).isLandscape, isTrue);
      expect(const KorixaViewportInfo(width: 600, height: 800).isPortrait, isTrue);
      expect(const KorixaViewportInfo(width: 500, height: 500).isLandscape, isTrue);
    });
  });

  group('KorixaWidthClass — límites exactos', () {
    test('compact: width < 600', () {
      expect(const KorixaViewportInfo(width: 599, height: 800).widthClass, KorixaWidthClass.compact);
    });

    test('medium: 600 <= width < 1024 (límite inferior inclusive)', () {
      expect(const KorixaViewportInfo(width: 600, height: 800).widthClass, KorixaWidthClass.medium);
      expect(const KorixaViewportInfo(width: 1023, height: 800).widthClass, KorixaWidthClass.medium);
    });

    test('expanded: width >= 1024 (límite inferior inclusive)', () {
      expect(const KorixaViewportInfo(width: 1024, height: 800).widthClass, KorixaWidthClass.expanded);
      expect(const KorixaViewportInfo(width: 2560, height: 1440).widthClass, KorixaWidthClass.expanded);
    });

    test('nunca hay un ancho sin clase — cobertura exhaustiva del rango requerido', () {
      const List<double> widths = <double>[
        320, 360, 390, 430, 599, 600, 768, 800, 844, 915, 932, 1023, 1024, 1280, 1365, 1366, 1440, 1536, 1920, 2560,
      ];
      for (final double w in widths) {
        expect(KorixaWidthClass.values, contains(KorixaViewportInfo(width: w, height: 800).widthClass));
      }
    });
  });

  group('isShortHeight / isVeryShortHeight', () {
    test('isShortHeight: height < 700', () {
      expect(const KorixaViewportInfo(width: 1365, height: 599).isShortHeight, isTrue);
      expect(const KorixaViewportInfo(width: 1365, height: 700).isShortHeight, isFalse);
      expect(const KorixaViewportInfo(width: 1365, height: 900).isShortHeight, isFalse);
    });

    test('isVeryShortHeight: height < 500', () {
      expect(const KorixaViewportInfo(width: 1365, height: 499).isVeryShortHeight, isTrue);
      expect(const KorixaViewportInfo(width: 1365, height: 500).isVeryShortHeight, isFalse);
    });
  });

  group('canFitWideLayout — la regla que fixea el bug real (1365x599)', () {
    test('ROOT_CAUSE_CONFIRMED: 1365x599 con la regla vieja (shortestSide > 600) NO calificaba', () {
      const KorixaViewportInfo vp = KorixaViewportInfo(width: 1365, height: 599);
      expect(vp.shortestSide > 600, isFalse, reason: 'shortestSide=599, la regla vieja fallaba acá — root cause confirmado');
    });

    test('1365x599 SÍ es ancho vía la nueva regla (width >= expandedMinWidth por sí solo)', () {
      const KorixaViewportInfo vp = KorixaViewportInfo(width: 1365, height: 599);
      expect(vp.canFitWideLayout(), isTrue);
    });

    test('un ancho expanded (>=1024) es SIEMPRE ancho, sin importar cuánto caiga el alto', () {
      expect(const KorixaViewportInfo(width: 1024, height: 100).canFitWideLayout(), isTrue);
      expect(const KorixaViewportInfo(width: 2560, height: 200).canFitWideLayout(), isTrue);
    });

    test('800x600 (viewport de test compartido) SÍ es ancho — el límite es inclusive', () {
      expect(const KorixaViewportInfo(width: 800, height: 600).canFitWideLayout(), isTrue);
    });

    test('un ancho medio con alto de teléfono (844x390, 915x412, 932x430) NUNCA es ancho', () {
      expect(const KorixaViewportInfo(width: 844, height: 390).canFitWideLayout(), isFalse);
      expect(const KorixaViewportInfo(width: 915, height: 412).canFitWideLayout(), isFalse);
      expect(const KorixaViewportInfo(width: 932, height: 430).canFitWideLayout(), isFalse);
    });

    test('un ancho angosto (<700 por defecto) nunca es ancho sin importar el alto', () {
      expect(const KorixaViewportInfo(width: 500, height: 900).canFitWideLayout(), isFalse);
    });
  });

  group('Boundary tests — límites exactos alrededor de los umbrales (Sección BOUNDARY_TESTING)', () {
    // 599 / 600 / 601 de alto, a un ancho medio representativo (800, el
    // mismo del caso explícito del encargo) — expone el "cliff" exacto
    // donde debe estar: 599 sigue sin ser ancho, 600/601 sí.
    test('height 599 -> NO ancho, 600 -> SÍ ancho, 601 -> SÍ ancho (a width=800)', () {
      expect(const KorixaViewportInfo(width: 800, height: 599).canFitWideLayout(), isFalse);
      expect(const KorixaViewportInfo(width: 800, height: 600).canFitWideLayout(), isTrue);
      expect(const KorixaViewportInfo(width: 800, height: 601).canFitWideLayout(), isTrue);
    });

    // 1023 / 1024 / 1025 de ancho — a un alto YA suficiente (768), los 3
    // deben calificar como anchos (no hay cliff cuando el alto ya
    // alcanza); el ancho expanded es una vía ADICIONAL, no la única.
    test('width 1023/1024/1025 a height=768 -> los 3 son anchos (el alto ya alcanza)', () {
      expect(const KorixaViewportInfo(width: 1023, height: 768).canFitWideLayout(), isTrue);
      expect(const KorixaViewportInfo(width: 1024, height: 768).canFitWideLayout(), isTrue);
      expect(const KorixaViewportInfo(width: 1025, height: 768).canFitWideLayout(), isTrue);
    });

    // El mismo trío de ancho, pero a un alto INSUFICIENTE (500, por
    // debajo del umbral de 600 para el rango medio) — acá SÍ hay un
    // cliff intencional exactamente en 1024 (el breakpoint de
    // `expandedMinWidth`, permitido por el encargo: "A breakpoint is
    // allowed. A broken layout on either side of it is NOT" — ninguno de
    // los 2 lados es un layout roto, ver welcome_page_test.dart para la
    // prueba de que ambas composiciones renderizan sin overflow).
    test('width 1023/1024/1025 a height=500 -> cliff intencional exactamente en 1024', () {
      expect(const KorixaViewportInfo(width: 1023, height: 500).canFitWideLayout(), isFalse);
      expect(const KorixaViewportInfo(width: 1024, height: 500).canFitWideLayout(), isTrue);
      expect(const KorixaViewportInfo(width: 1025, height: 500).canFitWideLayout(), isTrue);
    });

    test('widthClass boundary: 599/600/601 y 1023/1024/1025', () {
      expect(const KorixaViewportInfo(width: 599, height: 800).widthClass, KorixaWidthClass.compact);
      expect(const KorixaViewportInfo(width: 600, height: 800).widthClass, KorixaWidthClass.medium);
      expect(const KorixaViewportInfo(width: 601, height: 800).widthClass, KorixaWidthClass.medium);
      expect(const KorixaViewportInfo(width: 1023, height: 800).widthClass, KorixaWidthClass.medium);
      expect(const KorixaViewportInfo(width: 1024, height: 800).widthClass, KorixaWidthClass.expanded);
      expect(const KorixaViewportInfo(width: 1025, height: 800).widthClass, KorixaWidthClass.expanded);
    });
  });

  group('fluid() — clamp derivado del viewport', () {
    test('satura en el máximo para viewports ya altos (sin cambio respecto al valor fijo anterior)', () {
      const KorixaViewportInfo vp = KorixaViewportInfo(width: 1440, height: 900);
      final double logo = vp.fluid(120, (KorixaViewportInfo v) => v.height * 0.28, 188);
      expect(logo, 188);
    });

    test('se reduce gradualmente por debajo del punto de saturación, nunca de golpe', () {
      final double at599 = const KorixaViewportInfo(width: 1365, height: 599).fluid(
        120,
        (KorixaViewportInfo v) => v.height * 0.28,
        188,
      );
      final double at900 = const KorixaViewportInfo(width: 1440, height: 900).fluid(
        120,
        (KorixaViewportInfo v) => v.height * 0.28,
        188,
      );
      expect(at599, lessThan(at900));
      expect(at599, greaterThanOrEqualTo(120));
    });

    test('nunca baja del mínimo ni sube del máximo', () {
      final double atTiny = const KorixaViewportInfo(width: 1024, height: 50).fluid(
        120,
        (KorixaViewportInfo v) => v.height * 0.28,
        188,
      );
      expect(atTiny, 120);
    });
  });

  group('CLASSIFIER_SWEEP_TEST — barrido determinista amplio (Sección RANDOM/SWEEP SAFETY)', () {
    test('toda combinación width x height produce una clasificación válida, única y sin negativos', () {
      const List<double> widths = <double>[
        320, 360, 390, 412, 430, 480, 500, 568, 599, 600, 601, 650, 700, 768, 800, 844, 900, 915, 932, 1000, 1023,
        1024, 1025, 1080, 1200, 1280, 1365, 1366, 1440, 1536, 1600, 1920, 2560,
      ];
      const List<double> heights = <double>[
        320, 360, 390, 412, 430, 480, 500, 568, 599, 600, 601, 650, 700, 768, 800, 900, 1080, 1440,
      ];

      int checked = 0;
      for (final double w in widths) {
        for (final double h in heights) {
          final KorixaViewportInfo vp = KorixaViewportInfo(width: w, height: h);

          // Nunca produce medidas inválidas.
          expect(vp.shortestSide, greaterThanOrEqualTo(0));
          expect(vp.longestSide, greaterThanOrEqualTo(vp.shortestSide));
          expect(vp.aspectRatio.isNaN, isFalse);
          expect(vp.aspectRatio.isNegative, isFalse);

          // La orientación siempre resuelve a exactamente uno de los 2
          // valores del enum — nunca ambos ni ninguno (garantía del
          // propio lenguaje vía enum, pero se deja explícito como
          // documentación viva del invariante).
          expect(vp.isPortrait ^ vp.isLandscape, isTrue, reason: 'portrait y landscape deben ser mutuamente excluyentes');

          // La clase de ancho siempre resuelve a exactamente una de las
          // 3 clases.
          final int classMatches = KorixaWidthClass.values.where((KorixaWidthClass c) => c == vp.widthClass).length;
          expect(classMatches, 1);

          // canFitWideLayout es determinista y coherente con sus propias
          // reglas — nunca lanza, nunca es ambiguo.
          final bool wide = vp.canFitWideLayout();
          if (w >= KorixaViewportInfo.expandedMinWidth) {
            expect(wide, isTrue, reason: 'width=$w >= expandedMinWidth siempre debe ser ancho (w=$w,h=$h)');
          }
          if (w < 700 || h < 600) {
            if (w < KorixaViewportInfo.expandedMinWidth) {
              expect(wide, isFalse, reason: 'width=$w < 700 o height=$h < 600 y no expanded no debe ser ancho (w=$w,h=$h)');
            }
          }

          checked++;
        }
      }

      // Sanity check del propio barrido: confirma que efectivamente se
      // ejercitó una matriz amplia (33 anchos x 18 altos), no un
      // subconjunto accidental vacío.
      expect(checked, widths.length * heights.length);
      expect(checked, greaterThan(500));
    });

    test('la clasificación WelcomePage-equivalente (desktop/phone-landscape/portrait) es siempre exactamente 1 de 3', () {
      const List<double> widths = <double>[320, 599, 600, 768, 800, 844, 915, 932, 1023, 1024, 1365, 1920];
      const List<double> heights = <double>[360, 390, 412, 430, 500, 599, 600, 768, 900, 1024, 1440];

      for (final double w in widths) {
        for (final double h in heights) {
          final KorixaViewportInfo vp = KorixaViewportInfo(width: w, height: h);

          final bool isDesktop = vp.isLandscape && vp.canFitWideLayout();
          final bool isPhoneLandscape = vp.isLandscape && !vp.canFitWideLayout();
          final bool isPortrait = vp.isPortrait;

          final int selected = <bool>[isDesktop, isPhoneLandscape, isPortrait].where((bool b) => b).length;
          expect(selected, 1, reason: 'w=$w,h=$h debe resolver a exactamente 1 composición, no $selected');
        }
      }
    });
  });

  group('Casos requeridos explícitos del encargo', () {
    test('1365x599 => DESKTOP=YES, PHONE_LANDSCAPE=NO', () {
      const KorixaViewportInfo vp = KorixaViewportInfo(width: 1365, height: 599);
      final bool isDesktop = vp.isLandscape && vp.canFitWideLayout();
      final bool isPhoneLandscape = vp.isLandscape && !vp.canFitWideLayout();
      expect(isDesktop, isTrue);
      expect(isPhoneLandscape, isFalse);
    });

    test('932x430 => PHONE_LANDSCAPE=YES, DESKTOP=NO', () {
      const KorixaViewportInfo vp = KorixaViewportInfo(width: 932, height: 430);
      final bool isDesktop = vp.isLandscape && vp.canFitWideLayout();
      final bool isPhoneLandscape = vp.isLandscape && !vp.canFitWideLayout();
      expect(isPhoneLandscape, isTrue);
      expect(isDesktop, isFalse);
    });

    test('768x1024 => portrait (tablet portrait), nunca desktop ni phone-landscape', () {
      const KorixaViewportInfo vp = KorixaViewportInfo(width: 768, height: 1024);
      expect(vp.isPortrait, isTrue);
      expect(vp.isLandscape, isFalse);
    });

    const List<(double, double)> requiredViewports = <(double, double)>[
      (390, 844),
      (430, 932),
      (844, 390),
      (915, 412),
      (932, 430),
      (1024, 768),
      (1280, 600),
      (1365, 599),
      (1366, 768),
      (1440, 900),
      (1536, 864),
      (1920, 1080),
      (2560, 1440),
    ];
    for (final (double w, double h) in requiredViewports) {
      test('${w.toInt()}x${h.toInt()} resuelve a exactamente 1 composición', () {
        final KorixaViewportInfo vp = KorixaViewportInfo(width: w, height: h);
        final bool isDesktop = vp.isLandscape && vp.canFitWideLayout();
        final bool isPhoneLandscape = vp.isLandscape && !vp.canFitWideLayout();
        final bool isPortrait = vp.isPortrait;
        final int selected = <bool>[isDesktop, isPhoneLandscape, isPortrait].where((bool b) => b).length;
        expect(selected, 1);
      });
    }
  });
}
