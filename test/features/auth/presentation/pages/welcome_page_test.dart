import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/app/theme/app_colors.dart';
import 'package:rouvy_pro/core/design_system/dark_tech_buttons.dart';
import 'package:rouvy_pro/features/auth/presentation/pages/welcome_page.dart';

import 'auth_page_test_utils.dart';

/// KORIXA-UI-SCREEN-01-APPROVED-WELCOME-IMPLEMENTATION-20260904 — Sección 10.
void main() {
  Future<void> pumpWelcomePage(
    WidgetTester tester, {
    Size surfaceSize = const Size(390, 844),
    ThemeData? theme,
  }) async {
    tester.view.physicalSize = surfaceSize;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      authPageHarness(initialLocation: '/welcome', welcomePage: const WelcomePage(), theme: theme),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('WELCOME_TITLE_APPROVED_COPY = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester);
    expect(find.text('Conecta tu energía.'), findsOneWidget);
  });

  testWidgets('WELCOME_SUBTITLE_APPROVED_COPY = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester);
    expect(find.text('Entrena, compite y vive rutas increíbles en indoor y outdoor.'), findsOneWidget);
  });

  testWidgets('PRIMARY_CTA_LABEL = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester);
    expect(find.text('Comenzar'), findsOneWidget);
    expect(find.byType(PrimaryGradientButton), findsOneWidget);
  });

  testWidgets('SKIP_ACTION_PRESENT = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester);
    expect(find.text('Saltar'), findsOneWidget);
  });

  testWidgets('CTA_NAVIGATION = PASS (Comenzar -> Register, mismo destino que el CTA anterior)',
      (WidgetTester tester) async {
    await pumpWelcomePage(tester);

    await tester.tap(find.text('Comenzar'));
    await tester.pumpAndSettle();

    expect(find.text('REGISTER'), findsOneWidget);
  });

  testWidgets('SKIP_NAVIGATION = PASS (Saltar -> Login, mismo destino que el botón secundario anterior)',
      (WidgetTester tester) async {
    await pumpWelcomePage(tester);

    await tester.tap(find.text('Saltar'));
    await tester.pumpAndSettle();

    expect(find.text('LOGIN'), findsOneWidget);
  });

  testWidgets('MOBILE_NO_OVERFLOW_390x844 = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(390, 844));
    expect(tester.takeException(), isNull);
  });

  testWidgets('SMALL_MOBILE_NO_OVERFLOW = PASS', (WidgetTester tester) async {
    // iPhone SE-ish: uno de los viewports más chicos que la app soporta
    // hoy — si el layout se desborda, `flutter_test` lo reporta como una
    // excepción de renderizado (no como un simple fallo de `expect`).
    await pumpWelcomePage(tester, surfaceSize: const Size(320, 568));
    expect(tester.takeException(), isNull);
  });

  testWidgets('DESKTOP_LAYOUT_NO_TINY_CENTERED_COLUMN = PASS', (WidgetTester tester) async {
    const Size desktopSize = Size(1440, 900);
    await pumpWelcomePage(tester, surfaceSize: desktopSize);
    expect(tester.takeException(), isNull);

    // El hero (`ExcludeSemantics` envolviendo `_HeroPlaceholder`) debe
    // llenar el viewport COMPLETO en desktop — `Stack(fit: StackFit.expand)`
    // lo garantiza estructuralmente; este test lo prueba contra el tamaño
    // realmente renderizado, no solo contra el código fuente.
    final Size heroSize = tester.getSize(find.byKey(const Key('welcome-hero-placeholder')));
    expect(heroSize, desktopSize);

    // El bloque de texto/CTA sí debe quedar acotado (no estirado a los
    // 1440px completos) — "contenido acotado pero visualmente
    // sustancial", no una columna diminuta en un vacío negro, pero
    // tampoco un formulario de ancho completo.
    final Size contentSize = tester.getSize(find.byKey(const Key('welcome-content-max-width')));
    expect(contentSize.width, lessThanOrEqualTo(480));
    expect(contentSize.width, greaterThan(300));
  });

  testWidgets('OUTER_LIGHT_THEME_DOES_NOT_BREAK_DARK_TECH = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, theme: ThemeData.light());

    final Text title = tester.widget<Text>(find.text('Conecta tu energía.'));
    expect(title.style?.color, DarkTech.textPrimary);
  });
}
