import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/app/theme/app_colors.dart';
import 'package:rouvy_pro/app/theme/app_gradients.dart';
import 'package:rouvy_pro/core/utils/color_contrast.dart';

void main() {
  group('AppGradients — definiciones', () {
    test('primary es el gradiente de 3 paradas morado→azul→cian', () {
      expect(AppGradients.primary.colors, <Color>[DarkTech.brandPurple, DarkTech.brandBlue, DarkTech.brandCyan]);
    });

    test('primaryCta es el gradiente de 2 paradas morado→azul (sin cian)', () {
      expect(AppGradients.primaryCta.colors, <Color>[DarkTech.brandPurple, DarkTech.brandBlue]);
      expect(AppGradients.primaryCta.colors, isNot(contains(DarkTech.brandCyan)));
    });

    test('heroVertical usa las mismas 3 paradas que primary, en orientación vertical', () {
      expect(AppGradients.heroVertical.colors, AppGradients.primary.colors);
      expect(AppGradients.heroVertical.begin, Alignment.topCenter);
      expect(AppGradients.heroVertical.end, Alignment.bottomCenter);
    });

    test('imageScrimBottom va de transparente a negro, no usa colores de marca', () {
      expect(AppGradients.imageScrimBottom.colors.first, Colors.transparent);
      expect(AppGradients.imageScrimBottom.colors, isNot(contains(DarkTech.brandPurple)));
      expect(AppGradients.imageScrimBottom.colors, isNot(contains(DarkTech.brandBlue)));
      expect(AppGradients.imageScrimBottom.colors, isNot(contains(DarkTech.brandCyan)));
    });
  });

  // Esta es la razón por la que existen DOS gradientes de marca — ver el
  // docblock de `AppGradients`. Si algún día se decide colapsarlos en
  // uno solo, estos son exactamente los tests que hay que volver a
  // revisar primero.
  group('AppGradients — contraste de texto (por qué existen dos variantes)', () {
    test('cada parada de primaryCta sostiene texto blanco (AA normal)', () {
      for (final Color stop in AppGradients.primaryCta.colors) {
        expect(
          ColorContrast.meetsAaNormalText(Colors.white, stop),
          isTrue,
          reason: 'la parada $stop de primaryCta debe sostener texto blanco encima',
        );
      }
    });

    test('la parada cian de primary NO sostiene texto blanco — por eso es solo decorativo', () {
      expect(ColorContrast.meetsAaNormalText(Colors.white, DarkTech.brandCyan), isFalse);
    });
  });
}
