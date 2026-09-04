import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/app/theme/app_colors.dart';
import 'package:rouvy_pro/app/theme/app_theme.dart';

void main() {
  group('AppTheme.darkTech — construye un ThemeData válido (Sección 18: probar la API, no migrar pantallas)', () {
    test('no lanza al construirse y usa Brightness.dark', () {
      final ThemeData theme = AppTheme.darkTech;
      expect(theme.brightness, Brightness.dark);
    });

    test('colorScheme.surface/background usan los tokens DarkTech', () {
      final ThemeData theme = AppTheme.darkTech;
      expect(theme.colorScheme.surface, DarkTech.surface);
      expect(theme.scaffoldBackgroundColor, DarkTech.background);
    });

    // `onSecondary` no puede ser blanco acá porque `secondary` termina
    // resolviendo a un tono de marca que incluye cian — ver el docblock
    // de `DarkTech.brandCyan`. Este test es la regresión directa de ese
    // hallazgo de accesibilidad.
    test('onSecondary no es blanco — brandCyan no puede sostener texto blanco', () {
      final ThemeData theme = AppTheme.darkTech;
      expect(theme.colorScheme.onSecondary, isNot(Colors.white));
      expect(theme.colorScheme.onSecondary, DarkTech.background);
    });

    test('textTheme usa la familia tipográfica Inter', () {
      final ThemeData theme = AppTheme.darkTech;
      expect(theme.textTheme.bodyLarge?.fontFamily, 'Inter');
      expect(theme.textTheme.headlineLarge?.fontFamily, 'Inter');
    });
  });

  group('AppTheme.light/dark — siguen siendo el tema activo, ahora con Inter realmente bundleado', () {
    test('AppTheme.light y AppTheme.dark referencian la fuente Inter', () {
      expect(AppTheme.light.textTheme.bodyLarge?.fontFamily, 'Inter');
      expect(AppTheme.dark.textTheme.bodyLarge?.fontFamily, 'Inter');
    });
  });
}
