import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/features/auth/presentation/widgets/dark_tech_auth_shell.dart';

/// KORIXA-UI-SCREEN-BATCH-01A (auditoría final, defecto #2): `_AmbientGlow`
/// era un `DecoratedBox` sin `child` como hijo NO posicionado de un
/// `Stack` — sin ancho/alto propios ni restricciones que lo forzaran a
/// crecer, colapsaba a tamaño cero. Se envolvió en `Positioned.fill` para
/// que cubra exactamente el área del `Stack` (el body completo del
/// `Scaffold`). Este test prueba tamaño realmente renderizado (>0 y
/// coincide con el área del shell), no solo que el widget exista en el
/// árbol. Se ubica indirectamente por el `Positioned` que lo envuelve,
/// ya que `_AmbientGlow` es privada a `dark_tech_auth_shell.dart`.
void main() {
  group('DarkTechAuthShell — resplandor ambiental', () {
    testWidgets('showAmbientGlow=true: el resplandor tiene tamaño no-cero y cubre el body del shell',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: DarkTechAuthShell(
            showAmbientGlow: true,
            builder: (BuildContext context) => const SizedBox(width: 10, height: 10),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // `Positioned` es el marcador estructural que envuelve a
      // `_AmbientGlow` (privada, no referenciable desde este archivo) —
      // el shell solo lo usa para esto, y `SingleChildScrollView`/
      // `IgnorePointer` internos de Flutter (usados por el scroll) NO son
      // `Positioned`, así que ubicarlo por tipo es inequívoco acá.
      final Size glowSize = tester.getSize(find.byType(Positioned));
      final Size scaffoldSize = tester.getSize(find.byType(Scaffold));

      expect(glowSize.width, greaterThan(0));
      expect(glowSize.height, greaterThan(0));
      expect(glowSize, scaffoldSize);
    });

    testWidgets('showAmbientGlow=false: no se agrega ninguna capa de resplandor', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: DarkTechAuthShell(
            builder: (BuildContext context) => const SizedBox(width: 10, height: 10),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(Positioned), findsNothing);
    });
  });
}
