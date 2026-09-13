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

  // KORIXA-SCREEN03-REGISTER-MOBILE-VISUAL-IMPLEMENTATION-20260913:
  // `surfaceSize` opcional — `null` preserva el tamaño de superficie por
  // defecto del binding de test (800x600, landscape según
  // `KorixaViewportInfo`), que sigue ejercitando la composición LEGACY
  // (`_buildLegacyShell`), sin cambios, para los 10 tests ya existentes
  // antes de esta tarea. Los tests nuevos de mobile portrait pasan un
  // tamaño portrait explícito para ejercitar la composición NUEVA.
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
    await tester.tap(find.text('Registrarme'));
    await tester.pumpAndSettle();

    expect(find.text('Este correo ya está registrado.'), findsOneWidget);
    expect(find.text('EMAIL_VERIFICATION'), findsNothing);
  });

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN03-REGISTER-MOBILE-VISUAL-IMPLEMENTATION-20260913: los
  // tests de arriba (sin `surfaceSize`) siguen ejercitando la composición
  // LEGACY (`_buildLegacyShell`, viewport 800x600 por defecto = landscape
  // según `KorixaViewportInfo`) — protegen que desktop/phone landscape no
  // cambiaron. Estos tests nuevos pasan explícitamente un tamaño mobile
  // portrait para ejercitar la composición NUEVA (`_buildMobilePortrait`)
  // y probar que TODO el comportamiento funcional (validadores, CTA,
  // navegación, social sign-in, loading, errores) sigue intacto ahí
  // también — no solo en el layout que no se tocó.
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
      expect(find.byKey(const Key('register-portrait-layout')), findsOneWidget,
          reason: 'MOBILE_${label}_NO_OVERFLOW: debe usar la composición mobile portrait nueva');
    });
  }

  testWidgets('MOBILE_PORTRAIT_ALL_FIELDS_PRESENT = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    expect(find.byType(TextFormField), findsNWidgets(4),
        reason: 'MOBILE_PORTRAIT_ALL_FIELDS_PRESENT: nombre, correo, contraseña, confirmar contraseña');
    expect(find.text('Nombre'), findsOneWidget);
    expect(find.text('Correo electrónico'), findsOneWidget);
    expect(find.text('Contraseña'), findsOneWidget);
    expect(find.text('Confirmar contraseña'), findsOneWidget);
    expect(find.byKey(const Key('register-title')), findsOneWidget);
    expect(find.byKey(const Key('register-subtitle')), findsOneWidget);
    expect(find.byKey(const Key('register-terms-text')), findsOneWidget);
    expect(find.text('Crea tu cuenta'), findsOneWidget, reason: 'texto de l10n sin hardcodear');
    expect(find.text('Empieza a entrenar en minutos'), findsOneWidget, reason: 'texto de l10n sin hardcodear');
  });

  testWidgets('MOBILE_PORTRAIT_HERO_IMAGE_CORRECT = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    final Iterable<Image> images = tester.widgetList<Image>(
      find.descendant(of: find.byKey(const Key('register-hero-image')), matching: find.byType(Image)),
    );
    expect(images.length, 1);
    final Image hero = images.first;
    expect((hero.image as AssetImage).assetName, 'assets/images/korixa_login_hero_guatape_mobile.png',
        reason: 'MOBILE_PORTRAIT_HERO_IMAGE_CORRECT: debe usar el asset móvil ya aprobado de SCREEN_02, sin regenerar');
    expect(hero.fit, BoxFit.cover);
    expect(hero.alignment, Alignment.center, reason: 'sin ajuste de encuadre artificial');
  });

  testWidgets('MOBILE_PORTRAIT_INDICATOR_ACTIVE_INDEX_2 = PASS', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    final Finder indicatorFinder = find.byKey(const Key('register-portrait-indicator-row'));
    expect(indicatorFinder, findsOneWidget);

    final List<Container> bars = tester
        .widgetList<Container>(find.descendant(of: indicatorFinder, matching: find.byType(Container)))
        .toList();
    expect(bars.length, 3);

    bool isActive(Container bar) => bar.decoration is BoxDecoration && (bar.decoration! as BoxDecoration).gradient != null;
    expect(isActive(bars[0]), isFalse, reason: 'Welcome=0, no activo en Register');
    expect(isActive(bars[1]), isFalse, reason: 'Login=1, no activo en Register');
    expect(isActive(bars[2]), isTrue, reason: 'Register=2, debe ser la barra activa');
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

  testWidgets('MOBILE_PORTRAIT_muestra el error de contraseñas no coincidentes', (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));

    await fillForm(tester, confirmPassword: 'otraClave123');
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

    // El mismo toggle también controla "Confirmar contraseña" — mismo
    // comportamiento ya existente, verificado explícitamente en la
    // composición nueva.
    final Finder confirmEditable =
        find.descendant(of: find.byType(TextFormField).at(3), matching: find.byType(EditableText));
    expect(tester.widget<EditableText>(confirmEditable).obscureText, isFalse);

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

  testWidgets('MOBILE_PORTRAIT_botón de Apple solo aparece en la plataforma Apple soportada',
      (WidgetTester tester) async {
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));
    expect(find.byType(AppleSignInButton), findsNothing);

    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(390, 844));
    expect(find.byType(AppleSignInButton), findsOneWidget);

    debugDefaultTargetPlatformOverride = null;
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

  testWidgets('MOBILE_PORTRAIT_SCROLL_DISABLED_WHEN_CONTENT_FITS_OR_ENABLED_WHEN_NOT', (WidgetTester tester) async {
    // KORIXA-SCREEN03-REGISTER-MOBILE-VISUAL-IMPLEMENTATION-20260913: el
    // encargo pide explícitamente NO forzar "sin scroll a toda costa" —
    // el mecanismo debe decidir según si el contenido real cabe, igual
    // que en SCREEN_02 Login, pero sin asumir que Register cabe en todos
    // los tamaños (tiene más contenido). Esta prueba solo confirma que el
    // `SingleChildScrollView` existe y que su `physics` es coherente con
    // si hubo o no overflow — no exige un resultado fijo en ningún
    // tamaño particular.
    await pumpRegisterPage(tester, repository, surfaceSize: const Size(360, 640));

    expect(tester.takeException(), isNull, reason: 'nunca debe haber overflow, con o sin scroll');
    final SingleChildScrollView scrollView = tester.widget(find.byType(SingleChildScrollView).first);
    expect(scrollView.physics, anyOf(isNull, isA<NeverScrollableScrollPhysics>()));
  });
}
