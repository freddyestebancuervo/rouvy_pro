import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/app/theme/app_colors.dart';
import 'package:rouvy_pro/core/design_system/dark_tech_buttons.dart';
import 'package:rouvy_pro/features/auth/presentation/pages/welcome_page.dart';

import 'auth_page_test_utils.dart';

/// KORIXA-UI-SCREEN-01-APPROVED-WELCOME-IMPLEMENTATION-20260904 /
/// KORIXA-UI-SCREEN01-ASSET-INTEGRATION-20260904.
void main() {
  Future<void> pumpWelcomePage(
    WidgetTester tester, {
    Size surfaceSize = const Size(390, 844),
    ThemeData? theme,
    Locale locale = const Locale('es'),
  }) async {
    tester.view.physicalSize = surfaceSize;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      authPageHarness(
        initialLocation: '/welcome',
        welcomePage: const WelcomePage(),
        theme: theme,
        locale: locale,
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('WELCOME_TITLE_APPROVED_COPY = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN01-REMOVE-TITLE-PERIOD-20260915: 'Conecta tu energía'
    // (antes 'Conecta tu energía.') — el dueño pidió quitar únicamente
    // el punto final.
    await pumpWelcomePage(tester);
    expect(find.text('Conecta tu energía'), findsOneWidget);
  });

  testWidgets('WELCOME_SUBTITLE_APPROVED_COPY = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester);
    expect(find.text('Entrena, compite y vive rutas increíbles en indoor y outdoor.'), findsOneWidget);
  });

  testWidgets('PRIMARY_CTA_LABEL = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester);
    expect(find.text('Comenzar'), findsOneWidget);
    expect(find.byType(PrimaryGradientButton), findsOneWidget);
  });

  testWidgets('SKIP_TEXT_NOT_PRESENT = PASS ("Saltar" ya no debe existir)', (WidgetTester tester) async {
    await pumpWelcomePage(tester);
    expect(find.text('Saltar'), findsNothing);
  });

  // KORIXA-WELCOME-SINGLE-CTA-NAVIGATION-PR127-20260910: el dueño pidió
  // un único CTA de entrada a autenticación en Welcome — la acción
  // secundaria "Iniciar sesión"/"Sign in" que vivía arriba a la derecha
  // se elimina por completo (no solo se oculta).
  testWidgets('SECONDARY_LOGIN_ACTION_ABSENT = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester);
    expect(find.text('Iniciar sesión'), findsNothing);
  });

  testWidgets('EN_SECONDARY_LOGIN_ACTION_ABSENT = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, locale: const Locale('en'));
    expect(find.text('Sign in'), findsNothing);
    expect(find.text('Skip'), findsNothing);
  });

  testWidgets('HERO_ASSET_PRESENT = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester);

    final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
    final bool hasHero = images.any((Image image) {
      final ImageProvider provider = image.image;
      return provider is AssetImage && provider.assetName == 'assets/images/korixa_welcome_hero.webp';
    });
    expect(hasHero, isTrue, reason: 'debe renderizar el hero aprobado como Image.asset real, no un placeholder');
  });

  AssetImage? heroAssetImage(WidgetTester tester) {
    final Iterable<Image> images = tester.widgetList<Image>(
      find.descendant(of: find.byKey(const Key('welcome-hero-image')), matching: find.byType(Image)),
    );
    final ImageProvider provider = images.single.image;
    return provider is AssetImage ? provider : null;
  }

  /// `Image.asset(cacheWidth:/cacheHeight:)` (usado por el logo de
  /// escritorio para decodificar con calidad — ver welcome_page.dart)
  /// envuelve el `AssetImage` resuelto en un `ResizeImage`, así que
  /// `provider is AssetImage` da `false` aunque el asset SÍ sea el
  /// esperado. Este helper desenvuelve ambos casos.
  String? resolvedAssetName(ImageProvider provider) {
    if (provider is AssetImage) return provider.assetName;
    if (provider is ResizeImage) {
      final ImageProvider inner = provider.imageProvider;
      if (inner is AssetImage) return inner.assetName;
    }
    return null;
  }

  testWidgets('MOBILE_USES_VERTICAL_HERO = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(390, 844));

    expect(heroAssetImage(tester)?.assetName, 'assets/images/korixa_welcome_hero.webp');
  });

  testWidgets('DESKTOP_USES_PANORAMIC_HERO = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(1440, 900));

    expect(heroAssetImage(tester)?.assetName, 'assets/images/korixa_welcome_hero_desktop.webp');
  });

  testWidgets('MOBILE_NO_FLOATING_LOGO = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN01-MOBILE-REMOVE-LOGO-AND-RAISE-CONTENT-20260906: el
    // dueño reportó el logo Korixa flotante sobre el hero de mobile como
    // un elemento extra ajeno a la foto (flotaba delante de la rueda
    // trasera). Se elimina — el único branding Korixa visible en mobile
    // debe ser el que ya está impreso en la foto del ciclista (jersey/
    // short/medias), nunca un logo de UI superpuesto ni un wordmark de
    // texto duplicado.
    await pumpWelcomePage(tester, surfaceSize: const Size(390, 844));

    final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
    final bool hasAnyLogoAsset = images.any((Image image) {
      final String? assetName = resolvedAssetName(image.image);
      return assetName == 'assets/icons/korixa_logo.png' || assetName == 'assets/icons/korixa_logo_desktop.png';
    });
    expect(hasAnyLogoAsset, isFalse, reason: 'mobile no debe renderizar ningún logo Korixa flotante');
    expect(find.text('Korixa'), findsNothing);
  });

  testWidgets('DESKTOP_LOGO_ASSET_PRESENT = PASS', (WidgetTester tester) async {
    // El logo SÍ sigue siendo parte de la composición de escritorio —
    // esta tarea es exclusivamente mobile (ver docblock de arriba).
    await pumpWelcomePage(tester, surfaceSize: const Size(1440, 900));

    final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
    final bool hasDesktopLogo = images.any(
      (Image image) => resolvedAssetName(image.image) == 'assets/icons/korixa_logo_desktop.png',
    );
    expect(hasDesktopLogo, isTrue, reason: 'el logo de escritorio no debe verse afectado por el cambio de mobile');
  });

  testWidgets('MOBILE_THREE_INDICATOR_LINES = PASS', (WidgetTester tester) async {
    // KORIXA-SCREEN01-MOBILE-ADD-THREE-INDICATOR-LINES-20260906: mobile
    // pasa de una píldora única a 3 barras (misma composición ya
    // aprobada para desktop) — 1 activa (gradiente de marca), 2
    // inactivas (`DarkTech.border`, gris oscuro).
    await pumpWelcomePage(tester, surfaceSize: const Size(390, 844));

    final List<Container> bars = tester
        .widgetList<Container>(
          find.descendant(of: find.byKey(const Key('welcome-indicator-row')), matching: find.byType(Container)),
        )
        .toList();
    expect(bars.length, 3, reason: 'el indicador de mobile debe mostrar exactamente 3 líneas');

    final int activeCount = bars.where((Container bar) => bar.decoration is BoxDecoration && (bar.decoration! as BoxDecoration).gradient != null).length;
    final int inactiveCount = bars
        .where(
          (Container bar) =>
              bar.decoration is BoxDecoration && (bar.decoration! as BoxDecoration).color == DarkTech.border,
        )
        .length;
    expect(activeCount, 1, reason: 'exactamente 1 línea debe quedar activa/resaltada');
    expect(inactiveCount, 2, reason: 'las otras 2 líneas deben quedar en gris inactivo');

    // KORIXA-SCREEN02-LOGIN-SUBTITLE-POSITION-CENTER-ACTIVE-INDICATOR-
    // 20260910: `ThreeBarIndicator` ganó un parámetro `activeIndex` para
    // que SCREEN_02 Login pueda activar su barra central sin tocar
    // Welcome — este test prueba explícitamente que Welcome sigue con
    // la PRIMERA barra activa (`activeIndex` default = 0), sin regresión.
    final bool firstBarActive =
        bars[0].decoration is BoxDecoration && (bars[0].decoration! as BoxDecoration).gradient != null;
    expect(firstBarActive, isTrue, reason: 'Welcome debe conservar la primera barra activa (activeIndex: 0, sin cambios)');
  });

  // KORIXA-SCREEN01-CENTER-PAGE-INDICATORS-20260910: en mobile portrait
  // la columna ya usa `crossAxisAlignment.stretch` (mismo ancho para el
  // indicador envuelto en `Center` y el CTA sin ancho propio), así que
  // ya deberían compartir centro — este test lo prueba explícitamente
  // en vez de asumirlo por la estructura.
  testWidgets('MOBILE_INDICATOR_CENTERED_OVER_CTA = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(390, 844));

    final Offset ctaCenter = tester.getCenter(find.byType(PrimaryGradientButton));
    final Offset indicatorCenter = tester.getCenter(find.byKey(const Key('welcome-indicator-row')));
    expect(
      indicatorCenter.dx,
      closeTo(ctaCenter.dx, 0.5),
      reason: 'el indicador debe compartir el centro horizontal exacto del CTA en mobile portrait',
    );
  });

  // KORIXA-SCREEN01-MOBILE-LANDSCAPE-FIX-20260906: clasificar el layout
  // solo por `maxWidth` hacía que un teléfono rotado a horizontal (ancho
  // > 700 tan fácilmente como un monitor) recibiera la composición de
  // escritorio completa. Estos 4 tamaños son teléfonos reales (portrait
  // y horizontal); ninguno debe activar desktop, sin importar qué tan
  // ancho se vea en horizontal — ver `_isDesktop` en welcome_page.dart.
  //
  // KORIXA-SCREEN01-FINAL-LANDSCAPE-HERO-ASSET-20260906: portrait y
  // horizontal ahora usan ARCHIVOS DE HERO DISTINTOS (cada uno el suyo,
  // nunca el panorámico de escritorio) — el mapa lleva el hero esperado
  // por tamaño en vez de asumir uno solo para los 4.
  const <String, (Size, String)>{
    '390x844 (portrait)': (Size(390, 844), 'assets/images/korixa_welcome_hero.webp'),
    '844x390 (landscape)': (Size(844, 390), 'assets/images/korixa_welcome_hero_landscape.webp'),
    '915x412 (landscape)': (Size(915, 412), 'assets/images/korixa_welcome_hero_landscape.webp'),
    '932x430 (landscape)': (Size(932, 430), 'assets/images/korixa_welcome_hero_landscape.webp'),
  }.forEach((String label, (Size, String) entry) {
    final (Size size, String expectedHero) = entry;
    testWidgets('${label}_USES_MOBILE_LAYOUT = PASS', (WidgetTester tester) async {
      await pumpWelcomePage(tester, surfaceSize: size);
      expect(tester.takeException(), isNull, reason: 'no debe haber overflow en $label');

      expect(
        heroAssetImage(tester)?.assetName,
        expectedHero,
        reason: '$label debe usar su hero dedicado (portrait o landscape, nunca el panorámico de escritorio)',
      );

      final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
      final bool hasDesktopLogo = images.any(
        (Image image) => resolvedAssetName(image.image) == 'assets/icons/korixa_logo_desktop.png',
      );
      expect(hasDesktopLogo, isFalse, reason: '$label no debe mostrar el logo de escritorio');

      // Contenido mobile mínimo viable: título, subtítulo, CTA — deben
      // seguir existiendo en el árbol (alcanzables vía el scroll ya
      // existente si el alto es angosto), nunca reemplazados por el
      // layout de escritorio. "Iniciar sesión" ya no existe (KORIXA-
      // WELCOME-SINGLE-CTA-NAVIGATION-PR127-20260910).
      expect(find.text('Iniciar sesión'), findsNothing);
      expect(find.text('Conecta tu energía'), findsOneWidget);
      expect(find.text('Entrena, compite y vive rutas increíbles en indoor y outdoor.'), findsOneWidget);
      expect(find.text('Comenzar'), findsOneWidget);
    });
  });

  // KORIXA-SCREEN01-FINAL-LANDSCAPE-HERO-ASSET-20260906: con el hero
  // dedicado nuevo (ciclista más chico, corrido a ~70% del ancho), el
  // bloque de contenido/CTA ya puede ser un porcentaje real del
  // viewport en vez del ancho fijo de 250px que exigía la foto anterior
  // — ver [_PhoneLandscapeWelcomeContent].
  //
  // KORIXA-SCREEN01-SCREEN02-MATCH-SCREEN03-CONTAINER-WIDTH-20260915:
  // rangos actualizados a la fórmula EXACTA ya aprobada en
  // `RegisterPage._buildPhoneLandscape` (SCREEN_03 — fuente de verdad
  // única): `(width * 0.3696).clamp(270.0, 343.2)` — antes
  // `(width * 0.40).clamp(280.0, 380.0)`. El contenido resultante es
  // MEDIBLEMENTE más angosto ("contenedor más flaco", pedido
  // explícitamente por el owner), así que el rango del CTA (derivado del
  // contenido) también se angosta proporcionalmente.
  const <String, Size>{
    '844x390': Size(844, 390),
    '915x412': Size(915, 412),
    '932x430': Size(932, 430),
  }.forEach((String label, Size size) {
    testWidgets('${label}_PHONE_LANDSCAPE_COMPOSITION = PASS', (WidgetTester tester) async {
      await pumpWelcomePage(tester, surfaceSize: size);
      expect(tester.takeException(), isNull, reason: 'no debe haber overflow en $label');

      // 3 indicadores, igual que portrait/desktop — ver `_ThreeBarIndicator`.
      final Iterable<Container> bars = tester.widgetList<Container>(
        find.descendant(of: find.byKey(const Key('welcome-indicator-row')), matching: find.byType(Container)),
      );
      expect(bars.length, 3, reason: '$label debe mostrar exactamente 3 líneas indicadoras');

      // KORIXA-SCREEN01-SCREEN02-CONTROLS-MATCH-RENDERED-TITLE-LENGTH-
      // 20260915: el CTA ya NO es un porcentaje de `contentMaxWidth`
      // (fórmula de SCREEN_03) ni los 630px del contenedor del título
      // (error de la iteración previa) — debe aproximarse al largo REAL
      // renderizado del texto del título "Conecta tu energía." (mismo
      // estilo: `titleLarge` + fontSize 32 + w800) + el margen de
      // seguridad de 8px.
      expect(find.byKey(const Key('welcome-landscape-cta')), findsOneWidget);
      final Size ctaSize = tester.getSize(find.byKey(const Key('welcome-landscape-cta')));
      final double renderedTitleWidth = tester
          .renderObject<RenderParagraph>(find.byKey(const Key('welcome-title')))
          .getMaxIntrinsicWidth(double.infinity);
      final double expectedCtaWidth = renderedTitleWidth + 8.0;
      expect(
        ctaSize.width,
        closeTo(expectedCtaWidth, 0.5),
        reason: '$label: CONTROL_WIDTH debe aproximarse a RENDERED_TITLE_TEXT_WIDTH + 8px de margen',
      );
      expect(ctaSize.height, 56, reason: '$label: el alto del CTA NO debe cambiar por esta tarea');

      // KORIXA-SCREEN01-CENTER-PAGE-INDICATORS-20260910: el indicador
      // debe compartir el centro horizontal exacto del CTA, no quedar
      // estirado/alineado a la izquierda del ancho completo de columna
      // — coherencia visual con el bloque compacto, pedida explícitamente
      // por KORIXA-SCREEN01-SCREEN02-CONTROLS-MATCH-RENDERED-TITLE-
      // LENGTH-20260915.
      final Offset ctaCenter = tester.getCenter(find.byKey(const Key('welcome-landscape-cta')));
      final Offset indicatorCenter = tester.getCenter(find.byKey(const Key('welcome-indicator-row')));
      expect(
        indicatorCenter.dx,
        closeTo(ctaCenter.dx, 0.5),
        reason: '$label: el indicador debe compartir el centro horizontal exacto del CTA',
      );

      // El bloque de SUBTÍTULO (ya no incluye indicador/CTA, ver arriba)
      // debe quedar en el rango de SCREEN_03 (270-343.2, fórmula
      // `(width * 0.3696).clamp(270.0, 343.2)`) — SIN CAMBIOS por esta
      // tarea, que solo tocó el CTA/indicador.
      final Size contentSize = tester.getSize(find.byKey(const Key('welcome-content-max-width')));
      expect(contentSize.width, greaterThanOrEqualTo(270.0), reason: '$label: el contenido debe respetar el clamp mínimo de SCREEN_03');
      expect(contentSize.width, lessThanOrEqualTo(343.2), reason: '$label: el contenido no debe exceder el clamp máximo de SCREEN_03');

      // El hero debe ser el dedicado de horizontal, nunca el vertical
      // de portrait ni el panorámico de escritorio.
      expect(
        heroAssetImage(tester)?.assetName,
        'assets/images/korixa_welcome_hero_landscape.webp',
      );
    });
  });

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN01-SCREEN02-MATCH-SCREEN03-CONTAINER-WIDTH-20260915:
  // verifica el ancho exacto del bloque de contenido contra la MISMA
  // fórmula ya aprobada en `RegisterPage._buildPhoneLandscape` (SCREEN_03
  // — fuente de verdad), en los 5 viewports obligatorios (incluyendo los
  // 2 que el grupo de arriba no cubría: 740x360, 812x375).
  // ---------------------------------------------------------------------
  const List<(Size, double)> screen03MatchedWidths = <(Size, double)>[
    (Size(740, 360), 273.5),
    (Size(812, 375), 300.1),
    (Size(844, 390), 311.9),
    (Size(915, 412), 338.2),
    (Size(932, 430), 343.2),
  ];

  for (final (Size size, double expectedWidth) in screen03MatchedWidths) {
    testWidgets(
      'WELCOME_LANDSCAPE_${size.width.toInt()}x${size.height.toInt()}_MATCHES_SCREEN03_WIDTH = PASS',
      (WidgetTester tester) async {
        await pumpWelcomePage(tester, surfaceSize: size);
        expect(tester.takeException(), isNull);

        final double width = tester.getSize(find.byKey(const Key('welcome-content-max-width'))).width;
        expect(
          width,
          closeTo(expectedWidth, 0.5),
          reason: 'WELCOME_LANDSCAPE_${size.width.toInt()}x${size.height.toInt()}_MATCHES_SCREEN03_WIDTH: '
              'ancho=$width, esperado≈$expectedWidth (misma fórmula que SCREEN_03)',
        );
      },
    );
  }

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN01-SCREEN02-CONTROLS-MATCH-RENDERED-TITLE-LENGTH-
  // 20260915: el CTA "Comenzar" debe aproximarse al largo REAL
  // renderizado del texto del título "Conecta tu energía." (32px/w800) +
  // el margen de seguridad de 8px, en los 5 viewports obligatorios.
  // ---------------------------------------------------------------------
  const List<Size> controlsMatchRenderedTitleLengthViewports = <Size>[
    Size(740, 360),
    Size(812, 375),
    Size(844, 390),
    Size(915, 412),
    Size(932, 430),
  ];

  for (final Size size in controlsMatchRenderedTitleLengthViewports) {
    testWidgets(
      'WELCOME_LANDSCAPE_${size.width.toInt()}x${size.height.toInt()}_CONTROLS_MATCH_RENDERED_TITLE_LENGTH = PASS',
      (WidgetTester tester) async {
        await pumpWelcomePage(tester, surfaceSize: size);
        expect(tester.takeException(), isNull, reason: 'no debe haber overflow en ${size.width.toInt()}x${size.height.toInt()}');

        final double renderedTitleWidth = tester
            .renderObject<RenderParagraph>(find.byKey(const Key('welcome-title')))
            .getMaxIntrinsicWidth(double.infinity);
        final double ctaWidth = tester.getSize(find.byKey(const Key('welcome-landscape-cta'))).width;
        final double ctaHeight = tester.getSize(find.byKey(const Key('welcome-landscape-cta'))).height;
        final double expectedCtaWidth = renderedTitleWidth + 8.0;

        expect(
          ctaWidth,
          closeTo(expectedCtaWidth, 0.5),
          reason: 'CONTROL_WIDTH debe aproximarse a RENDERED_TITLE_TEXT_WIDTH + 8px de margen '
              '(RENDERED_TITLE_TEXT_WIDTH=$renderedTitleWidth, CONTROL_WIDTH=$ctaWidth, '
              'DIFFERENCE_PX=${(ctaWidth - renderedTitleWidth).abs()})',
        );
        expect(ctaHeight, 56, reason: 'CONTROL_HEIGHT_CHANGED debe ser NO');
      },
    );
  }

  // ---------------------------------------------------------------------
  // KORIXA-SCREEN01-SCREEN02-TITLE-SINGLE-LINE-LANDSCAPE-20260915: el
  // título debe quedar en UNA sola línea en los 5 viewports requeridos,
  // sin ensanchar el bloque de contenido (`welcome-content-max-width`,
  // que sigue midiendo exactamente lo mismo que antes, ver el grupo de
  // arriba) y sin reducir `fontSize`.
  // ---------------------------------------------------------------------
  const List<Size> titleSingleLineViewports = <Size>[
    Size(740, 360),
    Size(812, 375),
    Size(844, 390),
    Size(915, 412),
    Size(932, 430),
  ];

  for (final Size size in titleSingleLineViewports) {
    testWidgets(
      'WELCOME_LANDSCAPE_${size.width.toInt()}x${size.height.toInt()}_TITLE_SINGLE_LINE = PASS',
      (WidgetTester tester) async {
        await pumpWelcomePage(tester, surfaceSize: size);
        expect(tester.takeException(), isNull, reason: 'no debe haber overflow en ${size.width.toInt()}x${size.height.toInt()}');

        final RenderParagraph titleParagraph = tester.renderObject<RenderParagraph>(find.byKey(const Key('welcome-title')));
        expect(
          titleParagraph.didExceedMaxLines,
          isFalse,
          reason: 'WELCOME_LANDSCAPE_${size.width.toInt()}x${size.height.toInt()}_TITLE_SINGLE_LINE: '
              '"Conecta tu energía." debe entrar en una sola línea',
        );

        // fontSize/fontWeight no cambian por esta tarea (ya eran 32/w800).
        final Text title = tester.widget<Text>(find.byKey(const Key('welcome-title')));
        expect(title.style?.fontSize, 32);
        expect(title.style?.fontWeight, FontWeight.w800);

        // El ancho del bloque de campos/CTA/subtítulo NO debe cambiar
        // (sigue dentro del clamp de SCREEN_03, 270-343.2).
        final double contentWidth = tester.getSize(find.byKey(const Key('welcome-content-max-width'))).width;
        expect(contentWidth, greaterThanOrEqualTo(270.0));
        expect(contentWidth, lessThanOrEqualTo(343.2));
      },
    );
  }

  testWidgets('1440x900_USES_DESKTOP_LAYOUT = PASS', (WidgetTester tester) async {
    // Contraparte del grupo de arriba: un desktop real (ancho Y alto
    // grandes) debe seguir activando la composición de escritorio —
    // el fix no debe convertir esto, de paso, en un falso mobile.
    await pumpWelcomePage(tester, surfaceSize: const Size(1440, 900));
    expect(tester.takeException(), isNull);
    expect(heroAssetImage(tester)?.assetName, 'assets/images/korixa_welcome_hero_desktop.webp');
  });

  // KORIXA-WELCOME-SINGLE-CTA-NAVIGATION-PR127-20260910: "Comenzar" es
  // ahora el único CTA de entrada a autenticación y navega a Login (no
  // a Register) — ver docblock de `WelcomePage`.
  testWidgets('CTA_NAVIGATION = PASS (Comenzar -> Login)', (WidgetTester tester) async {
    await pumpWelcomePage(tester);

    await tester.tap(find.text('Comenzar'));
    await tester.pumpAndSettle();

    expect(find.text('LOGIN'), findsOneWidget);
  });

  testWidgets('REGISTER_NOT_DIRECTLY_REACHABLE_FROM_WELCOME = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester);

    // Único CTA de la pantalla; ya se prueba arriba que navega a Login,
    // nunca a Register directamente.
    await tester.tap(find.text('Comenzar'));
    await tester.pumpAndSettle();

    expect(find.text('REGISTER'), findsNothing);
    expect(find.text('LOGIN'), findsOneWidget);
  });

  testWidgets('390x844_NO_OVERFLOW = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(390, 844));
    expect(tester.takeException(), isNull);
  });

  testWidgets('320x568_NO_OVERFLOW = PASS', (WidgetTester tester) async {
    // iPhone SE-ish: uno de los viewports más chicos que la app soporta
    // hoy — si el layout se desborda, `flutter_test` lo reporta como una
    // excepción de renderizado (no como un simple fallo de `expect`).
    await pumpWelcomePage(tester, surfaceSize: const Size(320, 568));
    expect(tester.takeException(), isNull);
  });

  testWidgets('1440x900_NO_OVERFLOW = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(1440, 900));
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'DESKTOP_HERO_FULL_VIEWPORT = PASS (hero panorámico a pantalla completa, sin acotar a un panel)',
      (WidgetTester tester) async {
    const Size desktopSize = Size(1440, 900);
    await pumpWelcomePage(tester, surfaceSize: desktopSize);

    // KORIXA-UI-SCREEN01-DESKTOP-HERO-CORRECTION-20260905: el hero cubre
    // el viewport de escritorio COMPLETO — no un panel de 480px centrado
    // ("phone stage") como en la iteración rechazada por el dueño.
    final Size heroSize = tester.getSize(find.byKey(const Key('welcome-hero-image')));
    expect(heroSize.width, desktopSize.width);
    expect(heroSize.height, desktopSize.height);
  });

  testWidgets(
      'DESKTOP_PHONE_STAGE_REMOVED = PASS (ningún elemento visual queda acotado a 480px de ancho en desktop)',
      (WidgetTester tester) async {
    const Size desktopSize = Size(1440, 900);
    await pumpWelcomePage(tester, surfaceSize: desktopSize);

    // El workaround rechazado dejaba el hero Y el contenido acotados a
    // exactamente 480px de ancho, centrados, con fondo Dark Tech sobrante
    // a los costados ("un teléfono flotando en un fondo de escritorio").
    // Acá el hero es panorámico completo y el bloque de contenido es
    // "materially larger" (560) que el propio ancho de mobile (480).
    final Size heroSize = tester.getSize(find.byKey(const Key('welcome-hero-image')));
    expect(heroSize.width, isNot(480));
    expect(heroSize.width, greaterThan(480));

    final Size contentSize = tester.getSize(find.byKey(const Key('welcome-content-max-width')));
    expect(contentSize.width, greaterThan(480));
  });

  testWidgets('DESKTOP_CTA_VISIBLE = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(1440, 900));

    expect(find.text('Comenzar'), findsOneWidget);
    expect(find.byType(PrimaryGradientButton), findsOneWidget);

    // CTA "desktop-appropriate": ni el ancho completo del viewport, ni el
    // tamaño mobile — un ancho fijo intermedio (ver `welcome_page.dart`).
    final Size ctaSize = tester.getSize(find.byKey(const Key('welcome-desktop-cta')));
    expect(ctaSize.width, lessThan(1440));
    expect(ctaSize.width, greaterThan(200));
  });

  // KORIXA-SCREEN01-CENTER-PAGE-INDICATORS-20260910: el dueño reportó el
  // indicador de 3 barras pegado al borde izquierdo de la columna en vez
  // de centrado sobre el CTA "Comenzar" — este test prueba el centro
  // horizontal real (no solo que ambos existan).
  testWidgets('DESKTOP_INDICATOR_CENTERED_OVER_CTA = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(1440, 900));

    final Offset ctaCenter = tester.getCenter(find.byKey(const Key('welcome-desktop-cta')));
    final Offset indicatorCenter = tester.getCenter(find.byKey(const Key('welcome-indicator-row')));
    expect(
      indicatorCenter.dx,
      closeTo(ctaCenter.dx, 0.5),
      reason: 'el indicador debe compartir el centro horizontal exacto del CTA, no quedar alineado a la izquierda',
    );
  });

  testWidgets('DESKTOP_SECONDARY_LOGIN_ACTION_ABSENT = PASS', (WidgetTester tester) async {
    const Size desktopSize = Size(1440, 900);
    await pumpWelcomePage(tester, surfaceSize: desktopSize);

    expect(find.text('Iniciar sesión'), findsNothing);
  });

  testWidgets('OUTER_LIGHT_THEME_DARK_TECH = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, theme: ThemeData.light());

    final Text title = tester.widget<Text>(find.text('Conecta tu energía'));
    expect(title.style?.color, DarkTech.textPrimary);
  });

  // ---------------------------------------------------------------------
  // KORIXA-RESPONSIVE-FOUNDATION-V1-SCREEN01-20260907 — matriz completa.
  //
  // Bug real reproducido: un laptop con `1365x599` (chrome del navegador
  // reduciendo el alto) caía en la composición de teléfono en horizontal
  // porque la regla vieja exigía `shortestSide > 600` para CUALQUIER
  // ancho. La fundación (`KorixaViewportInfo.canFitWideLayout`, ver
  // `core/responsive/korixa_viewport.dart`) lo corrige reconociendo que
  // un ancho ya "expanded" (>=1024 — ningún teléfono real llega ahí en
  // ninguna orientación) basta por sí solo, sin importar el alto.
  // ---------------------------------------------------------------------

  bool hasDesktopLogo(WidgetTester tester) {
    final Iterable<Image> images = tester.widgetList<Image>(find.byType(Image));
    return images.any((Image image) => resolvedAssetName(image.image) == 'assets/icons/korixa_logo_desktop.png');
  }

  const List<(String, Size, String)> desktopViewports = <(String, Size, String)>[
    ('800x600', Size(800, 600), 'assets/images/korixa_welcome_hero_desktop.webp'),
    ('1024x768', Size(1024, 768), 'assets/images/korixa_welcome_hero_desktop.webp'),
    ('1280x600', Size(1280, 600), 'assets/images/korixa_welcome_hero_desktop.webp'),
    ('1365x599', Size(1365, 599), 'assets/images/korixa_welcome_hero_desktop.webp'),
    ('1366x768', Size(1366, 768), 'assets/images/korixa_welcome_hero_desktop.webp'),
    ('1440x900', Size(1440, 900), 'assets/images/korixa_welcome_hero_desktop.webp'),
    ('1536x864', Size(1536, 864), 'assets/images/korixa_welcome_hero_desktop.webp'),
    ('1920x1080', Size(1920, 1080), 'assets/images/korixa_welcome_hero_desktop.webp'),
    ('2560x1440', Size(2560, 1440), 'assets/images/korixa_welcome_hero_desktop.webp'),
  ];

  for (final (String label, Size size, String expectedHero) in desktopViewports) {
    testWidgets('${label}_DESKTOP_COMPOSITION = PASS', (WidgetTester tester) async {
      await pumpWelcomePage(tester, surfaceSize: size);
      expect(tester.takeException(), isNull, reason: 'no debe haber overflow en $label');

      expect(heroAssetImage(tester)?.assetName, expectedHero, reason: '$label debe usar el hero panorámico de escritorio');
      expect(hasDesktopLogo(tester), isTrue, reason: '$label debe mostrar el logo de escritorio');
      expect(find.byType(PrimaryGradientButton), findsOneWidget, reason: '$label: el CTA de escritorio debe existir');
      expect(find.byKey(const Key('welcome-desktop-cta')), findsOneWidget, reason: '$label: debe ser el CTA de escritorio, no el de teléfono en horizontal');
      expect(find.text('Conecta tu energía'), findsOneWidget, reason: '$label: el título debe seguir visible');
      expect(find.text('Iniciar sesión'), findsNothing, reason: '$label: la acción secundaria ya no existe');
    });
  }

  // KORIXA-SCREEN01-RESPONSIVE-LOGO-QUALITY-FIX-20260907: el dueño
  // rechazó la reducción fluida del logo de escritorio (120-188 según
  // el alto disponible) introducida por la fundación — el logo
  // aprobado debe verse SIEMPRE a 188, incluido el caso real que
  // motivó todo esto (1365x599). Este test cierra ese hueco: antes de
  // este fix, habría fallado a 1365x599 (esperaría 188 pero mediría
  // ~167.7).
  for (final (String label, Size size, String _) in desktopViewports) {
    testWidgets('${label}_DESKTOP_LOGO_HEIGHT_188 = PASS (la marca no es una variable de layout)', (WidgetTester tester) async {
      await pumpWelcomePage(tester, surfaceSize: size);

      final Size logoSize = tester.getSize(find.byKey(const Key('welcome-desktop-logo')));
      expect(logoSize.height, 188, reason: '$label: el logo de escritorio debe verse siempre a 188, sin importar el alto disponible');
    });
  }

  testWidgets('1365x599_DESKTOP = YES (root cause del bug real, ahora corregido)', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(1365, 599));
    expect(tester.takeException(), isNull, reason: 'no debe haber overflow al alto reducido');

    expect(heroAssetImage(tester)?.assetName, 'assets/images/korixa_welcome_hero_desktop.webp');
    expect(hasDesktopLogo(tester), isTrue);
    expect(find.byKey(const Key('welcome-desktop-cta')), findsOneWidget);
  });

  testWidgets('1365x599_PHONE_LANDSCAPE = NO', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(1365, 599));

    expect(find.byKey(const Key('welcome-landscape-cta')), findsNothing, reason: '1365x599 NUNCA debe usar el CTA de teléfono en horizontal');
    expect(heroAssetImage(tester)?.assetName, isNot('assets/images/korixa_welcome_hero_landscape.webp'));
  });

  testWidgets('932x430_PHONE_LANDSCAPE = YES', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(932, 430));

    expect(heroAssetImage(tester)?.assetName, 'assets/images/korixa_welcome_hero_landscape.webp');
    expect(find.byKey(const Key('welcome-landscape-cta')), findsOneWidget);
  });

  testWidgets('932x430_DESKTOP = NO', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(932, 430));

    expect(hasDesktopLogo(tester), isFalse, reason: '932x430 es un teléfono rotado, nunca debe mostrar el logo de escritorio');
    expect(find.byKey(const Key('welcome-desktop-cta')), findsNothing);
  });

  // Portrait "grande" (tablet) — el encargo pide explícitamente que
  // pueda reusar la composición portrait ya aprobada en vez de forzar
  // una composición nueva o la de escritorio (pensada para un hero
  // landscape, no para un viewport más alto que ancho).
  testWidgets('768x1024_TABLET_PORTRAIT_VALID_NO_OVERFLOW = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, surfaceSize: const Size(768, 1024));
    expect(tester.takeException(), isNull, reason: 'no debe haber overflow en 768x1024');

    expect(heroAssetImage(tester)?.assetName, 'assets/images/korixa_welcome_hero.webp', reason: 'tablet portrait reusa el hero/composición portrait ya aprobada');
    expect(hasDesktopLogo(tester), isFalse, reason: 'portrait nunca debe mostrar el logo de escritorio');
    expect(find.text('Comenzar'), findsOneWidget, reason: 'el CTA debe seguir siendo alcanzable');
    expect(find.text('Iniciar sesión'), findsNothing);
  });

  // Barrido de no-overflow adicional a los ya existentes (320x568,
  // 390x844, 1440x900) — cubre el resto de anchos/altos representativos
  // pedidos explícitamente por el encargo.
  const List<Size> noOverflowSweep = <Size>[
    Size(360, 800),
    Size(390, 844),
    Size(430, 932),
    Size(844, 390),
    Size(915, 412),
    Size(932, 430),
    Size(768, 1024),
    Size(800, 600),
    Size(1024, 768),
    Size(1280, 600),
    Size(1365, 599),
    Size(1366, 768),
    Size(1440, 900),
    Size(1536, 864),
    Size(1920, 1080),
    Size(2560, 1440),
  ];

  for (final Size size in noOverflowSweep) {
    testWidgets('${size.width.toInt()}x${size.height.toInt()}_WIDGET_MATRIX_NO_OVERFLOW = PASS', (WidgetTester tester) async {
      await pumpWelcomePage(tester, surfaceSize: size);
      expect(tester.takeException(), isNull, reason: 'no debe haber overflow en ${size.width.toInt()}x${size.height.toInt()}');
    });
  }
}
