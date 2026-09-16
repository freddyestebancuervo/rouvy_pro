import 'package:dartz/dartz.dart';
import 'package:flutter/foundation.dart' show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/app/theme/app_colors.dart';
import 'package:rouvy_pro/app/theme/app_gradients.dart';
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

  testWidgets('WEB_PHONE_LANDSCAPE_NEVER_USES_DESKTOP_COMPOSITION = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN03-PHONE-COMPACT-LANDSCAPE-IMPLEMENTATION-20260915:
    // este test se llamaba "...KEEPS_LEGACY_ORIGIN_MAIN_BEHAVIOR" y
    // afirmaba (incorrectamente, a partir de esta tarea) que 932x430
    // seguía usando `DarkTechAuthShell` — ya NO es así, ahora usa
    // `_buildPhoneLandscape` (ver `REGISTER_PHONE_LANDSCAPE_932x430` más
    // abajo, que sí verifica la composición nueva explícitamente por
    // key). Se conserva este test, renombrado y con la aserción que
    // sigue siendo válida: landscape angosto NUNCA debe caer en la
    // composición de escritorio.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(932, 430));

    expect(tester.takeException(), isNull);
    expect(
      find.byKey(const Key('register-desktop-layout')),
      findsNothing,
      reason: 'phone landscape NO debe usar la composición desktop',
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

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN03-PHONE-COMPACT-LANDSCAPE-IMPLEMENTATION-20260915:
  // cierra la brecha identificada por KORIXA-LANDSCAPE-FIRST-ARCHITECTURE-
  // AUDIT-20260915 — un teléfono horizontal (`isCompactLandscape`) ya no
  // cae en `_buildLegacyShell`.
  // ---------------------------------------------------------------------

  const List<Size> phoneLandscapeSizes = <Size>[
    Size(740, 360),
    Size(812, 375),
    Size(844, 390),
    Size(915, 412),
    Size(932, 430),
  ];

  for (final Size size in phoneLandscapeSizes) {
    final String label = '${size.width.toInt()}x${size.height.toInt()}';
    testWidgets('REGISTER_PHONE_LANDSCAPE_$label = PASS', (WidgetTester tester) async {
      await pumpRegisterPage(tester, repository, surfaceSize: size);

      expect(tester.takeException(), isNull, reason: 'REGISTER_PHONE_LANDSCAPE_$label: no debe haber overflow');
      expect(
        find.byKey(const Key('register-landscape-layout')),
        findsOneWidget,
        reason: 'REGISTER_PHONE_LANDSCAPE_$label: debe usar la composición phone-landscape nueva, no el shell genérico',
      );
      expect(find.text('Registrarme'), findsOneWidget, reason: 'CTA visible');
      expect(find.text('Continuar con Google'), findsOneWidget, reason: 'Google visible');
      expect(find.text('Crea tu cuenta'), findsOneWidget, reason: 'título visible');
    });
  }

  testWidgets('REGISTER_COMPACT_LANDSCAPE_NO_OVERFLOW = PASS', (WidgetTester tester) async {
    // textScale 1.3 — caso de accesibilidad explícito pedido por la tarea,
    // sobre el tamaño más angosto de los 5 requeridos.
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

    await pumpRegisterPage(tester, repository, surfaceSize: const Size(844, 390));

    expect(
      tester.takeException(),
      isNull,
      reason: 'REGISTER_COMPACT_LANDSCAPE_NO_OVERFLOW: sin overflow, incluso con textScale 1.3',
    );
    expect(find.byKey(const Key('register-landscape-layout')), findsOneWidget);
  });

  testWidgets('REGISTER_COMPACT_LANDSCAPE_SAFE_AREA = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(844, 390));

    expect(find.byType(SafeArea), findsWidgets, reason: 'REGISTER_COMPACT_LANDSCAPE_SAFE_AREA: debe usar SafeArea real');
    expect(find.text('9:41'), findsNothing, reason: 'ninguna barra de estado falsa dibujada a mano');
  });

  testWidgets('REGISTER_COMPACT_LANDSCAPE_CTA_REACHABLE = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(844, 390));

    await tester.ensureVisible(find.text('Registrarme'));
    await tester.pumpAndSettle();
    expect(find.text('Registrarme'), findsOneWidget);

    await tester.tap(find.text('Registrarme'));
    await tester.pumpAndSettle();

    // Sin llenar el formulario: debe disparar validación, no un error de
    // hit-test — confirma que el CTA es real y tocable, no solo visible.
    expect(find.text('Ingresa tu nombre'), findsOneWidget);
  });

  testWidgets('REGISTER_COMPACT_LANDSCAPE_ALL_FIELDS_REACHABLE = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(844, 390));

    final Finder fields = find.byType(TextFormField);
    expect(fields, findsNWidgets(4));

    for (int i = 0; i < 4; i++) {
      await tester.ensureVisible(fields.at(i));
      await tester.pumpAndSettle();
      await tester.enterText(fields.at(i), 'x');
    }

    expect(tester.takeException(), isNull, reason: 'REGISTER_COMPACT_LANDSCAPE_ALL_FIELDS_REACHABLE: los 4 campos deben ser alcanzables y editables');
  });

  testWidgets('REGISTER_COMPACT_LANDSCAPE_FIELD_GAP_EXACT_5PX = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN03-COMPACT-LANDSCAPE-FORM-WIDTH-REFINEMENT-20260915:
    // decisión explícita del owner — 5.0px EXACTOS entre los 4 campos en
    // landscape (deliberadamente no un token de `AppSpacing`). Es el
    // único assert de esta ronda que SÍ fija un número exacto de
    // píxeles, a propósito.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(844, 390));

    final Finder fields = find.byType(TextFormField);
    expect(fields, findsNWidgets(4));

    for (int i = 0; i < 3; i++) {
      final double gap = tester.getTopLeft(fields.at(i + 1)).dy - tester.getBottomLeft(fields.at(i)).dy;
      expect(gap, 5.0, reason: 'REGISTER_COMPACT_LANDSCAPE_FIELD_GAP_EXACT_5PX: gap entre campo ${i + 1} y ${i + 2}');
    }
  });

  testWidgets('REGISTER_COMPACT_LANDSCAPE_CONTROLS_SHARE_CONSISTENT_WIDTH = PASS', (WidgetTester tester) async {
    // Título, campos y CTA deben compartir el MISMO ancho — nunca anchos
    // distintos entre elementos (Sección 1 de la tarea).
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(844, 390));

    final double titleWidth = tester.getSize(find.byKey(const Key('register-title'))).width;
    final double fieldWidth = tester.getSize(find.byType(TextFormField).first).width;
    final double ctaWidth = tester.getSize(find.byType(PrimaryGradientButton)).width;

    expect(fieldWidth, closeTo(ctaWidth, 0.5), reason: 'REGISTER_COMPACT_LANDSCAPE_CONTROLS_SHARE_CONSISTENT_WIDTH: CTA debe tener el mismo ancho que los campos');
    expect(titleWidth, closeTo(fieldWidth, 0.5), reason: 'título debe compartir el mismo ancho que los campos/CTA');
  });

  testWidgets('REGISTER_COMPACT_LANDSCAPE_CONTROL_WIDTH_WITHIN_TARGET_RANGE = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN03-COMPACT-LANDSCAPE-FORM-WIDTH-REFINEMENT-20260915
    // (ronda 2 — ajuste del owner, -12% exacto sobre la ronda 1):
    // clamp(270.0, 343.2), fracción 0.3696 del ancho del viewport.
    // Verificado contra los 5 anchos aproximados exactos que dio el
    // owner, con una tolerancia mínima (0.5px) para redondeo de layout.
    const List<(Size, double)> expectedWidths = <(Size, double)>[
      (Size(740, 360), 273.5),
      (Size(812, 375), 300.1),
      (Size(844, 390), 311.9),
      (Size(915, 412), 338.2),
      (Size(932, 430), 343.2),
    ];
    for (final (Size size, double expectedWidth) in expectedWidths) {
      await pumpRegisterPage(tester, repository, surfaceSize: size);
      final double width = tester.getSize(find.byKey(const Key('register-landscape-panel-width'))).width;
      expect(
        width,
        closeTo(expectedWidth, 0.5),
        reason: 'REGISTER_COMPACT_LANDSCAPE_CONTROL_WIDTH_WITHIN_TARGET_RANGE: '
            '${size.width.toInt()}x${size.height.toInt()} -> ancho=$width, esperado≈$expectedWidth',
      );
      expect(width, inInclusiveRange(270.0, 343.2));
    }
  });

  testWidgets('REGISTER_COMPACT_LANDSCAPE_TITLE_LEFT_ALIGNED = PASS', (WidgetTester tester) async {
    // El owner pidió explícitamente "NO centrar el formulario" — título/
    // subtítulo alineados a la izquierda en landscape (portrait conserva
    // el centrado ya aprobado, sin cambios — ver MOBILE_PORTRAIT_ALL_FIELDS_PRESENT).
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(844, 390));

    final Text title = tester.widget<Text>(find.byKey(const Key('register-title')));
    final Text subtitle = tester.widget<Text>(find.byKey(const Key('register-subtitle')));
    expect(title.textAlign, TextAlign.left);
    expect(subtitle.textAlign, TextAlign.left);
  });

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN02-SCREEN03-INDICATORS-EXACT-POSITION-20260916: el
  // indicador de 3 barras (35×6, separación 4) se movió de "arriba del
  // formulario, barra central activa" (KORIXA-SCREEN03-ADD-THREE-LINE-
  // INDICATOR-WITH-CENTER-ACTIVE-20260915, tarea anterior) a "justo
  // encima del CTA Registrarme, barra FINAL activa" — pedido explícito
  // de esta tarea. Actualizado (no debilitado): la posición y la barra
  // activa SÍ cambiaron por diseño; el tamaño/gap del indicador en sí no.
  // ---------------------------------------------------------------------
  for (final Size size in phoneLandscapeSizes) {
    testWidgets(
      'REGISTER_LANDSCAPE_${size.width.toInt()}x${size.height.toInt()}_INDICATOR_ABOVE_CTA_END_ACTIVE = PASS',
      (WidgetTester tester) async {
        await pumpRegisterPage(tester, repository, surfaceSize: size);
        expect(tester.takeException(), isNull, reason: 'no debe haber overflow en ${size.width.toInt()}x${size.height.toInt()}');

        // SCREEN03_DUPLICATE_INDICATORS = NO: exactamente 1 indicador en
        // el árbol.
        expect(find.byKey(const Key('register-indicator-row')), findsOneWidget, reason: 'SCREEN03_INDICATOR_PRESENT debe ser YES, sin duplicados');

        final List<Container> bars = tester
            .widgetList<Container>(find.descendant(of: find.byKey(const Key('register-indicator-row')), matching: find.byType(Container)))
            .toList();
        expect(bars.length, 3, reason: 'INDICATOR debe mostrar exactamente 3 líneas');
        for (final Container bar in bars) {
          expect(bar.constraints?.maxWidth, 35.0, reason: 'INDICATOR_WIDTH debe ser 35px');
          expect(bar.constraints?.maxHeight, 6.0, reason: 'INDICATOR_HEIGHT debe ser 6px');
        }

        // SCREEN03_ACTIVE_BAR_POSITION = END: la 3ra barra (índice 2)
        // debe tener el gradiente activo; la 1ra y 2da deben quedar en
        // gris inactivo (`DarkTech.border`).
        final BoxDecoration firstDecoration = bars[0].decoration! as BoxDecoration;
        final BoxDecoration secondDecoration = bars[1].decoration! as BoxDecoration;
        final BoxDecoration lastDecoration = bars[2].decoration! as BoxDecoration;
        expect(firstDecoration.gradient, isNull, reason: 'la 1ra barra debe ser gris/inactiva');
        expect(firstDecoration.color, DarkTech.border, reason: 'la 1ra barra debe ser gris/inactiva');
        expect(secondDecoration.gradient, isNull, reason: 'la 2da barra debe ser gris/inactiva');
        expect(secondDecoration.color, DarkTech.border, reason: 'la 2da barra debe ser gris/inactiva');
        expect(lastDecoration.gradient, AppGradients.primaryCta, reason: 'SCREEN03_ACTIVE_BAR_POSITION debe ser END');

        // Separación horizontal entre líneas: 4px.
        final List<SizedBox> gaps = tester
            .widgetList<SizedBox>(find.descendant(of: find.byKey(const Key('register-indicator-row')), matching: find.byType(SizedBox)))
            .toList();
        expect(gaps.length, 2, reason: 'debe haber 2 separadores entre las 3 barras');
        for (final SizedBox gap in gaps) {
          expect(gap.width, 4.0, reason: 'INDICATOR_GAP debe ser 4px');
        }

        // SCREEN03_INDICATOR_POSITION = ABOVE_REGISTER_CTA: el indicador
        // debe quedar inmediatamente arriba del CTA "Registrarme", sin
        // pegarse a él ni a los campos.
        final double indicatorBottom = tester.getRect(find.byKey(const Key('register-indicator-row'))).bottom;
        final double ctaTop = tester.getRect(find.byType(PrimaryGradientButton)).top;
        final double confirmPasswordBottom = tester.getRect(find.byType(TextFormField).last).bottom;
        final double indicatorTop = tester.getRect(find.byKey(const Key('register-indicator-row'))).top;
        expect(ctaTop, greaterThan(indicatorBottom), reason: 'el indicador debe quedar arriba del CTA');
        expect(ctaTop - indicatorBottom, greaterThan(0), reason: 'no debe quedar pegado al CTA');
        expect(indicatorTop, greaterThan(confirmPasswordBottom), reason: 'el indicador debe quedar debajo de los campos');
        expect(indicatorTop - confirmPasswordBottom, greaterThan(0), reason: 'no debe quedar pegado a los campos');

        // El indicador debe quedar alineado con el mismo borde izquierdo
        // que el panel del formulario/CTA (mismo `Align(centerLeft)` de
        // origen, `crossAxisAlignment.stretch` del `Column` del
        // formulario) — no debe quedar flotando sin relación con el
        // contenido.
        final double indicatorLeft = tester.getTopLeft(find.byKey(const Key('register-indicator-row'))).dx;
        final double panelLeft = tester.getTopLeft(find.byKey(const Key('register-landscape-panel-width'))).dx;
        expect(indicatorLeft, closeTo(panelLeft, 0.5), reason: 'el indicador debe compartir el borde izquierdo del panel');
      },
    );
  }

  testWidgets('REGISTER_PORTRAIT_NO_INDICATOR = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN03-ADD-THREE-LINE-INDICATOR-WITH-CENTER-ACTIVE-
    // 20260915: exclusivo de phone landscape — portrait no debe mostrar
    // este indicador.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));
    expect(find.byKey(const Key('register-indicator-row')), findsNothing);
  });

  testWidgets('REGISTER_DESKTOP_NO_INDICATOR = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN03-ADD-THREE-LINE-INDICATOR-WITH-CENTER-ACTIVE-
    // 20260915: exclusivo de phone landscape — desktop/web no debe
    // mostrar este indicador (no estaba explícitamente implementado ahí,
    // así que el encargo pide no tocarlo).
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));
    expect(find.byKey(const Key('register-indicator-row')), findsNothing);
  });

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN02-SCREEN03-MATCH-SCREEN01-TITLE-SIZE-20260915: el
  // título landscape ("Crea tu cuenta") debe usar EXACTAMENTE el mismo
  // tamaño/peso que el título landscape de SCREEN_01
  // ("Conecta tu energía.", 32px, w800).
  // ---------------------------------------------------------------------
  for (final Size size in phoneLandscapeSizes) {
    testWidgets(
      'REGISTER_LANDSCAPE_${size.width.toInt()}x${size.height.toInt()}_TITLE_MATCHES_SCREEN01 = PASS',
      (WidgetTester tester) async {
        await pumpRegisterPage(tester, repository, surfaceSize: size);
        expect(tester.takeException(), isNull, reason: 'no debe haber overflow en ${size.width.toInt()}x${size.height.toInt()}');

        final Text title = tester.widget<Text>(find.byKey(const Key('register-title')));
        expect(title.style?.fontSize, 32, reason: 'debe coincidir con el tamaño del título de SCREEN_01 (32px)');
        expect(title.style?.fontWeight, FontWeight.w800, reason: 'debe coincidir con el peso del título de SCREEN_01 (w800)');
      },
    );
  }

  testWidgets('REGISTER_COMPACT_LANDSCAPE_KEYBOARD_OPEN_CTA_REACHABLE = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(844, 390));

    // Simula el teclado abierto: ~55-65% del alto disponible, coherente
    // con el cálculo aritmético documentado en la auditoría previa
    // (KORIXA-LANDSCAPE-FIRST-ARCHITECTURE-AUDIT-20260915, Sección 9).
    tester.view.viewInsets = const FakeViewPadding(bottom: 230);
    addTearDown(() => tester.view.resetViewInsets());
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull, reason: 'sin overflow con teclado simulado abierto');

    // El campo enfocado debe seguir siendo alcanzable/editable.
    final Finder nameField = find.byType(TextFormField).first;
    await tester.ensureVisible(nameField);
    await tester.pumpAndSettle();
    await tester.enterText(nameField, 'Rider Demo');
    expect(tester.takeException(), isNull);

    // El CTA debe seguir siendo alcanzable vía scroll, no permanentemente
    // oculto detrás del teclado.
    await tester.ensureVisible(find.text('Registrarme'));
    await tester.pumpAndSettle();
    expect(find.text('Registrarme'), findsOneWidget, reason: 'REGISTER_COMPACT_LANDSCAPE_KEYBOARD_OPEN_CTA_REACHABLE');
  });

  testWidgets('REGISTER_COMPACT_LANDSCAPE_PRIMARY_CTA_NEAR_INITIAL_VIEWPORT = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN03-COMPACT-LANDSCAPE-VISUAL-DENSITY-REFINEMENT-20260915:
    // el owner probó físicamente que "Registrarme" quedaba muy abajo con
    // teclado cerrado. Medido empíricamente (fuera de este test, ver
    // reporte de la tarea): antes de esta ronda el borde inferior del CTA
    // caía en y=488 (por debajo del viewport de 390px, `844x390`); con la
    // densidad reducida cae en y=347 — DENTRO del viewport inicial, sin
    // necesitar ningún scroll. Este test protege esa propiedad sin fijar
    // una coordenada exacta y frágil: solo exige que el CTA esté dentro
    // del viewport (o a lo sumo muy cerca de su borde) sin haber hecho
    // ningún scroll manual.
    const Size size = Size(844, 390);
    await pumpRegisterPage(tester, repository, surfaceSize: size);

    final double ctaBottom = tester.getRect(find.text('Registrarme')).bottom;
    expect(
      ctaBottom,
      lessThan(size.height * 1.15),
      reason: 'REGISTER_COMPACT_LANDSCAPE_PRIMARY_CTA_NEAR_INITIAL_VIEWPORT: '
          'el CTA debe estar dentro (o a lo sumo apenas fuera) del viewport inicial sin scroll manual',
    );
  });

  testWidgets('REGISTER_PORTRAIT_UNCHANGED = PASS', (WidgetTester tester) async {
    // Regresión: portrait sigue exactamente igual después de introducir
    // la rama de landscape — mismo layout, mismo comportamiento.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    expect(find.byKey(const Key('register-mobile-layout')), findsOneWidget);
    expect(find.byKey(const Key('register-landscape-layout')), findsNothing);
    expect(find.byKey(const Key('register-desktop-layout')), findsNothing);
  });

  testWidgets('REGISTER_DESKTOP_UNCHANGED = PASS', (WidgetTester tester) async {
    // Regresión: desktop sigue exactamente igual después de introducir
    // la rama de landscape.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(1440, 900));

    expect(find.byKey(const Key('register-desktop-layout')), findsOneWidget);
    expect(find.byKey(const Key('register-landscape-layout')), findsNothing);
    expect(find.byKey(const Key('register-mobile-layout')), findsNothing);
  });

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
