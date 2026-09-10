import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/features/auth/presentation/widgets/social_sign_in_buttons.dart';

/// KORIXA-WEB-GOOGLE-FIREBASE-POPUP-POC-20260908: `GoogleSignInButton`
/// vuelve a ser el mismo widget en todas las plataformas — ya no existe
/// una rama Web con `renderButton()`/`HtmlElementView` (ver
/// `AuthRemoteDataSourceImpl.signInWithGoogle`, que ahora usa
/// `FirebaseAuth.signInWithPopup` en Web sin necesitar ningún botón
/// oficial incrustado en la página).
///
/// KORIXA-SCREEN02-LOGIN-VISUAL-IMPLEMENTATION-20260907 (reconciliado al
/// integrar main en esta rama): el ícono placeholder `Icons.g_mobiledata`
/// fue reemplazado por el logo oficial de Google
/// (`assets/icons/google_logo.png`, vía `Image.asset`) — estas
/// aserciones se actualizan para reflejar ese asset real en vez del
/// glifo de Material ya retirado (mismo criterio que
/// `login_page_test.dart`'s `GOOGLE_OFFICIAL_LOGO_USED`).
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

      final Image logo = tester.widget<Image>(find.byType(Image));
      expect((logo.image as AssetImage).assetName, 'assets/icons/google_logo.png');

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
      expect(find.byType(Image), findsNothing);

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
