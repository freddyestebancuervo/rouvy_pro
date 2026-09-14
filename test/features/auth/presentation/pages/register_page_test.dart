import 'package:dartz/dartz.dart';
import 'package:flutter/foundation.dart' show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/register_usecase.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/sign_in_with_apple_usecase.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/sign_in_with_google_usecase.dart';
import 'package:rouvy_pro/features/auth/presentation/pages/register_page.dart';
import 'package:rouvy_pro/features/auth/presentation/providers/auth_providers.dart';
import 'package:rouvy_pro/features/auth/presentation/widgets/social_sign_in_buttons.dart';

import 'auth_page_test_utils.dart';

void main() {
  late MockAuthRepository repository;

  setUp(() {
    repository = MockAuthRepository();
  });

  List<Override> overridesFor(MockAuthRepository repo) => <Override>[
        registerUseCaseProvider.overrideWithValue(RegisterUseCase(repo)),
        signInWithGoogleUseCaseProvider.overrideWithValue(SignInWithGoogleUseCase(repo)),
        signInWithAppleUseCaseProvider.overrideWithValue(SignInWithAppleUseCase(repo)),
      ];

  // KORIXA-SCREEN03-WEB-CLEAN-BRANCH-REAPPLICATION-20260913: `surfaceSize`
  // opcional — `null` preserva el tamaño de superficie por defecto del
  // binding de test (800x600), que `KorixaViewportInfo.canFitWideLayout()`
  // clasifica como ancho y por lo tanto ejercita `_buildDesktopWeb`. Los
  // tests WEB_* de abajo pasan tamaños desktop explícitos; el test de
  // phone landscape pasa un tamaño angosto-en-alto explícito.
  Future<void> pumpRegisterPage(WidgetTester tester, MockAuthRepository repo, {Size? surfaceSize}) async {
    if (surfaceSize != null) {
      tester.view.physicalSize = surfaceSize;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
    }
    await tester.pumpWidget(
      authPageHarness(
        initialLocation: '/register',
        registerPage: const RegisterPage(),
        overrides: overridesFor(repo),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> fillForm(
    WidgetTester tester, {
    String name = 'Rider Demo',
    String email = 'rider@ridepro.com',
    String password = 'securePass123',
    String confirmPassword = 'securePass123',
  }) async {
    final Finder fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), name);
    await tester.enterText(fields.at(1), email);
    await tester.enterText(fields.at(2), password);
    await tester.enterText(fields.at(3), confirmPassword);
  }

  testWidgets('no envía el formulario si los campos están vacíos', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository);

    // KORIXA-SCREEN03-WEB-FINAL-LEFT-COMPOSITION-AND-LOGO-20260914: el
    // logo agregado encima del título empuja el CTA un poco más abajo en
    // el viewport de prueba por defecto (800x600) — mismo patrón ya
    // usado en las demás pruebas de esta composición.
    await tester.ensureVisible(find.text('Registrarme'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Registrarme'));
    await tester.pumpAndSettle();

    expect(find.text('Ingresa tu nombre'), findsOneWidget);
    expect(find.text('Ingresa tu correo electrónico'), findsOneWidget);
    verifyNever(
      () => repository.register(
        email: any(named: 'email'),
        password: any(named: 'password'),
        displayName: any(named: 'displayName'),
      ),
    );
  });

  testWidgets('muestra el error de contraseñas no coincidentes sin llamar al repositorio',
      (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository);

    await fillForm(tester, confirmPassword: 'otraClave123');
    await tester.ensureVisible(find.text('Registrarme'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Registrarme'));
    await tester.pumpAndSettle();

    expect(find.text('Las contraseñas no coinciden'), findsOneWidget);
    verifyNever(
      () => repository.register(
        email: any(named: 'email'),
        password: any(named: 'password'),
        displayName: any(named: 'displayName'),
      ),
    );
  });

  testWidgets('muestra un spinner mientras el registro está en curso', (WidgetTester tester) async {
    when(
      () => repository.register(
        email: any(named: 'email'),
        password: any(named: 'password'),
        displayName: any(named: 'displayName'),
      ),
    ).thenAnswer((_) async {
      await Future<void>.delayed(const Duration(milliseconds: 200));
      return const Right(tUser);
    });

    await pumpRegisterPage(tester, repository);
    await fillForm(tester);
    // KORIXA-SCREEN03-WEB-CLEAN-BRANCH-REAPPLICATION-20260913: el viewport
    // de prueba por defecto (800x600) ejercita la composición desktop web
    // nueva, cuyo panel de legibilidad agrega algo más de alto que el
    // shell anterior — mismo patrón ya usado más abajo para "Inicia
    // sesión"/Google.
    await tester.ensureVisible(find.text('Registrarme'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Registrarme'));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpAndSettle();
  });

  testWidgets('navega a la pantalla de verificación de correo cuando el registro es exitoso',
      (WidgetTester tester) async {
    when(
      () => repository.register(
        email: 'rider@ridepro.com',
        password: 'securePass123',
        displayName: 'Rider Demo',
      ),
    ).thenAnswer((_) async => const Right(tUser));

    await pumpRegisterPage(tester, repository);
    await fillForm(tester);
    await tester.ensureVisible(find.text('Registrarme'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Registrarme'));
    await tester.pumpAndSettle();

    expect(find.text('EMAIL_VERIFICATION'), findsOneWidget);
  });

  testWidgets('el toggle de visibilidad de contraseña mantiene su semántica', (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();

    await pumpRegisterPage(tester, repository);

    final Finder passwordEditable =
        find.descendant(of: find.byType(TextFormField).at(2), matching: find.byType(EditableText));
    expect(tester.widget<EditableText>(passwordEditable).obscureText, isTrue);

    // Se ubica el nodo por una `Key` estable (no por `Semantics.label`):
    // el label final puede fusionarse con la semántica interna de
    // `IconButton` de forma distinta según la versión de Flutter — ver
    // nota equivalente en login_page_test.dart.
    const Key toggleKey = Key('register-password-visibility-semantics');
    // ignore: deprecated_member_use
    expect(tester.getSemantics(find.byKey(toggleKey)).hasFlag(SemanticsFlag.isToggled), isFalse);

    await tester.tap(find.byType(IconButton));
    await tester.pumpAndSettle();

    expect(tester.widget<EditableText>(passwordEditable).obscureText, isFalse);
    // ignore: deprecated_member_use
    expect(tester.getSemantics(find.byKey(toggleKey)).hasFlag(SemanticsFlag.isToggled), isTrue);

    handle.dispose();
  });

  testWidgets('Iniciar sesión (link) sigue navegando a Login', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository);

    // El formulario de Register es más largo que el viewport de prueba por
    // defecto — el link vive dentro del `SingleChildScrollView` del shell,
    // hay que desplazarlo a la vista antes de tocarlo.
    await tester.ensureVisible(find.text('Inicia sesión'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Inicia sesión'));
    await tester.pumpAndSettle();

    expect(find.text('LOGIN'), findsOneWidget);
  });

  testWidgets('390x844_NO_OVERFLOW = PASS', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await pumpRegisterPage(tester, repository);

    expect(tester.takeException(), isNull);
    expect(find.text('Inicia sesión'), findsOneWidget);
  });

  testWidgets('el botón de Apple solo aparece en la plataforma Apple soportada', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository);
    expect(find.byType(AppleSignInButton), findsNothing);

    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await pumpRegisterPage(tester, repository);
    expect(find.byType(AppleSignInButton), findsOneWidget);

    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('el botón de Google Sign-In navega a Home cuando el proveedor social tiene éxito',
      (WidgetTester tester) async {
    when(() => repository.signInWithGoogle()).thenAnswer((_) async => const Right(tUser));

    await pumpRegisterPage(tester, repository);
    await tester.ensureVisible(find.byType(GoogleSignInButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(GoogleSignInButton));
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('muestra un SnackBar con el mensaje de error cuando el registro falla',
      (WidgetTester tester) async {
    const AuthFailure failure = AuthFailure('Este correo ya está registrado.');
    when(
      () => repository.register(
        email: any(named: 'email'),
        password: any(named: 'password'),
        displayName: any(named: 'displayName'),
      ),
    ).thenAnswer((_) async => const Left(failure));

    await pumpRegisterPage(tester, repository);
    await fillForm(tester);
    await tester.ensureVisible(find.text('Registrarme'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Registrarme'));
    await tester.pumpAndSettle();

    expect(find.text('Este correo ya está registrado.'), findsOneWidget);
    expect(find.text('EMAIL_VERIFICATION'), findsNothing);
  });

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN03-WEB-CLEAN-BRANCH-REAPPLICATION-20260913: esta rama NO
  // contiene la composición mobile-portrait (pertenece a otra rama, sin
  // mergear a `origin/main` al momento de esta reaplicación). Portrait y
  // phone landscape siguen exactamente el comportamiento original de
  // `origin/main` (`_buildLegacyShell`, sin cambios) — verificado
  // explícitamente abajo. Solo desktop web (`canFitWideLayout()`) recibe
  // el nuevo hero fotográfico (Santuario de Las Lajas) con
  // `BoxFit.contain` — foto COMPLETA, sin crop/zoom.
  // ---------------------------------------------------------------------

  const List<Size> desktopWebSizes = <Size>[
    Size(1280, 720),
    Size(1366, 768),
    Size(1440, 900),
    Size(1536, 864),
    Size(1920, 1080),
    Size(2560, 1440),
  ];

  for (final Size size in desktopWebSizes) {
    final String label = '${size.width.toInt()}x${size.height.toInt()}';
    testWidgets('WEB_${label}_NO_OVERFLOW = PASS', (WidgetTester tester) async {
      await pumpRegisterPage(tester, repository, surfaceSize: size);

      expect(tester.takeException(), isNull, reason: 'WEB_${label}_NO_OVERFLOW: no debe haber overflow');
      expect(
        find.byKey(const Key('register-desktop-layout')),
        findsOneWidget,
        reason: 'WEB_${label}_NO_OVERFLOW: debe usar la composición desktop web nueva',
      );
      expect(find.text('Registrarme'), findsOneWidget, reason: 'el formulario debe seguir siendo usable');
    });
  }

  testWidgets('WEB_HERO_IMAGE_CORRECT_ASSET_AND_FIT = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final Iterable<Image> images = tester.widgetList<Image>(
      find.descendant(of: find.byKey(const Key('register-desktop-hero-image')), matching: find.byType(Image)),
    );
    expect(images.length, 1);
    final Image hero = images.first;
    expect(
      (hero.image as AssetImage).assetName,
      'assets/images/korixa_register_hero_laslajas_web.png',
      reason: 'WEB_HERO_IMAGE_CORRECT_ASSET_AND_FIT: debe usar el asset aprobado exacto',
    );
    expect(
      hero.fit,
      BoxFit.contain,
      reason: 'WEB_HERO_IMAGE_CORRECT_ASSET_AND_FIT: BoxFit.contain — la foto completa siempre visible, nunca cover/crop',
    );
    expect(hero.fit, isNot(BoxFit.cover), reason: 'ausencia explícita de BoxFit.cover en este asset');
    expect(hero.alignment, Alignment.center, reason: 'sin ajuste de encuadre artificial');
  });

  testWidgets('WEB_HERO_NO_TRANSFORM_SCALE_ANCESTOR = PASS', (WidgetTester tester) async {
    // Ausencia estructural de cualquier `Transform` como ancestro directo
    // del hero — el `find.ancestor` no encuentra ninguno, confirmando que
    // no hay zoom artificial aplicado al asset.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final Finder transformAncestors = find.ancestor(
      of: find.byKey(const Key('register-desktop-hero-image')),
      matching: find.byType(Transform),
    );
    expect(transformAncestors, findsNothing, reason: 'WEB_HERO_NO_TRANSFORM_SCALE_ANCESTOR: cero mecanismos de zoom');
  });

  testWidgets('WEB_NO_OUTER_FORM_CARD = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN03-WEB-UI-COMPOSITION-REFINEMENT-20260914: el dueño
    // pidió explícitamente eliminar la gran card/panel oscuro que
    // envolvía todo el formulario (ronda anterior usaba una
    // `DecoratedBox` con `color`+`borderRadius` como ancestro directo del
    // contenido) — ya no debe existir ningún `DecoratedBox`/`Container`
    // con relleno opaco entre el hero y los campos del formulario. No es
    // un test frágil de píxeles: solo confirma la AUSENCIA estructural de
    // esa card, no una medida exacta.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final Finder decoratedAncestors = find.ancestor(
      of: find.byType(TextFormField).first,
      matching: find.byType(DecoratedBox),
    );
    final Iterable<DecoratedBox> opaqueDecoratedAncestors = tester
        .widgetList<DecoratedBox>(decoratedAncestors)
        .where((DecoratedBox box) {
      final Decoration decoration = box.decoration;
      if (decoration is! BoxDecoration) return false;
      final Color? color = decoration.color;
      return color != null && color.a > 0.15;
    });
    expect(
      opaqueDecoratedAncestors,
      isEmpty,
      reason: 'WEB_NO_OUTER_FORM_CARD: el formulario no debe vivir dentro de ninguna card/panel opaco',
    );
  });

  testWidgets('WEB_NO_GLOBAL_SCRIM_BORDER_RADIUS = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN03-WEB-FINAL-LEFT-COMPOSITION-AND-LOGO-20260914: el
    // degradado de contraste (`register-desktop-hero-scrim`) debe ser un
    // velo que se funde con la foto, nunca una forma rectangular con
    // esquinas redondeadas/borde propio — confirma que su `BoxDecoration`
    // no tiene `borderRadius` ni `border`. Mismo test que la ronda
    // anterior (antes `WEB_NO_BORDER_RADIUS_ON_GLOBAL_SCRIM`), renombrado
    // para calzar con el nombre pedido explícitamente en esta tarea.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final DecoratedBox scrim = tester.widget<DecoratedBox>(
      find.descendant(of: find.byKey(const Key('register-desktop-hero-scrim')), matching: find.byType(DecoratedBox)),
    );
    final Decoration decoration = scrim.decoration;
    expect(decoration, isA<BoxDecoration>());
    final BoxDecoration boxDecoration = decoration as BoxDecoration;
    expect(
      boxDecoration.borderRadius,
      isNull,
      reason: 'WEB_NO_GLOBAL_SCRIM_BORDER_RADIUS: sin esquinas redondeadas, no debe leerse como card',
    );
    expect(
      boxDecoration.border,
      isNull,
      reason: 'WEB_NO_GLOBAL_SCRIM_BORDER_RADIUS: sin borde propio, no debe leerse como card',
    );
  });

  testWidgets('WEB_LEFT_EDGE_GRADIENT_ONLY = PASS', (WidgetTester tester) async {
    // El degradado debe nacer en el borde IZQUIERDO y desvanecerse a
    // transparente — confirma la dirección exacta del `LinearGradient`
    // (KORIXA-SCREEN03-WEB-FINAL-LEFT-COMPOSITION-AND-LOGO-20260914
    // invirtió la dirección que tenía la ronda anterior).
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final DecoratedBox scrim = tester.widget<DecoratedBox>(
      find.descendant(of: find.byKey(const Key('register-desktop-hero-scrim')), matching: find.byType(DecoratedBox)),
    );
    final BoxDecoration boxDecoration = scrim.decoration as BoxDecoration;
    final LinearGradient gradient = boxDecoration.gradient! as LinearGradient;
    expect(gradient.begin, Alignment.centerLeft, reason: 'WEB_LEFT_EDGE_GRADIENT_ONLY: debe nacer en el borde izquierdo');
    expect(gradient.end, Alignment.centerRight);
    expect(gradient.colors.last, Colors.transparent, reason: 'debe desvanecerse a transparente antes del centro');
  });

  testWidgets('WEB_FORM_POSITION_LEFT = PASS', (WidgetTester tester) async {
    // El bloque de contenido (logo + título..footer) debe estar alineado
    // al tercio izquierdo del viewport, no centrado ni a la derecha —
    // verificado por la posición del `ConstrainedBox` que envuelve el
    // contenido (antes `WEB_FORM_POSITION_RIGHT`, invertido en esta
    // ronda por pedido explícito del owner).
    const Size size = Size(1440, 900);
    await pumpRegisterPage(tester, repository, surfaceSize: size);

    final Rect contentRect = tester.getRect(find.byKey(const Key('register-desktop-content-max-width')));
    expect(
      contentRect.left,
      lessThan(size.width * 0.45),
      reason: 'WEB_FORM_POSITION_LEFT: el borde izquierdo del bloque debe estar cerca del borde izquierdo del viewport',
    );
    expect(
      contentRect.right,
      lessThan(size.width * 0.6),
      reason: 'WEB_FORM_POSITION_LEFT: el bloque no debe extenderse hacia el centro/derecha del viewport',
    );
  });

  testWidgets('WEB_KORIXA_LOGO_PRESENT = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN03-WEB-FINAL-LEFT-COMPOSITION-AND-LOGO-20260914: el
    // logo oficial (mismo asset que Welcome/Login desktop, sin generar ni
    // modificar ninguno nuevo) debe estar presente, por encima del
    // título, y con el mismo `BoxFit.contain` que preserva su aspect
    // ratio (sin deformarlo).
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final Finder logoFinder = find.byKey(const Key('register-desktop-logo'));
    expect(logoFinder, findsOneWidget, reason: 'WEB_KORIXA_LOGO_PRESENT: el logo debe estar presente en desktop');

    final Image logo = tester.widget<Image>(logoFinder);
    // `cacheHeight` envuelve el `AssetImage` en un `ResizeImage` (mismo
    // patrón ya usado por `LoginPage._buildFormColumn` con
    // `highQualityLogo`) — el asset real está un nivel más adentro.
    final AssetImage logoProvider = (logo.image as ResizeImage).imageProvider as AssetImage;
    expect(
      logoProvider.assetName,
      'assets/icons/korixa_logo_desktop.png',
      reason: 'WEB_KORIXA_LOGO_PRESENT: debe ser el mismo logo oficial aprobado ya usado por Welcome/Login',
    );
    expect(logo.fit, BoxFit.contain, reason: 'sin deformar el aspect ratio original');

    final double logoTop = tester.getTopLeft(logoFinder).dy;
    final double titleTop = tester.getTopLeft(find.byKey(const Key('register-title'))).dy;
    expect(logoTop, lessThan(titleTop), reason: 'WEB_KORIXA_LOGO_PRESENT: el logo debe quedar por encima del título');
  });

  testWidgets('WEB_PHONE_LANDSCAPE_KEEPS_LEGACY_ORIGIN_MAIN_BEHAVIOR = PASS', (WidgetTester tester) async {
    // Landscape angosto (mismo criterio que Login phone landscape: ancho
    // suficiente pero alto corto) — debe seguir usando exactamente
    // `DarkTechAuthShell` (comportamiento original de `origin/main`), sin
    // el hero nuevo ni la composición desktop.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(932, 430));

    expect(tester.takeException(), isNull);
    expect(
      find.byKey(const Key('register-desktop-layout')),
      findsNothing,
      reason: 'phone landscape NO debe usar la composición desktop nueva',
    );
    expect(find.text('Registrarme'), findsOneWidget);
  });

  testWidgets('PORTRAIT_KEEPS_LEGACY_ORIGIN_MAIN_BEHAVIOR = PASS', (WidgetTester tester) async {
    // Esta rama no incluye ninguna composición mobile-portrait dedicada —
    // portrait cae exactamente en el mismo `DarkTechAuthShell` original
    // que phone landscape, sin cambios respecto a `origin/main`.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    expect(tester.takeException(), isNull);
    expect(
      find.byKey(const Key('register-desktop-layout')),
      findsNothing,
      reason: 'portrait NO debe usar la composición desktop nueva en esta rama',
    );
    expect(find.text('Registrarme'), findsOneWidget);
  });

  testWidgets('WEB_DESKTOP_no envía el formulario si los campos están vacíos', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    await tester.tap(find.text('Registrarme'));
    await tester.pumpAndSettle();

    expect(find.text('Ingresa tu nombre'), findsOneWidget);
    expect(find.text('Ingresa tu correo electrónico'), findsOneWidget);
    verifyNever(
      () => repository.register(
        email: any(named: 'email'),
        password: any(named: 'password'),
        displayName: any(named: 'displayName'),
      ),
    );
  });

  testWidgets('WEB_DESKTOP_navega a EMAIL_VERIFICATION cuando el registro es exitoso', (WidgetTester tester) async {
    when(
      () => repository.register(
        email: 'rider@ridepro.com',
        password: 'securePass123',
        displayName: 'Rider Demo',
      ),
    ).thenAnswer((_) async => const Right(tUser));

    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));
    await fillForm(tester);
    await tester.tap(find.text('Registrarme'));
    await tester.pumpAndSettle();

    expect(find.text('EMAIL_VERIFICATION'), findsOneWidget);
  });

  testWidgets('WEB_DESKTOP_Google Sign-In navega a Home cuando el proveedor social tiene éxito',
      (WidgetTester tester) async {
    when(() => repository.signInWithGoogle()).thenAnswer((_) async => const Right(tUser));

    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));
    await tester.ensureVisible(find.byType(GoogleSignInButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(GoogleSignInButton));
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('WEB_DESKTOP_Iniciar sesión (link) navega a Login', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    await tester.ensureVisible(find.text('Inicia sesión'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Inicia sesión'));
    await tester.pumpAndSettle();

    expect(find.text('LOGIN'), findsOneWidget);
  });
}
