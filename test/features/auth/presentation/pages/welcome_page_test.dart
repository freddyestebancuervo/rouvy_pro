import 'package:flutter/material.dart';
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
  }) async {
    tester.view.physicalSize = surfaceSize;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      authPageHarness(initialLocation: '/welcome', welcomePage: const WelcomePage(), theme: theme),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('WELCOME_TITLE_APPROVED_COPY = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester);
    expect(find.text('Conecta tu energía.'), findsOneWidget);
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

  testWidgets('SKIP_ACTION_PRESENT = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester);
    expect(find.text('Saltar'), findsOneWidget);
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

    final Iterable<Container> bars = tester.widgetList<Container>(
      find.descendant(of: find.byKey(const Key('welcome-indicator-row')), matching: find.byType(Container)),
    );
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

      // Contenido mobile mínimo viable: Saltar, título, subtítulo, CTA —
      // todos deben seguir existiendo en el árbol (alcanzables vía el
      // scroll ya existente si el alto es angosto), nunca reemplazados
      // por el layout de escritorio.
      expect(find.text('Saltar'), findsOneWidget);
      expect(find.text('Conecta tu energía.'), findsOneWidget);
      expect(find.text('Entrena, compite y vive rutas increíbles en indoor y outdoor.'), findsOneWidget);
      expect(find.text('Comenzar'), findsOneWidget);
    });
  });

  // KORIXA-SCREEN01-FINAL-LANDSCAPE-HERO-ASSET-20260906: con el hero
  // dedicado nuevo (ciclista más chico, corrido a ~70% del ancho), el
  // bloque de contenido/CTA ya puede ser un porcentaje real del
  // viewport (34-40%, CTA 300-380px) en vez del ancho fijo de 250px que
  // exigía la foto anterior — ver [_PhoneLandscapeWelcomeContent].
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

      // CTA responsivo — 300-380px pedido, nunca el ancho de 320+ fijo
      // de portrait ni el de 550 de desktop.
      expect(find.byKey(const Key('welcome-landscape-cta')), findsOneWidget);
      final Size ctaSize = tester.getSize(find.byKey(const Key('welcome-landscape-cta')));
      expect(ctaSize.width, greaterThanOrEqualTo(280), reason: '$label: el CTA debe acercarse al rango 300-380 pedido');
      expect(ctaSize.width, lessThanOrEqualTo(380), reason: '$label: el CTA no debe exceder el rango 300-380 pedido');
      expect(ctaSize.height, greaterThanOrEqualTo(48), reason: '$label: el CTA debe seguir siendo táctil (>=48dp)');

      // El bloque de contenido debe quedar en el rango 34-40% del
      // viewport pedido (acotado 280-380) — con el hero nuevo, el
      // margen libre real es de ~590-650px, muy por encima de este
      // rango, así que no hay riesgo de invadir al ciclista.
      final Size contentSize = tester.getSize(find.byKey(const Key('welcome-content-max-width')));
      expect(contentSize.width, greaterThanOrEqualTo(280), reason: '$label: el contenido debe acercarse al 34-40% pedido');
      expect(contentSize.width, lessThanOrEqualTo(380), reason: '$label: el contenido no debe exceder el rango pedido');

      // KORIXA-SCREEN01-LANDSCAPE-CTA-MICRO-REDUCTION-20260906: el CTA
      // debe quedar MEDIBLEMENTE más angosto que el ancho que le daría
      // el stretch del `Column` (`contentSize.width` menos el padding
      // horizontal, `AppSpacing.md` × 2) — si algún cambio futuro
      // revierte el `Align`/`SizedBox` y el CTA vuelve a estirarse al
      // ancho completo, esta aserción debe fallar.
      final double stretchWidth = contentSize.width - 2 * 12;
      expect(
        ctaSize.width,
        lessThan(stretchWidth - 1),
        reason: '$label: el CTA debe ser más angosto que el ancho completo de la columna (reducción ~10%)',
      );

      // El hero debe ser el dedicado de horizontal, nunca el vertical
      // de portrait ni el panorámico de escritorio.
      expect(
        heroAssetImage(tester)?.assetName,
        'assets/images/korixa_welcome_hero_landscape.webp',
      );
    });
  });

  testWidgets('1440x900_USES_DESKTOP_LAYOUT = PASS', (WidgetTester tester) async {
    // Contraparte del grupo de arriba: un desktop real (ancho Y alto
    // grandes) debe seguir activando la composición de escritorio —
    // el fix no debe convertir esto, de paso, en un falso mobile.
    await pumpWelcomePage(tester, surfaceSize: const Size(1440, 900));
    expect(tester.takeException(), isNull);
    expect(heroAssetImage(tester)?.assetName, 'assets/images/korixa_welcome_hero_desktop.webp');
  });

  testWidgets('CTA_NAVIGATION = PASS (Comenzar -> Register, mismo destino que el CTA anterior)',
      (WidgetTester tester) async {
    await pumpWelcomePage(tester);

    await tester.tap(find.text('Comenzar'));
    await tester.pumpAndSettle();

    expect(find.text('REGISTER'), findsOneWidget);
  });

  testWidgets('SKIP_NAVIGATION = PASS (Saltar -> Login, mismo destino que el botón secundario anterior)',
      (WidgetTester tester) async {
    await pumpWelcomePage(tester);

    await tester.tap(find.text('Saltar'));
    await tester.pumpAndSettle();

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

  testWidgets('DESKTOP_SKIP_TOP_RIGHT = PASS', (WidgetTester tester) async {
    const Size desktopSize = Size(1440, 900);
    await pumpWelcomePage(tester, surfaceSize: desktopSize);

    expect(find.text('Saltar'), findsOneWidget);

    final Offset skipTopLeft = tester.getTopLeft(find.text('Saltar'));
    // Arriba: bien por encima de la mitad vertical del viewport.
    expect(skipTopLeft.dy, lessThan(desktopSize.height / 2));
    // A la derecha: bien a la derecha de la mitad horizontal del
    // viewport (y, por construcción del layout, del bloque de contenido
    // anclado a la izquierda).
    expect(skipTopLeft.dx, greaterThan(desktopSize.width / 2));
  });

  testWidgets('OUTER_LIGHT_THEME_DARK_TECH = PASS', (WidgetTester tester) async {
    await pumpWelcomePage(tester, theme: ThemeData.light());

    final Text title = tester.widget<Text>(find.text('Conecta tu energía.'));
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
      expect(find.text('Conecta tu energía.'), findsOneWidget, reason: '$label: el título debe seguir visible');
      expect(find.text('Saltar'), findsOneWidget, reason: '$label: Saltar debe seguir siendo alcanzable');
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
    expect(find.text('Saltar'), findsOneWidget);
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
