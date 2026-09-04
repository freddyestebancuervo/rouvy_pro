import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/features/auth/presentation/pages/welcome_page.dart';

import 'auth_page_test_utils.dart';

void main() {
  Future<void> pumpWelcomePage(WidgetTester tester, {Size surfaceSize = const Size(800, 1200)}) async {
    tester.view.physicalSize = surfaceSize;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      authPageHarness(initialLocation: '/welcome', welcomePage: const WelcomePage()),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('Crear cuenta navega a Register', (WidgetTester tester) async {
    await pumpWelcomePage(tester);

    await tester.tap(find.text('Crear cuenta'));
    await tester.pumpAndSettle();

    expect(find.text('REGISTER'), findsOneWidget);
  });

  testWidgets('Ya tengo cuenta navega a Login', (WidgetTester tester) async {
    await pumpWelcomePage(tester);

    await tester.tap(find.text('Ya tengo cuenta'));
    await tester.pumpAndSettle();

    expect(find.text('LOGIN'), findsOneWidget);
  });

  testWidgets('sin overflow en un tamaño de pantalla chico representativo', (WidgetTester tester) async {
    // iPhone SE-ish: uno de los viewports más chicos que la app soporta
    // hoy — si el layout se desborda, `flutter_test` lo reporta como una
    // excepción de renderizado (no como un simple fallo de `expect`).
    await pumpWelcomePage(tester, surfaceSize: const Size(320, 568));

    expect(tester.takeException(), isNull);
  });
}
