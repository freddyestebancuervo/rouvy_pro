import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/features/auth/presentation/widgets/social_sign_in_buttons.dart';

/// KORIXA-WEB-GOOGLE-FIREBASE-POPUP-POC-20260908: `GoogleSignInButton`
/// vuelve a ser el mismo widget en todas las plataformas — ya no existe
/// una rama Web con `renderButton()`/`HtmlElementView` (ver
/// `AuthRemoteDataSourceImpl.signInWithGoogle`, que ahora usa
/// `FirebaseAuth.signInWithPopup` en Web sin necesitar ningún botón
/// oficial incrustado en la página).
void main() {
  Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

  group('GoogleSignInButton', () {
    testWidgets('dispara onPressed al tocarlo', (WidgetTester tester) async {
      bool pressed = false;
      await tester.pumpWidget(
        wrap(
          GoogleSignInButton(
            label: 'Continuar con Google',
            onPressed: () => pressed = true,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.g_mobiledata), findsOneWidget);

      await tester.tap(find.byType(GoogleSignInButton));
      expect(pressed, isTrue);
    });

    testWidgets('muestra el spinner mientras isLoading y deshabilita el tap',
        (WidgetTester tester) async {
      bool pressed = false;
      await tester.pumpWidget(
        wrap(
          GoogleSignInButton(
            label: 'Continuar con Google',
            onPressed: () => pressed = true,
            isLoading: true,
          ),
        ),
      );
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byIcon(Icons.g_mobiledata), findsNothing);

      await tester.tap(find.byType(GoogleSignInButton));
      expect(pressed, isFalse, reason: 'debe estar deshabilitado mientras carga');
    });

    testWidgets('no dispara onPressed cuando es null (deshabilitado)', (WidgetTester tester) async {
      await tester.pumpWidget(
        wrap(
          const GoogleSignInButton(label: 'Continuar con Google', onPressed: null),
        ),
      );
      await tester.pumpAndSettle();

      // `OutlinedButton.icon(...)` construye internamente una subclase
      // privada del framework (`_OutlinedButtonWithIcon`), así que
      // `find.byType(OutlinedButton)` (comparación por tipo EXACTO) no la
      // encuentra — se usa `byWidgetPredicate` con `is`, que sí respeta
      // la jerarquía de tipos.
      final OutlinedButton button =
          tester.widget<OutlinedButton>(find.byWidgetPredicate((Widget w) => w is OutlinedButton));
      expect(button.onPressed, isNull);
    });
  });
}
