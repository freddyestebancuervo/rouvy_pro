import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/app/theme/app_colors.dart';
import 'package:rouvy_pro/app/theme/app_gradients.dart';
import 'package:rouvy_pro/core/design_system/dark_tech_buttons.dart';
import 'package:rouvy_pro/core/utils/color_contrast.dart';
import 'package:rouvy_pro/features/auth/presentation/pages/login_page.dart';
import 'package:rouvy_pro/features/auth/presentation/pages/register_page.dart';
import 'package:rouvy_pro/features/auth/presentation/pages/welcome_page.dart';

import 'auth_page_test_utils.dart';

/// KORIXA-UI-SCREEN-BATCH-01 — Sección 21 "VISUAL FOUNDATION": prueba que
/// las 3 pantallas migradas realmente usan los tokens Dark Tech en vez de
/// reintroducir un color/gradiente ad hoc, y que no resucitan el defecto
/// de accesibilidad corregido en PR #121 (texto interactivo en
/// `brandPurple` sobre superficies oscuras).
void main() {
  group('fondo Dark Tech en las 3 pantallas', () {
    testWidgets('Welcome usa DarkTech.background', (WidgetTester tester) async {
      await tester.pumpWidget(authPageHarness(initialLocation: '/welcome', welcomePage: const WelcomePage()));
      await tester.pumpAndSettle();
      expect(tester.widget<Scaffold>(find.byType(Scaffold).first).backgroundColor, DarkTech.background);
    });

    testWidgets('Login usa DarkTech.background', (WidgetTester tester) async {
      await tester.pumpWidget(authPageHarness(initialLocation: '/login', loginPage: const LoginPage()));
      await tester.pumpAndSettle();
      expect(tester.widget<Scaffold>(find.byType(Scaffold).first).backgroundColor, DarkTech.background);
    });

    testWidgets('Register usa DarkTech.background', (WidgetTester tester) async {
      await tester.pumpWidget(authPageHarness(initialLocation: '/register', registerPage: const RegisterPage()));
      await tester.pumpAndSettle();
      expect(tester.widget<Scaffold>(find.byType(Scaffold).first).backgroundColor, DarkTech.background);
    });
  });

  group('CTA primario usa PrimaryGradientButton/primaryCta', () {
    testWidgets('Welcome', (WidgetTester tester) async {
      await tester.pumpWidget(authPageHarness(initialLocation: '/welcome', welcomePage: const WelcomePage()));
      await tester.pumpAndSettle();
      expect(find.byType(PrimaryGradientButton), findsOneWidget);
    });

    testWidgets('Login', (WidgetTester tester) async {
      await tester.pumpWidget(authPageHarness(initialLocation: '/login', loginPage: const LoginPage()));
      await tester.pumpAndSettle();
      expect(find.byType(PrimaryGradientButton), findsOneWidget);
    });

    testWidgets('Register', (WidgetTester tester) async {
      await tester.pumpWidget(authPageHarness(initialLocation: '/register', registerPage: const RegisterPage()));
      await tester.pumpAndSettle();
      expect(find.byType(PrimaryGradientButton), findsOneWidget);
    });

    test('AppGradients.primaryCta (no primary) es el único gradiente que puede sostener texto blanco', () {
      for (final Color stop in AppGradients.primaryCta.colors) {
        expect(ColorContrast.meetsAaNormalText(Colors.white, stop), isTrue);
      }
    });
  });

  group('texto interactivo (links) — no debe resucitar el par brandPurple-sobre-oscuro (defecto PR #121)', () {
    Color? textButtonForeground(WidgetTester tester, Finder buttonFinder) {
      final Theme theme = tester.element(buttonFinder).findAncestorWidgetOfExactType<Theme>()!;
      return theme.data.textButtonTheme.style?.foregroundColor?.resolve(<WidgetState>{});
    }

    testWidgets('"Olvidé mi contraseña" en Login no usa brandPurple y cumple AA', (WidgetTester tester) async {
      await tester.pumpWidget(authPageHarness(initialLocation: '/login', loginPage: const LoginPage()));
      await tester.pumpAndSettle();

      final Color? foreground = textButtonForeground(tester, find.text('¿Olvidaste tu contraseña?'));
      expect(foreground, isNot(DarkTech.brandPurple));
      expect(ColorContrast.meetsAaNormalText(foreground!, DarkTech.surfaceElevated), isTrue);
    });

    testWidgets('"Inicia sesión" en Register no usa brandPurple y cumple AA', (WidgetTester tester) async {
      await tester.pumpWidget(authPageHarness(initialLocation: '/register', registerPage: const RegisterPage()));
      await tester.pumpAndSettle();

      final Color? foreground = textButtonForeground(tester, find.text('Inicia sesión'));
      expect(foreground, isNot(DarkTech.brandPurple));
      expect(ColorContrast.meetsAaNormalText(foreground!, DarkTech.surfaceElevated), isTrue);
    });
  });

  group('sin residuos del rojo/naranja legado (AppColors.primary) en las 3 pantallas migradas', () {
    for (final String path in <String>[
      'lib/features/auth/presentation/pages/welcome_page.dart',
      'lib/features/auth/presentation/pages/login_page.dart',
      'lib/features/auth/presentation/pages/register_page.dart',
    ]) {
      test(path, () {
        final String source = File(path).readAsStringSync();
        expect(source, isNot(contains('AppColors.primary')));
        expect(source, isNot(contains('AppColors.secondary')));
      });
    }
  });
}
