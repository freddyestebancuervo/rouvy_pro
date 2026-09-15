import 'package:dartz/dartz.dart';
import 'package:flutter/foundation.dart' show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/design_system/dark_tech_buttons.dart';
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

    // KORIXA-SCREEN03-WEB-MATCH-SCREEN02-DESKTOP-UI-SCALE-20260914: el
    // bloque desktop creció (logo 188px + tipografía a escala SCREEN_02)
    // — el toggle queda fuera del viewport de prueba por defecto
    // (800x600) sin desplazar primero.
    await tester.ensureVisible(find.byType(IconButton));
    await tester.pumpAndSettle();
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
  // explícitamente abajo.
  //
  // KORIXA-SCREEN03-WEB-DESKTOP-HERO-PATTERN-ALIGN-WITH-SCREEN01-20260914:
  // desktop web (`canFitWideLayout()`) usa el mismo patrón técnico ya
  // aprobado en SCREEN_01 (`welcome_page.dart` — `StackFit.expand` +
  // `BoxFit.cover` + alignment controlado) con un asset dedicado
  // (`korixa_register_hero_desktop.png`) — ya NO `BoxFit.contain`, que
  // dejaba franjas negras en viewports cuyo aspect ratio no coincidía con
  // el de la foto. 1920x992 se agrega explícitamente porque fue el
  // tamaño real donde el owner reportó el problema de las franjas.
  // ---------------------------------------------------------------------

  const List<Size> desktopWebSizes = <Size>[
    Size(1280, 720),
    Size(1366, 768),
    Size(1440, 900),
    Size(1536, 864),
    Size(1920, 1080),
    Size(1920, 992),
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

  testWidgets('SCREEN03_DESKTOP_USES_COVER = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final Iterable<Image> images = tester.widgetList<Image>(
      find.descendant(of: find.byKey(const Key('register-desktop-hero-image')), matching: find.byType(Image)),
    );
    expect(images.length, 1);
    final Image hero = images.first;
    expect(
      (hero.image as AssetImage).assetName,
      'assets/images/korixa_register_hero_desktop.png',
      reason: 'SCREEN03_DESKTOP_NEW_ASSET_PRESENT: debe usar el nuevo asset dedicado de escritorio',
    );
    expect(
      hero.fit,
      BoxFit.cover,
      reason: 'SCREEN03_DESKTOP_USES_COVER: mismo patrón ya aprobado en SCREEN_01, sin franjas negras',
    );
  });

  testWidgets('SCREEN03_DESKTOP_NO_CONTAIN = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final Image hero = tester.widget<Image>(
      find.descendant(of: find.byKey(const Key('register-desktop-hero-image')), matching: find.byType(Image)),
    );
    expect(hero.fit, isNot(BoxFit.contain), reason: 'SCREEN03_DESKTOP_NO_CONTAIN: ya no debe dejar franjas negras');
    expect(hero.fit, isNot(BoxFit.fill), reason: 'sin deformación');
  });

  testWidgets('SCREEN03_DESKTOP_STACK_EXPANDS = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final Stack layoutStack = tester.widget<Stack>(find.byKey(const Key('register-desktop-layout')));
    expect(
      layoutStack.fit,
      StackFit.expand,
      reason: 'SCREEN03_DESKTOP_STACK_EXPANDS: mismo patrón de SCREEN_01 — el hero debe ocupar todo el viewport',
    );
  });

  testWidgets('SCREEN03_NO_BLACK_FILL_CONTAINER = PASS', (WidgetTester tester) async {
    // Con `BoxFit.cover` no debe existir ningún relleno artificial de
    // franjas (segundo fondo/imagen duplicada/blur) — solo debe haber UNA
    // imagen usando el asset del hero en todo el layout desktop (otras
    // `Image` legítimas del layout, como el ícono de Google, no cuentan
    // como "relleno de fondo").
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1920, 992));

    final Iterable<Image> allImages = tester.widgetList<Image>(
      find.descendant(of: find.byKey(const Key('register-desktop-layout')), matching: find.byType(Image)),
    );
    final int heroAssetCount = allImages.where((Image image) {
      final ImageProvider provider = image.image;
      final ImageProvider unwrapped = provider is ResizeImage ? provider.imageProvider : provider;
      return unwrapped is AssetImage && unwrapped.assetName == 'assets/images/korixa_register_hero_desktop.png';
    }).length;
    expect(
      heroAssetCount,
      1,
      reason: 'SCREEN03_NO_BLACK_FILL_CONTAINER: exactamente 1 imagen usando el asset del hero, sin duplicados',
    );
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

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN03-WEB-MATCH-SCREEN02-DESKTOP-UI-SCALE-20260914: SCREEN_03
  // WEB debe consumir EXACTAMENTE la misma escala desktop ya aprobada de
  // SCREEN_02 (`LoginPage._buildDesktop`), verificada contra el código
  // actual: CONTENT_MAX_WIDTH=680, CONTROL_WIDTH=550, CTA_HEIGHT=64,
  // CTA_FONT_SIZE=20, LOGO_HEIGHT=188, TITLE_FONT_SIZE=51,
  // SUBTITLE_FONT_SIZE=24. No son números nuevos inventados.
  // ---------------------------------------------------------------------

  testWidgets('SCREEN03_DESKTOP_LOGO_MATCHES_SCREEN02_SCALE = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final Image logo = tester.widget<Image>(find.byKey(const Key('register-desktop-logo')));
    expect(logo.height, 188, reason: 'SCREEN03_DESKTOP_LOGO_MATCHES_SCREEN02_SCALE: mismo LOGO_HEIGHT que Login/Welcome desktop');
  });

  testWidgets('SCREEN03_DESKTOP_CONTROL_WIDTH_MATCHES_SCREEN02 = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final SizedBox headerBox = tester.widget<SizedBox>(find.byKey(const Key('register-desktop-header-width')));
    final SizedBox controlBox = tester.widget<SizedBox>(find.byKey(const Key('register-desktop-control-width')));
    expect(headerBox.width, 550, reason: 'SCREEN03_DESKTOP_CONTROL_WIDTH_MATCHES_SCREEN02: mismo CONTROL_WIDTH que Login desktop');
    expect(controlBox.width, 550);
  });

  testWidgets('SCREEN03_DESKTOP_TITLE_SCALE_MATCHES_SCREEN02 = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final Text title = tester.widget<Text>(find.byKey(const Key('register-title')));
    expect(title.style?.fontSize, 51, reason: 'SCREEN03_DESKTOP_TITLE_SCALE_MATCHES_SCREEN02: mismo TITLE_FONT_SIZE que Login desktop');
  });

  testWidgets('SCREEN03_DESKTOP_SUBTITLE_SCALE_MATCHES_SCREEN02 = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final Text subtitle = tester.widget<Text>(find.byKey(const Key('register-subtitle')));
    expect(
      subtitle.style?.fontSize,
      24,
      reason: 'SCREEN03_DESKTOP_SUBTITLE_SCALE_MATCHES_SCREEN02: mismo SUBTITLE_FONT_SIZE que Login desktop',
    );
  });

  testWidgets('SCREEN03_DESKTOP_CTA_MATCHES_SCREEN02 = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final PrimaryGradientButton cta = tester.widget<PrimaryGradientButton>(find.byType(PrimaryGradientButton));
    expect(cta.height, 64, reason: 'SCREEN03_DESKTOP_CTA_MATCHES_SCREEN02: mismo CTA_HEIGHT que Login desktop');
    expect(cta.fontSize, 20, reason: 'SCREEN03_DESKTOP_CTA_MATCHES_SCREEN02: mismo CTA_FONT_SIZE que Login desktop');
  });

  testWidgets('SCREEN03_HERO_UNCHANGED = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN03-WEB-MATCH-SCREEN02-DESKTOP-UI-SCALE-20260914: esta
    // tarea NO debe tocar el hero (asset/fit/alignment) — bloqueado por
    // contrato con la ronda anterior.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    final Image hero = tester.widget<Image>(
      find.descendant(of: find.byKey(const Key('register-desktop-hero-image')), matching: find.byType(Image)),
    );
    expect((hero.image as AssetImage).assetName, 'assets/images/korixa_register_hero_desktop.png');
    expect(hero.fit, BoxFit.cover);
    expect(hero.alignment, const Alignment(0.35, 0));
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

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN03-MOBILE-PORTRAIT-NO-LOGO-IMPLEMENTATION-20260914: mockup
  // aprobado por el owner — fondo full-screen dedicado (ciclista + Santuario
  // de Las Lajas), SIN logo, SIN card exterior. Portrait (`isPortrait`, no
  // `canFitWideLayout()`) ya NO cae en `_buildLegacyShell` — tiene su
  // propia composición nueva.
  // ---------------------------------------------------------------------

  const List<Size> mobilePortraitSizes = <Size>[
    Size(360, 640),
    Size(360, 680),
    Size(390, 700),
    Size(390, 844),
    Size(412, 915),
    Size(430, 932),
  ];

  for (final Size size in mobilePortraitSizes) {
    final String label = '${size.width.toInt()}x${size.height.toInt()}';
    testWidgets('MOBILE_${label}_NO_OVERFLOW = PASS', (WidgetTester tester) async {
      await pumpRegisterPage(tester, repository, surfaceSize: size);

      expect(tester.takeException(), isNull, reason: 'MOBILE_${label}_NO_OVERFLOW: no debe haber overflow');
      expect(
        find.byKey(const Key('register-mobile-layout')),
        findsOneWidget,
        reason: 'MOBILE_${label}_NO_OVERFLOW: debe usar la composición mobile portrait nueva',
      );
      expect(find.text('Registrarme'), findsOneWidget, reason: 'CTA visible');
      expect(find.text('Continuar con Google'), findsOneWidget, reason: 'Google visible');
      expect(find.text('¿Ya tienes cuenta?'), findsOneWidget, reason: 'footer visible');
      expect(find.text('Crea tu cuenta'), findsOneWidget, reason: 'título visible');
    });
  }

  testWidgets('MOBILE_PORTRAIT_USES_NEW_APPROVED_LAYOUT = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    expect(find.byKey(const Key('register-mobile-layout')), findsOneWidget);
    expect(find.byKey(const Key('register-mobile-hero-image')), findsOneWidget);
    expect(
      find.byKey(const Key('register-desktop-layout')),
      findsNothing,
      reason: 'mobile portrait NO debe usar la composición desktop',
    );
  });

  testWidgets('MOBILE_PORTRAIT_NO_LOGO = PASS', (WidgetTester tester) async {
    // Requisito explícito del owner: NO logo en mobile portrait.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    expect(
      find.byKey(const Key('register-desktop-logo')),
      findsNothing,
      reason: 'MOBILE_PORTRAIT_NO_LOGO: no debe existir ningún logo en la composición mobile',
    );
    expect(
      find.byWidgetPredicate(
        (Widget widget) =>
            widget is Image && (widget.image is AssetImage) && (widget.image as AssetImage).assetName.contains('korixa_logo'),
      ),
      findsNothing,
      reason: 'MOBILE_PORTRAIT_NO_LOGO: ninguna imagen con el logo de Korixa debe estar presente (el ícono de Google sí es esperado)',
    );
  });

  testWidgets('MOBILE_PORTRAIT_NO_FAKE_STATUS_BAR = PASS', (WidgetTester tester) async {
    // El mockup muestra una barra de estado tipo iPhone (9:41, señal,
    // batería) — es solo referencia visual, NUNCA debe implementarse como
    // UI real: no debe existir ningún texto "9:41" hardcodeado en el árbol.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    expect(find.text('9:41'), findsNothing, reason: 'MOBILE_PORTRAIT_NO_FAKE_STATUS_BAR: ninguna barra de estado falsa');
    expect(tester.widget<Scaffold>(find.byType(Scaffold).first).body, isNotNull);
    expect(find.byType(SafeArea), findsWidgets, reason: 'debe usar SafeArea real, no una barra dibujada a mano');
  });

  testWidgets('MOBILE_PORTRAIT_HERO_IMAGE_CORRECT = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    final Image hero = tester.widget<Image>(
      find.descendant(of: find.byKey(const Key('register-mobile-hero-image')), matching: find.byType(Image)),
    );
    expect(
      (hero.image as AssetImage).assetName,
      'assets/images/korixa_register_hero_mobile.png',
      reason: 'MOBILE_PORTRAIT_HERO_IMAGE_CORRECT: asset dedicado de mobile, distinto del de escritorio',
    );
    expect(hero.fit, BoxFit.cover);
  });

  testWidgets('MOBILE_PORTRAIT_NO_OUTER_CARD = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

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
      reason: 'MOBILE_PORTRAIT_NO_OUTER_CARD: el formulario no debe vivir dentro de ninguna card/panel opaco',
    );
  });

  testWidgets('MOBILE_PORTRAIT_ALL_FIELDS_PRESENT = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    expect(find.byType(TextFormField), findsNWidgets(4));
    expect(find.text('Nombre'), findsOneWidget);
    expect(find.text('Correo electrónico'), findsOneWidget);
    expect(find.text('Contraseña'), findsOneWidget);
    expect(find.text('Confirmar contraseña'), findsOneWidget);
    expect(find.text('Empieza a entrenar en minutos'), findsOneWidget);
  });

  testWidgets('MOBILE_PORTRAIT_no envía el formulario si los campos están vacíos', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

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

  testWidgets('MOBILE_PORTRAIT_muestra un spinner mientras el registro está en curso', (WidgetTester tester) async {
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

    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));
    await fillForm(tester);
    await tester.tap(find.text('Registrarme'));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.pumpAndSettle();
  });

  testWidgets('MOBILE_PORTRAIT_navega a EMAIL_VERIFICATION cuando el registro es exitoso',
      (WidgetTester tester) async {
    when(
      () => repository.register(
        email: 'rider@ridepro.com',
        password: 'securePass123',
        displayName: 'Rider Demo',
      ),
    ).thenAnswer((_) async => const Right(tUser));

    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));
    await fillForm(tester);
    await tester.tap(find.text('Registrarme'));
    await tester.pumpAndSettle();

    expect(find.text('EMAIL_VERIFICATION'), findsOneWidget);
  });

  testWidgets('MOBILE_PORTRAIT_toggle de visibilidad de contraseña mantiene su semántica',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();

    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    final Finder passwordEditable =
        find.descendant(of: find.byType(TextFormField).at(2), matching: find.byType(EditableText));
    expect(tester.widget<EditableText>(passwordEditable).obscureText, isTrue);

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

  testWidgets('MOBILE_PORTRAIT_Iniciar sesión (link) navega a Login', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    await tester.ensureVisible(find.text('Inicia sesión'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Inicia sesión'));
    await tester.pumpAndSettle();

    expect(find.text('LOGIN'), findsOneWidget);
  });

  testWidgets('MOBILE_PORTRAIT_Google Sign-In navega a Home cuando el proveedor social tiene éxito',
      (WidgetTester tester) async {
    when(() => repository.signInWithGoogle()).thenAnswer((_) async => const Right(tUser));

    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));
    await tester.ensureVisible(find.byType(GoogleSignInButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(GoogleSignInButton));
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('MOBILE_PORTRAIT_muestra un SnackBar con el mensaje de error cuando el registro falla',
      (WidgetTester tester) async {
    const AuthFailure failure = AuthFailure('Este correo ya está registrado.');
    when(
      () => repository.register(
        email: any(named: 'email'),
        password: any(named: 'password'),
        displayName: any(named: 'displayName'),
      ),
    ).thenAnswer((_) async => const Left(failure));

    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));
    await fillForm(tester);
    await tester.tap(find.text('Registrarme'));
    await tester.pumpAndSettle();

    expect(find.text('Este correo ya está registrado.'), findsOneWidget);
    expect(find.text('EMAIL_VERIFICATION'), findsNothing);
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
