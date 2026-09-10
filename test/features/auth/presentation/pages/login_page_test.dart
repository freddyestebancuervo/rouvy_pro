import 'dart:async';

import 'package:dartz/dartz.dart';
import 'package:flutter/foundation.dart' show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

import 'package:rouvy_pro/core/design_system/dark_tech_buttons.dart';
import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/features/auth/domain/entities/user_entity.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/login_usecase.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/sign_in_with_apple_usecase.dart';
import 'package:rouvy_pro/features/auth/domain/usecases/sign_in_with_google_usecase.dart';
import 'package:rouvy_pro/features/auth/presentation/pages/login_page.dart';
import 'package:rouvy_pro/features/auth/presentation/providers/auth_providers.dart';
import 'package:rouvy_pro/features/auth/presentation/widgets/social_sign_in_buttons.dart';

import 'auth_page_test_utils.dart';

void main() {
  late MockAuthRepository repository;

  setUp(() {
    repository = MockAuthRepository();
  });

  List<Override> overridesFor(MockAuthRepository repo) => <Override>[
        loginUseCaseProvider.overrideWithValue(LoginUseCase(repo)),
        signInWithGoogleUseCaseProvider.overrideWithValue(SignInWithGoogleUseCase(repo)),
        signInWithAppleUseCaseProvider.overrideWithValue(SignInWithAppleUseCase(repo)),
      ];

  Future<void> pumpLoginPage(
    WidgetTester tester,
    MockAuthRepository repo, {
    Size? surfaceSize,
  }) async {
    // KORIXA-SCREEN02-LOGIN-VISUAL-IMPLEMENTATION-20260907: `surfaceSize`
    // es opcional — los 9 tests funcionales ya existentes antes de esa
    // tarea no lo pasan, así que siguen corriendo en el tamaño de
    // superficie por defecto del binding de test (800x600 lógicos).
    //
    // KORIXA-SCREEN02-ADOPT-RESPONSIVE-FOUNDATION-PR127-20260907: ese
    // tamaño por defecto activaba phone-landscape ANTES de esta tarea
    // por el mismo bug de clasificación que motivó la fundación
    // compartida (`shortestSide > 600` fallaba en 600 exacto pese a que
    // 800x600 es uno de los casos DESKTOP obligatorios) — ahora activa
    // correctamente DESKTOP (ver `_isDesktop`/`KorixaViewportInfo` en
    // `login_page.dart`). Los 9 tests siguen pasando de todas formas
    // porque el formulario compartido (`_buildFormColumn`) es idéntico
    // en las 3 composiciones — los 2 que interactúan con el botón de
    // Google usan `ensureVisible` para no depender de qué composición
    // esté activa ni de si el botón ya es visible sin scroll.
    if (surfaceSize != null) {
      tester.view.physicalSize = surfaceSize;
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
    }

    await tester.pumpWidget(
      authPageHarness(
        initialLocation: '/login',
        loginPage: const LoginPage(),
        overrides: overridesFor(repo),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('no envía el formulario ni llama al repositorio si los campos están vacíos',
      (WidgetTester tester) async {
    await pumpLoginPage(tester, repository);

    await tester.tap(find.text('Iniciar sesión'));
    await tester.pumpAndSettle();

    expect(find.text('Ingresa tu correo electrónico'), findsOneWidget);
    expect(find.text('Ingresa tu contraseña'), findsOneWidget);
    verifyNever(
      () => repository.login(email: any(named: 'email'), password: any(named: 'password')),
    );
  });

  testWidgets('muestra un spinner y deshabilita el botón mientras el login está en curso',
      (WidgetTester tester) async {
    final Completer<Either<Failure, UserEntity>> pending = Completer<Either<Failure, UserEntity>>();
    when(() => repository.login(email: any(named: 'email'), password: any(named: 'password')))
        .thenAnswer((_) => pending.future);

    await pumpLoginPage(tester, repository);

    await tester.enterText(find.byType(TextFormField).at(0), 'rider@ridepro.com');
    await tester.enterText(find.byType(TextFormField).at(1), 'securePass123');
    await tester.tap(find.text('Iniciar sesión'));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    // KORIXA-UI-SCREEN-BATCH-01: el CTA de login migró de `AppPrimaryButton`
    // (envolvía `ElevatedButton`) a `PrimaryGradientButton` (Dark Tech) —
    // mismo contrato de deshabilitado mientras carga, verificado ahora
    // contra el `onPressed` del nuevo widget en vez del `ElevatedButton`
    // interno que ya no existe en el árbol.
    final PrimaryGradientButton button = tester.widget(find.byType(PrimaryGradientButton));
    expect(button.onPressed, isNull);

    pending.complete(const Left<Failure, UserEntity>(AuthFailure('no importa, se limpia abajo')));
    await tester.pumpAndSettle();
  });

  testWidgets('navega a Home cuando el login es exitoso', (WidgetTester tester) async {
    when(() => repository.login(email: 'rider@ridepro.com', password: 'securePass123'))
        .thenAnswer((_) async => const Right(tUser));

    await pumpLoginPage(tester, repository);

    await tester.enterText(find.byType(TextFormField).at(0), 'rider@ridepro.com');
    await tester.enterText(find.byType(TextFormField).at(1), 'securePass123');
    await tester.tap(find.text('Iniciar sesión'));
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('muestra un SnackBar con el mensaje de error cuando el login falla',
      (WidgetTester tester) async {
    const AuthFailure failure = AuthFailure('Correo o contraseña incorrectos.');
    when(() => repository.login(email: 'rider@ridepro.com', password: 'wrongPass1'))
        .thenAnswer((_) async => const Left(failure));

    await pumpLoginPage(tester, repository);

    await tester.enterText(find.byType(TextFormField).at(0), 'rider@ridepro.com');
    await tester.enterText(find.byType(TextFormField).at(1), 'wrongPass1');
    await tester.tap(find.text('Iniciar sesión'));
    await tester.pumpAndSettle();

    expect(find.text('Correo o contraseña incorrectos.'), findsOneWidget);
    expect(find.text('HOME'), findsNothing);
  });

  testWidgets('el botón de Google Sign-In navega a Home cuando el proveedor social tiene éxito',
      (WidgetTester tester) async {
    when(() => repository.signInWithGoogle()).thenAnswer((_) async => const Right(tUser));

    await pumpLoginPage(tester, repository);

    // `find.byType(OutlinedButton)` no encuentra nada aquí: en esta versión
    // de Flutter, `OutlinedButton.icon(...)` (usado dentro de
    // `GoogleSignInButton`) construye una clase privada del framework que
    // no satisface `is OutlinedButton` — mismo patrón ya observado con
    // `FilledButton.icon()` en otros tests de este repositorio. Se busca
    // por nuestro propio widget con nombre estable en vez de un detalle
    // interno de Flutter.
    //
    // KORIXA-SCREEN02-ADOPT-RESPONSIVE-FOUNDATION-PR127-20260907: el
    // tamaño de superficie por defecto (800x600) antes activaba
    // phone-landscape por el mismo bug de clasificación que motivó la
    // fundación (`shortestSide > 600` fallaba en 600 exacto) — ahora
    // correctamente activa DESKTOP (800x600 es uno de los casos
    // obligatorios del encargo), donde el formulario vive dentro de un
    // `SingleChildScrollView` y el botón de Google puede empezar fuera
    // de vista. `ensureVisible` refleja lo que un usuario real haría
    // (scrollear) — no fuerza un viewport específico ni depende de qué
    // composición esté activa.
    await tester.ensureVisible(find.byType(GoogleSignInButton));
    await tester.tap(find.byType(GoogleSignInButton));
    await tester.pumpAndSettle();

    expect(find.text('HOME'), findsOneWidget);
  });

  testWidgets('el toggle de visibilidad de contraseña muestra/oculta el texto y mantiene su semántica',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();

    await pumpLoginPage(tester, repository);

    final Finder passwordField = find.byType(TextFormField).at(1);
    Finder passwordEditable() => find.descendant(of: passwordField, matching: find.byType(EditableText));
    expect(tester.widget<EditableText>(passwordEditable()).obscureText, isTrue);

    // El propio botón expone su estado vía `Semantics.toggled` — no solo
    // color/ícono (Sección 17: no depender solo del color para estados).
    // Se ubica el nodo por una `Key` estable puesta en el propio
    // `Semantics(toggled:)` en vez de por su `label` (texto): el label
    // final que ve un lector de pantalla puede fusionarse con la
    // semántica interna de `IconButton` de forma distinta según la
    // versión de Flutter (confirmado: pasaba localmente pero
    // `find.bySemanticsLabel` no encontraba nada en CI, que fija Flutter
    // 3.32.0) — la `Key` no depende de esa fusión.
    //
    // `hasFlag` (no `flagsCollection`) porque CI fija Flutter 3.32.0 (ver
    // .github/workflows/ci.yml), donde `flagsCollection` no existe todavía
    // — mismo criterio ya aplicado en dark_tech_buttons_test.dart.
    const Key toggleKey = Key('login-password-visibility-semantics');
    // ignore: deprecated_member_use
    expect(tester.getSemantics(find.byKey(toggleKey)).hasFlag(SemanticsFlag.isToggled), isFalse);

    await tester.tap(find.byType(IconButton));
    await tester.pumpAndSettle();

    expect(tester.widget<EditableText>(passwordEditable()).obscureText, isFalse);
    // ignore: deprecated_member_use
    expect(tester.getSemantics(find.byKey(toggleKey)).hasFlag(SemanticsFlag.isToggled), isTrue);

    handle.dispose();
  });

  testWidgets('Olvidé mi contraseña sigue navegando a ForgotPassword', (WidgetTester tester) async {
    await pumpLoginPage(tester, repository);

    await tester.tap(find.text('¿Olvidaste tu contraseña?'));
    await tester.pumpAndSettle();

    expect(find.text('FORGOT_PASSWORD'), findsOneWidget);
  });

  testWidgets('Crear cuenta sigue navegando a Register', (WidgetTester tester) async {
    await pumpLoginPage(tester, repository);

    await tester.ensureVisible(find.text('Crear cuenta'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Crear cuenta'));
    await tester.pumpAndSettle();

    expect(find.text('REGISTER'), findsOneWidget);
  });

  testWidgets('390x844_NO_OVERFLOW = PASS', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await pumpLoginPage(tester, repository);

    expect(tester.takeException(), isNull);
    expect(find.text('Crear cuenta'), findsOneWidget);
  });

  testWidgets('el botón de Apple solo aparece en la plataforma Apple soportada', (WidgetTester tester) async {
    await pumpLoginPage(tester, repository);
    expect(find.byType(AppleSignInButton), findsNothing);

    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await pumpLoginPage(tester, repository);
    expect(find.byType(AppleSignInButton), findsOneWidget);

    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('muestra un SnackBar cuando Google Sign-In falla', (WidgetTester tester) async {
    const AuthFailure failure = AuthFailure('No se pudo iniciar sesión con Google.');
    when(() => repository.signInWithGoogle()).thenAnswer((_) async => const Left(failure));

    await pumpLoginPage(tester, repository);

    // `find.byType(OutlinedButton)` no encuentra nada aquí: en esta versión
    // de Flutter, `OutlinedButton.icon(...)` (usado dentro de
    // `GoogleSignInButton`) construye una clase privada del framework que
    // no satisface `is OutlinedButton` — mismo patrón ya observado con
    // `FilledButton.icon()` en otros tests de este repositorio. Se busca
    // por nuestro propio widget con nombre estable en vez de un detalle
    // interno de Flutter.
    //
    // KORIXA-SCREEN02-ADOPT-RESPONSIVE-FOUNDATION-PR127-20260907: ver el
    // comentario equivalente en el test de éxito de Google — 800x600
    // ahora activa DESKTOP correctamente, y el botón puede empezar fuera
    // de vista dentro del `SingleChildScrollView` del panel.
    await tester.ensureVisible(find.byType(GoogleSignInButton));
    await tester.tap(find.byType(GoogleSignInButton));
    await tester.pumpAndSettle();

    expect(find.text('No se pudo iniciar sesión con Google.'), findsOneWidget);
    expect(find.text('HOME'), findsNothing);
  });

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN02-LOGIN-VISUAL-IMPLEMENTATION-20260907 — responsivo.
  // ---------------------------------------------------------------------

  String? resolvedAssetName(ImageProvider provider) {
    if (provider is AssetImage) return provider.assetName;
    if (provider is ResizeImage) {
      final ImageProvider inner = provider.imageProvider;
      if (inner is AssetImage) return inner.assetName;
    }
    return null;
  }

  bool hasHeroImage(WidgetTester tester) {
    final Iterable<Image> images = tester.widgetList<Image>(
      find.descendant(of: find.byKey(const Key('login-hero-image')), matching: find.byType(Image)),
    );
    return images.any(
      (Image image) => resolvedAssetName(image.image) == 'assets/images/korixa_login_hero_guatape.webp',
    );
  }

  void expectExclusiveLayout(WidgetTester tester, String selectedKey) {
    const List<String> allLayoutKeys = <String>[
      'login-portrait-layout',
      'login-landscape-layout',
      'login-desktop-layout',
    ];
    for (final String key in allLayoutKeys) {
      final Finder finder = find.byKey(Key(key));
      if (key == selectedKey) {
        expect(finder, findsOneWidget, reason: '$selectedKey debía estar seleccionado');
      } else {
        expect(finder, findsNothing, reason: '$key NO debía estar seleccionado junto con $selectedKey');
      }
    }
  }

  testWidgets('LOGIN_TITLE_SUBTITLE_APPROVED_COPY = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN02-LOGIN-VISUAL-IMPLEMENTATION-20260907: el subtítulo
    // cambió de copy ("...continuar entrenando" -> "...continuar tu
    // ruta") — un `flutter analyze`/`flutter test` normal NO regenera
    // `lib/l10n/generated/` automáticamente (hace falta `flutter
    // gen-l10n` explícito), y ningún test anterior verificaba este
    // string exacto, así que un archivo generado desactualizado habría
    // pasado la suite en silencio. Este test cierra ese hueco.
    await pumpLoginPage(tester, repository);
    expect(find.text('Bienvenido de nuevo'), findsOneWidget);
    expect(find.text('Inicia sesión para continuar tu ruta'), findsOneWidget);
  });

  testWidgets('390x844_PORTRAIT_COMPOSITION = PASS', (WidgetTester tester) async {
    await pumpLoginPage(tester, repository, surfaceSize: const Size(390, 844));
    expect(tester.takeException(), isNull, reason: 'no debe haber overflow en 390x844');

    expectExclusiveLayout(tester, 'login-portrait-layout');
    expect(hasHeroImage(tester), isTrue, reason: 'el hero de Guatapé debe estar presente en portrait');

    expect(find.byType(TextFormField), findsNWidgets(2), reason: 'email + password');
    expect(find.byType(PrimaryGradientButton), findsOneWidget);
    expect(find.byType(GoogleSignInButton), findsOneWidget);
    expect(find.text('Crear cuenta'), findsOneWidget);
  });

  const <String, Size>{
    '844x390': Size(844, 390),
    '915x412': Size(915, 412),
    '932x430': Size(932, 430),
  }.forEach((String label, Size size) {
    testWidgets('${label}_LANDSCAPE_COMPOSITION = PASS', (WidgetTester tester) async {
      await pumpLoginPage(tester, repository, surfaceSize: size);
      expect(tester.takeException(), isNull, reason: 'no debe haber overflow en $label');

      expectExclusiveLayout(tester, 'login-landscape-layout');
      expect(hasHeroImage(tester), isTrue, reason: '$label: el hero de Guatapé debe estar presente');

      expect(find.byType(TextFormField), findsNWidgets(2), reason: '$label: email + password');
      expect(
        find.byType(PrimaryGradientButton),
        findsOneWidget,
        reason: '$label: el CTA debe seguir siendo alcanzable (KORIXA-SCREEN02-LOGIN-BASELINE-AUDIT-20260906, P1)',
      );
      expect(
        find.byType(GoogleSignInButton),
        findsOneWidget,
        reason: '$label: Google debe seguir siendo alcanzable — este era exactamente el bug P1 de la baseline',
      );
      expect(
        find.text('Crear cuenta'),
        findsOneWidget,
        reason: '$label: Crear cuenta debe seguir siendo alcanzable — este era exactamente el bug P1 de la baseline',
      );
    });
  });

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN02-ADOPT-RESPONSIVE-FOUNDATION-PR127-20260907 — matriz
  // ampliada de escritorio. La fundación compartida
  // (`KorixaViewportInfo.canFitWideLayout`, ya cubierta exhaustivamente
  // por su propio barrido puro en `korixa_viewport_test.dart`) es la que
  // decide el umbral — estos tests SOLO verifican que Login integra esa
  // decisión correctamente y selecciona la composición/branding/
  // controles esperados, sin duplicar el barrido de la fundación acá.
  //
  // 1365x599 es el caso crítico: un laptop real con el chrome del
  // navegador reduciendo el alto disponible — el mismo bug que ya se
  // reprodujo y corrigió en SCREEN_01 (KORIXA-RESPONSIVE-FOUNDATION-V1-
  // SCREEN01-20260907). Con la clasificación local anterior de esta
  // pantalla (`shortestSide > 600`), este caso habría caído en
  // phone-landscape.
  // ---------------------------------------------------------------------

  const <String, Size>{
    '800x600': Size(800, 600),
    '1024x768': Size(1024, 768),
    '1280x600': Size(1280, 600),
    '1365x599': Size(1365, 599),
    '1366x768': Size(1366, 768),
    '1440x900': Size(1440, 900),
    '1536x864': Size(1536, 864),
    '1920x1080': Size(1920, 1080),
    '2560x1440': Size(2560, 1440),
  }.forEach((String label, Size size) {
    testWidgets('${label}_DESKTOP_SPLIT_COMPOSITION = PASS', (WidgetTester tester) async {
      await pumpLoginPage(tester, repository, surfaceSize: size);
      expect(tester.takeException(), isNull, reason: 'no debe haber overflow en $label');

      expectExclusiveLayout(tester, 'login-desktop-layout');
      expect(hasHeroImage(tester), isTrue, reason: '$label: el hero de Guatapé debe estar presente en desktop');

      // Branding: logo de escritorio presente (KORIXA-SCREEN02-LOGIN-
      // BASELINE-AUDIT-20260906, hallazgo P0 — antes NO había ningún logo).
      final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
      final bool hasDesktopLogo = images.any(
        (Image image) => resolvedAssetName(image.image) == 'assets/icons/korixa_logo_desktop.png',
      );
      expect(hasDesktopLogo, isTrue, reason: '$label: el branding Korixa debe estar presente en desktop');

      expect(find.byType(TextFormField), findsNWidgets(2), reason: '$label: email + password');
      expect(find.byType(PrimaryGradientButton), findsOneWidget, reason: '$label: el CTA de login debe existir');
      expect(find.byType(GoogleSignInButton), findsOneWidget, reason: '$label: Google debe estar presente');
    });
  });

  // Portrait "grande" (tablet) y anchos de teléfono adicionales — un
  // viewport orientado en vertical nunca debe encajar en el split de
  // escritorio, sin importar cuán ancho sea en términos absolutos.
  const <String, Size>{
    '360x800': Size(360, 800),
    '430x932': Size(430, 932),
    '768x1024': Size(768, 1024),
  }.forEach((String label, Size size) {
    testWidgets('${label}_PORTRAIT_COMPOSITION = PASS', (WidgetTester tester) async {
      await pumpLoginPage(tester, repository, surfaceSize: size);
      expect(tester.takeException(), isNull, reason: 'no debe haber overflow en $label');

      expectExclusiveLayout(tester, 'login-portrait-layout');
      expect(hasHeroImage(tester), isTrue, reason: '$label: el hero de Guatapé debe estar presente en portrait');

      final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
      final bool hasDesktopLogo = images.any(
        (Image image) => resolvedAssetName(image.image) == 'assets/icons/korixa_logo_desktop.png',
      );
      expect(hasDesktopLogo, isFalse, reason: '$label: portrait nunca debe mostrar el logo de escritorio');

      expect(find.byType(TextFormField), findsNWidgets(2), reason: '$label: email + password');
      expect(find.byType(PrimaryGradientButton), findsOneWidget);
      expect(find.byType(GoogleSignInButton), findsOneWidget);
    });
  });

  // Aserciones explícitas pedidas por el encargo — el root-cause real
  // (1365x599) y su contraparte de teléfono en horizontal (932x430),
  // cada una probando exclusividad en ambas direcciones.
  testWidgets('1365x599_DESKTOP = YES', (WidgetTester tester) async {
    await pumpLoginPage(tester, repository, surfaceSize: const Size(1365, 599));
    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('login-desktop-layout')), findsOneWidget);
  });

  testWidgets('1365x599_PHONE_LANDSCAPE = NO', (WidgetTester tester) async {
    await pumpLoginPage(tester, repository, surfaceSize: const Size(1365, 599));
    expect(find.byKey(const Key('login-landscape-layout')), findsNothing);
  });

  testWidgets('932x430_PHONE_LANDSCAPE = YES', (WidgetTester tester) async {
    await pumpLoginPage(tester, repository, surfaceSize: const Size(932, 430));
    expect(find.byKey(const Key('login-landscape-layout')), findsOneWidget);
  });

  testWidgets('932x430_DESKTOP = NO', (WidgetTester tester) async {
    await pumpLoginPage(tester, repository, surfaceSize: const Size(932, 430));
    expect(find.byKey(const Key('login-desktop-layout')), findsNothing);
  });

  testWidgets('390x844_PORTRAIT = YES', (WidgetTester tester) async {
    await pumpLoginPage(tester, repository, surfaceSize: const Size(390, 844));
    expect(find.byKey(const Key('login-portrait-layout')), findsOneWidget);
  });

  testWidgets('GOOGLE_OFFICIAL_LOGO_USED = PASS (placeholder Icons.g_mobiledata ya no existe)',
      (WidgetTester tester) async {
    await pumpLoginPage(tester, repository);

    // El ícono placeholder de Material ya no debe existir en absoluto en
    // el árbol del botón de Google.
    final Finder placeholderIcon = find.descendant(
      of: find.byType(GoogleSignInButton),
      matching: find.byWidgetPredicate((Widget widget) => widget is Icon && widget.icon == Icons.g_mobiledata),
    );
    expect(placeholderIcon, findsNothing, reason: 'Icons.g_mobiledata debía ser reemplazado por el logo oficial');

    final Iterable<Image> images = tester.widgetList<Image>(
      find.descendant(of: find.byType(GoogleSignInButton), matching: find.byType(Image)),
    );
    final bool hasOfficialLogo = images.any(
      (Image image) => resolvedAssetName(image.image) == 'assets/icons/google_logo.png',
    );
    expect(hasOfficialLogo, isTrue, reason: 'el botón de Google debe usar el asset oficial local, no un ícono aproximado');
  });

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN02-LOGIN-FULL-LANDSCAPE-VISUAL-20260910 — el dueño
  // reportó el panel derecho anterior (bloque opaco de ancho fijo,
  // 43% en desktop / 56% en phone landscape) como "un bloque negro
  // grande" tapando el paisaje. Estos tests prueban el resultado
  // concreto: el hero cubre el ancho COMPLETO del viewport (ya no un
  // `Expanded` recortado) y el formulario flota en un panel de vidrio
  // (`BackdropFilter`) acotado, no un rectángulo opaco de medio
  // viewport.
  // ---------------------------------------------------------------------

  testWidgets('DESKTOP_HERO_FULL_BLEED_WIDTH = PASS', (WidgetTester tester) async {
    const Size desktopSize = Size(1440, 900);
    await pumpLoginPage(tester, repository, surfaceSize: desktopSize);

    final Size heroSize = tester.getSize(find.byKey(const Key('login-hero-image')));
    expect(
      heroSize.width,
      desktopSize.width,
      reason: 'el hero debe cubrir el ancho completo del viewport en desktop, no solo el 57% que ocupaba antes',
    );
  });

  testWidgets('DESKTOP_FORM_FLOATS_IN_GLASS_PANEL_NOT_OPAQUE_BLOCK = PASS', (WidgetTester tester) async {
    const Size desktopSize = Size(1440, 900);
    await pumpLoginPage(tester, repository, surfaceSize: desktopSize);

    expect(
      find.byType(BackdropFilter),
      findsOneWidget,
      reason: 'el formulario debe flotar sobre un panel de vidrio con blur real, no un DecoratedBox opaco',
    );

    final Size panelSize = tester.getSize(find.byType(BackdropFilter));
    expect(
      panelSize.width,
      lessThan(desktopSize.width * 0.5),
      reason: 'el panel debe ser una tarjeta acotada (ancho máximo 420 + padding), no ocupar la mitad del viewport como el bloque opaco anterior',
    );
  });

  testWidgets('PHONE_LANDSCAPE_HERO_FULL_BLEED_WIDTH = PASS', (WidgetTester tester) async {
    const Size landscapeSize = Size(932, 430);
    await pumpLoginPage(tester, repository, surfaceSize: landscapeSize);

    final Size heroSize = tester.getSize(find.byKey(const Key('login-hero-image')));
    expect(
      heroSize.width,
      landscapeSize.width,
      reason: 'el hero debe cubrir el ancho completo del viewport en phone landscape, no solo el 44% que ocupaba antes',
    );
  });

  testWidgets('PHONE_LANDSCAPE_FORM_FLOATS_IN_GLASS_PANEL = PASS', (WidgetTester tester) async {
    await pumpLoginPage(tester, repository, surfaceSize: const Size(932, 430));

    expect(
      find.byType(BackdropFilter),
      findsOneWidget,
      reason: 'el formulario debe flotar sobre un panel de vidrio con blur real, no un ColoredBox opaco',
    );
  });

  testWidgets('PORTRAIT_HAS_NO_GLASS_PANEL = PASS (composición sin cambios, sin panel flotante)',
      (WidgetTester tester) async {
    await pumpLoginPage(tester, repository, surfaceSize: const Size(390, 844));

    expect(
      find.byType(BackdropFilter),
      findsNothing,
      reason: 'mobile portrait no tiene panel flotante — el hero y el formulario ya estaban apilados verticalmente sin bloque opaco',
    );
  });
}
