import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/app/theme/app_colors.dart';
import 'package:rouvy_pro/app/theme/app_gradients.dart';
import 'package:rouvy_pro/core/design_system/dark_tech_buttons.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: Center(child: child)));

BoxDecoration _decorationOf(WidgetTester tester) {
  final Ink ink = tester.widget<Ink>(find.byType(Ink));
  return ink.decoration! as BoxDecoration;
}

void main() {
  group('PrimaryGradientButton — estados (Sección 10)', () {
    testWidgets('normal: usa AppGradients.primaryCta y responde al tap', (WidgetTester tester) async {
      bool tapped = false;
      await tester.pumpWidget(
        _wrap(PrimaryGradientButton(label: 'Continuar', onPressed: () => tapped = true)),
      );

      expect(_decorationOf(tester).gradient, AppGradients.primaryCta);

      await tester.tap(find.byType(PrimaryGradientButton));
      await tester.pump();
      expect(tapped, isTrue);
    });

    testWidgets('deshabilitado: sin gradiente, superficie sólida disabledSurface, no responde al tap', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _wrap(const PrimaryGradientButton(label: 'Continuar', onPressed: null)),
      );

      final BoxDecoration decoration = _decorationOf(tester);
      expect(decoration.gradient, isNull);
      expect(decoration.color, DarkTech.disabledSurface);

      // onTap null -> InkWell no debe lanzar al tocar.
      await tester.tap(find.byType(PrimaryGradientButton));
      await tester.pump();
    });

    testWidgets('cargando: muestra spinner en vez de la etiqueta y no responde al tap', (WidgetTester tester) async {
      bool tapped = false;
      await tester.pumpWidget(
        _wrap(PrimaryGradientButton(label: 'Continuar', isLoading: true, onPressed: () => tapped = true)),
      );

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Continuar'), findsNothing);

      await tester.tap(find.byType(PrimaryGradientButton));
      await tester.pump();
      expect(tapped, isFalse);
    });

    testWidgets('accesibilidad: expone Semantics de botón con la etiqueta', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await tester.pumpWidget(_wrap(PrimaryGradientButton(label: 'Crear cuenta', onPressed: () {})));

      final SemanticsNode node = tester.getSemantics(find.byType(PrimaryGradientButton));
      // `hasFlag` es la API compatible con el Flutter 3.32.0 fijado en CI
      // (.github/workflows/ci.yml) — `flagsCollection` (su reemplazo) no
      // existe todavía en esa versión. El SDK local puede marcar `hasFlag`
      // como obsoleto; se ignora deliberadamente acá por esa razón.
      // ignore: deprecated_member_use
      expect(node.hasFlag(SemanticsFlag.isButton), isTrue);
      expect(node.label, contains('Crear cuenta'));

      handle.dispose();
    });
  });
}
