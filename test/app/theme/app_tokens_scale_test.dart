import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/app/theme/app_borders.dart';
import 'package:rouvy_pro/app/theme/app_colors.dart';
import 'package:rouvy_pro/app/theme/app_radius.dart';
import 'package:rouvy_pro/app/theme/app_spacing.dart';

void main() {
  group('AppSpacing — escala 4/8/12/16/20/24/32/40', () {
    test('valores exactos de la escala', () {
      expect(AppSpacing.xs, 4);
      expect(AppSpacing.sm, 8);
      expect(AppSpacing.md, 12);
      expect(AppSpacing.base, 16);
      expect(AppSpacing.lg, 20);
      expect(AppSpacing.xl, 24);
      expect(AppSpacing.xxl, 32);
      expect(AppSpacing.xxxl, 40);
    });

    test('la escala es estrictamente creciente', () {
      final List<double> scale = <double>[
        AppSpacing.xs,
        AppSpacing.sm,
        AppSpacing.md,
        AppSpacing.base,
        AppSpacing.lg,
        AppSpacing.xl,
        AppSpacing.xxl,
        AppSpacing.xxxl,
      ];
      for (int i = 1; i < scale.length; i++) {
        expect(scale[i], greaterThan(scale[i - 1]));
      }
    });
  });

  group('AppRadius — escala 8/12/16/20/pill', () {
    test('valores exactos de la escala', () {
      expect(AppRadius.sm, 8);
      expect(AppRadius.md, 12);
      expect(AppRadius.lg, 16);
      expect(AppRadius.xl, 20);
      expect(AppRadius.pill, 999);
    });

    test('cada *Radius pre-construido coincide con su valor numérico', () {
      expect(AppRadius.smRadius, BorderRadius.circular(AppRadius.sm));
      expect(AppRadius.mdRadius, BorderRadius.circular(AppRadius.md));
      expect(AppRadius.lgRadius, BorderRadius.circular(AppRadius.lg));
      expect(AppRadius.xlRadius, BorderRadius.circular(AppRadius.xl));
      expect(AppRadius.pillRadius, BorderRadius.circular(AppRadius.pill));
    });
  });

  group('AppBorders — 3 niveles (Sección 6)', () {
    test('active es más grueso que neutral, ambos con su color de marca esperado', () {
      expect(AppBorders.neutral.width, lessThan(AppBorders.active.width));
      expect(AppBorders.active.color, DarkTech.brandBlue);
    });

    testWidgets('heroGradientBorder envuelve el child sin lanzar', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AppBorders.heroGradientBorder(
              borderRadius: AppRadius.lgRadius,
              child: const SizedBox(width: 100, height: 100, key: Key('hero-child')),
            ),
          ),
        ),
      );

      expect(find.byKey(const Key('hero-child')), findsOneWidget);
      expect(find.byType(ClipRRect), findsOneWidget);
    });
  });
}
