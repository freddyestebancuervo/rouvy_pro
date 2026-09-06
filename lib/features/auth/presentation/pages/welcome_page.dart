import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/app_colors.dart';
import '../../../../app/theme/app_gradients.dart';
import '../../../../app/theme/app_radius.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_theme.dart';
import '../../../../core/design_system/dark_tech_buttons.dart';
import '../../../../l10n/generated/app_localizations.dart';

/// Pantalla de bienvenida (marketing/onboarding previo al login). No tiene
/// lógica de negocio: solo dirige a Registro o Login.
///
/// KORIXA-UI-SCREEN-01-APPROVED-WELCOME — implementa el diseño hero
/// aprobado por el dueño: foto de ciclista a pantalla completa, "Saltar"
/// arriba a la derecha, marca/título/subtítulo/indicadores/CTA anclados
/// abajo con degradado de lectura.
///
/// Deliberadamente NO reusa `DarkTechAuthShell` (compartido con Login/
/// Register): ese shell está construido para un formulario centrado y
/// scrolleable de ancho acotado — el hero de pantalla completa con
/// contenido anclado al fondo es una composición distinta que no encaja
/// ahí sin forzarla. Login/Register no se tocan en absoluto en esta
/// tarea.
///
/// KORIXA-UI-SCREEN01-DESKTOP-HERO-CORRECTION-20260905: la iteración
/// anterior (ver historial de este archivo) reaccionaba a la relación de
/// aspecto retrato del hero mobile (`korixa_welcome_hero.webp`,
/// 1440×2560) acotando TODA la composición — hero incluido — a un
/// panel central de 480px en viewports anchos ("stage"). El dueño
/// rechazó ese resultado: en desktop se veía como "un teléfono flotando
/// en un fondo de escritorio", no como una pantalla de bienvenida de
/// escritorio real.
///
/// La corrección no es un ajuste de alineamiento — es un asset distinto.
/// En viewports anchos (`> _desktopBreakpoint`) esta pantalla usa un
/// segundo hero panorámico dedicado (`korixa_welcome_hero_desktop.webp`,
/// aprobado por el dueño, ~16:9) a pantalla completa (ver
/// [_DesktopWelcomeContent]), con el contenido anclado a la izquierda en
/// vez de abajo — igual que el hero vertical nunca estuvo pensado para
/// cubrir un viewport panorámico, el hero panorámico tampoco está
/// pensado para un layout de contenido anclado abajo estilo mobile.
class WelcomePage extends StatelessWidget {
  const WelcomePage({super.key});

  /// Por debajo de este ancho lógico: hero vertical + contenido anclado
  /// abajo ("fullscreen hero vertical, estilo app real"). Por encima:
  /// hero panorámico + contenido anclado a la izquierda — ver docblock
  /// de la clase.
  static const double _desktopBreakpoint = 700;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Theme(
      data: AppTheme.darkTech,
      child: Scaffold(
        backgroundColor: DarkTech.background,
        body: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            return constraints.maxWidth > _desktopBreakpoint
                ? _DesktopWelcomeContent(l10n: l10n)
                : _MobileWelcomeContent(l10n: l10n);
          },
        ),
      ),
    );
  }
}

/// Composición mobile (hero vertical + degradado + Saltar +
/// marca/título/subtítulo/indicador/CTA anclados abajo). Sin cambios
/// respecto a la versión aprobada — la corrección de esta tarea es
/// exclusivamente de escritorio (ver [_DesktopWelcomeContent]).
class _MobileWelcomeContent extends StatelessWidget {
  const _MobileWelcomeContent({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    // `context` acá ya está por debajo del `Theme(data: AppTheme.darkTech)`
    // insertado por `WelcomePage` (este widget es un hijo real del árbol,
    // no un valor pre-calculado por un ancestro con SU PROPIO context —
    // ver el defecto ya corregido una vez en `DarkTechAuthShell`).
    final TextTheme textTheme = Theme.of(context).textTheme;

    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        // Decorativo — el título/subtítulo ya describen la propuesta de
        // valor en texto, así que la foto se excluye de la semántica en
        // vez de duplicarla (Sección 9: "image marked decorative").
        const ExcludeSemantics(
          key: Key('welcome-hero-image'),
          child: _HeroImage(),
        ),
        // Degradado de lectura — mismo token que usan las cards de ruta
        // (`DarkTechRouteImage`), nunca un gradiente ad hoc.
        const Positioned.fill(
          child: DecoratedBox(decoration: BoxDecoration(gradient: AppGradients.imageScrimBottom)),
        ),
        SafeArea(
          child: Align(
            alignment: Alignment.topRight,
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: _SkipButton(
                label: l10n.welcomeSkipAction,
                // "Saltar" = saltar el pitch de bienvenida directo a
                // iniciar sesión — reusa exactamente el destino que ya
                // tenía el botón secundario anterior ("Ya tengo cuenta"
                // → login), no inventa un flujo nuevo ni evade el guard
                // de autenticación (Login sigue siendo una auth route
                // legítima).
                onTap: () => context.go(AppRoute.login),
              ),
            ),
          ),
        ),
        SafeArea(
          child: Align(
            alignment: Alignment.bottomCenter,
            child: ConstrainedBox(
              key: const Key('welcome-content-max-width'),
              constraints: const BoxConstraints(maxWidth: 480),
              child: SingleChildScrollView(
                // `reverse: true`: en una pantalla muy chica o con texto
                // muy escalado, lo primero que debe seguir visible es el
                // CTA (el final del contenido) — el scroll parte
                // mostrando el final.
                reverse: true,
                // KORIXA-SCREEN01-MOBILE-REMOVE-LOGO-AND-RAISE-CONTENT-
                // 20260906: el inset inferior sube de `AppSpacing.lg` (20)
                // a 32 — el dueño reportó el bloque de texto/CTA como
                // "pesado"/pegado al borde inferior. Como este bloque
                // está anclado abajo (`Align(bottomCenter)` más arriba),
                // el único control real sobre su posición vertical es
                // este padding inferior: subirlo desplaza TODO el bloque
                // (título→CTA) hacia arriba en bloque. Un primer intento
                // con 56 empujaba el título directo sobre los rayos de la
                // rueda trasera (colisión real, no solo visual ajustada);
                // 32 deja el bloque más alto que el original sin invadir
                // la rueda — verificado con una captura real a 390×844.
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.xl,
                  AppSpacing.xl,
                  AppSpacing.xl,
                  32,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    // KORIXA-SCREEN01-MOBILE-REMOVE-LOGO-AND-RAISE-
                    // CONTENT-20260906: el logo Korixa flotante (`
                    // _KorixaLogo`) se elimina de mobile — el dueño lo
                    // reportó como un elemento extra "flotando" delante
                    // de la rueda trasera, sin relación con la foto. El
                    // único branding Korixa visible en mobile ahora es el
                    // que ya está integrado en la foto (jersey/short/
                    // medias del ciclista) — nada de branding "de UI"
                    // superpuesto. El logo de escritorio (`_DesktopWelcomeContent`)
                    // no se toca: sigue siendo una composición distinta.
                    Text(
                      l10n.welcomeTitle,
                      textAlign: TextAlign.center,
                      style: textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Text(
                      l10n.welcomeSubtitle,
                      textAlign: TextAlign.center,
                      style: textTheme.bodyLarge?.copyWith(color: DarkTech.textSecondary),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    const Center(child: _OnboardingIndicator()),
                    const SizedBox(height: AppSpacing.lg),
                    PrimaryGradientButton(
                      label: l10n.welcomeGetStarted,
                      // "Comenzar" = mismo destino que antes tenía el CTA
                      // primario ("Crear cuenta" → register) — el punto
                      // de entrada real para alguien nuevo, no inventa un
                      // flujo de negocio nuevo, solo relabela el mismo
                      // botón/destino.
                      onPressed: () => context.go(AppRoute.register),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Composición de escritorio — KORIXA-UI-SCREEN01-DESKTOP-HERO-CORRECTION-20260905.
/// Reemplaza el "stage" de 480px (ver docblock de [WelcomePage]) por el
/// hero panorámico real a pantalla completa (`StackFit.expand`, sin
/// ningún `SizedBox`/`ClipRect` que lo acote), con el contenido anclado
/// a la izquierda/centro-izquierda para no tapar al ciclista (visible a
/// la derecha del encuadre) y "Saltar" arriba a la derecha — misma
/// esquina que en mobile, mismo destino.
class _DesktopWelcomeContent extends StatelessWidget {
  const _DesktopWelcomeContent({required this.l10n});

  final AppLocalizations l10n;

  /// Ancho máximo del bloque de texto/CTA — deliberadamente NO
  /// `double.infinity`: en un viewport de 1440px+ un bloque de texto sin
  /// tope de ancho sería difícil de leer (líneas demasiado largas) y
  /// empujaría el CTA hacia el centro del ciclista. 640 (vs. 480 en
  /// mobile) es "materially larger" sin acercarse al tercio derecho del
  /// encuadre donde vive el ciclista.
  ///
  /// KORIXA-UI-SCREEN01-DESKTOP-MICRO-POLISH-20260905: subido de 560 a
  /// 640 — el CTA sigue con su propio ancho fijo (320, sin cambios) y el
  /// título ya entra en una sola línea con cualquiera de los dos anchos,
  /// así que el único elemento realmente afectado es el subtítulo: más
  /// ancho disponible para que su wrap quede más balanceado (antes
  /// dejaba una segunda línea de una sola palabra).
  ///
  /// KORIXA-UI-SCREEN01-CRISP-LOGO-TEXT-CTA-20260905: subido otra vez, a
  /// 680 — el CTA ahora pide 550px de ancho propio; con el inset
  /// izquierdo (72) + derecho (40), el ancho ÚTIL de la columna era solo
  /// 640-112=528, MENOS que los 550 pedidos. Sin este ajuste, el `Column`
  /// (que da a sus hijos un `maxWidth` igual al de su propio ancho)
  /// habría recortado el CTA de vuelta a 528px en silencio (sin overflow
  /// visible, solo un ancho final distinto al pedido). 680-112=568,
  /// suficiente para los 550 del CTA con margen.
  static const double _contentMaxWidth = 680;

  @override
  Widget build(BuildContext context) {
    final TextTheme textTheme = Theme.of(context).textTheme;

    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        const ExcludeSemantics(
          key: Key('welcome-hero-image'),
          child: _DesktopHeroImage(),
        ),
        // Scrim horizontal — más denso del lado del contenido (izquierda),
        // transparente antes de llegar al ciclista/paisaje (derecha).
        // Deliberadamente NO `imageScrimBottom` (ese oscurece TODO el
        // borde inferior, incluido el ciclista): acá el objetivo es
        // contraste de texto sin oscurecer globalmente la foto aprobada.
        const Positioned.fill(child: _DesktopContentScrim()),
        SafeArea(
          child: Align(
            alignment: Alignment.topRight,
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.lg),
              child: _SkipButton(
                label: l10n.welcomeSkipAction,
                onTap: () => context.go(AppRoute.login),
              ),
            ),
          ),
        ),
        SafeArea(
          child: Align(
            alignment: Alignment.centerLeft,
            child: ConstrainedBox(
              key: const Key('welcome-content-max-width'),
              constraints: const BoxConstraints(maxWidth: _contentMaxWidth),
              child: Padding(
                // KORIXA-UI-SCREEN01-DESKTOP-MICRO-POLISH-20260905: el
                // inset izquierdo sube de 40 (`AppSpacing.xxxl`) a 72 —
                // el contenido quedaba pegado al borde del viewport; el
                // resto de los insets no cambia.
                padding: const EdgeInsets.fromLTRB(72, AppSpacing.xl, AppSpacing.xxxl, AppSpacing.xl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    // KORIXA-UI-SCREEN01-DESKTOP-LOGO-SWAP-20260905: logo
                    // de escritorio reemplazado por el archivo aprobado
                    // por el dueño (`korixa_logo_desktop.png`, 1697×927,
                    // RGBA con transparencia real — verificado por bytes,
                    // no una captura). Asset exclusivo de desktop; el
                    // logo de mobile (`korixa_logo.png`) no se toca.
                    //
                    // KORIXA-UI-SCREEN01-CRISP-LOGO-TEXT-CTA-20260905: sin
                    // `cacheHeight`, `Image.asset` deja que el compositor
                    // reduzca el PNG de 1697×927 a ~330×180 con un simple
                    // muestreo bilineal en tiempo de dibujo — con una
                    // reducción de ~5x eso genera aliasing visible en los
                    // trazos finos del contorno de montaña y del wordmark
                    // (se percibe como "pixelado"), aunque el archivo
                    // fuente es nítido (verificado). `cacheHeight` fuerza
                    // a Skia a decodificar/reescalar con un filtro de
                    // calidad en el momento de la decodificación en vez
                    // de un muestreo barato en cada frame — multiplicado
                    // por `devicePixelRatio` para que la textura resultante
                    // cubra pantallas de alta densidad sin volver a
                    // reescalarse. `cacheWidth` se omite a propósito: el
                    // framework deriva el ancho del aspect ratio real del
                    // PNG, así nunca se puede estirar. `FilterQuality.high`
                    // + tamaño renderizado subido a 200 (antes 180): logo
                    // más nítido y con más presencia.
                    Image.asset(
                      'assets/icons/korixa_logo_desktop.png',
                      // 188 (no 200): a 800×600 — el viewport compartido
                      // más chico donde también se valida esta pantalla
                      // (`dark_tech_visual_foundation_test.dart`,
                      // `demo_navigation_test.dart`) — 200 desbordaba la
                      // columna por 7px. 188 sigue siendo mayor que el
                      // valor previo (180) y dentro de "aumentar el
                      // tamaño levemente" del encargo, con margen real.
                      height: 188,
                      cacheHeight: (188 * MediaQuery.of(context).devicePixelRatio).round(),
                      filterQuality: FilterQuality.high,
                      fit: BoxFit.contain,
                      semanticLabel: 'Korixa',
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    Text(
                      l10n.welcomeTitle,
                      textAlign: TextAlign.left,
                      // `displayMedium` (base 45) con `fontSize` subido a
                      // 51 (KORIXA-UI-SCREEN01-FINAL-VISUAL-POLISH-20260905,
                      // dentro del rango 50-52 pedido) — `copyWith` solo
                      // pisa el tamaño; el `height` (multiplicador, no
                      // píxeles) se reescala solo, sin romper el interlineado.
                      //
                      // `letterSpacing: -0.5` (KORIXA-UI-SCREEN01-CRISP-
                      // LOGO-TEXT-CTA-20260905): a 51px/w800 el tracking
                      // por defecto deja los glifos con un pelo de
                      // separación extra que a este tamaño se percibe
                      // como bordes "sueltos"/menos sólidos; un leve
                      // negativo los compacta sin llegar a solaparlos,
                      // más nítido y con más peso visual. Sigue siendo
                      // texto real (`Text`), no una imagen — el color
                      // blanco lo hereda de `DarkTech.textPrimary` vía
                      // `AppTypography.textTheme`, sin tocar acá.
                      style: textTheme.displayMedium?.copyWith(
                        fontSize: 51,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.5,
                        height: 1.08,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      l10n.welcomeSubtitle,
                      textAlign: TextAlign.left,
                      // `titleLarge` (base 22) con `fontSize` subido a 24
                      // (KORIXA-UI-SCREEN01-FINAL-VISUAL-POLISH-20260905).
                      // Peso `w500` (más liviano que el `w600` por defecto
                      // de `titleLarge`) para que siga leyéndose como
                      // subtítulo, no como un segundo título.
                      style: textTheme.titleLarge?.copyWith(
                        fontSize: 24,
                        color: DarkTech.textSecondary,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    // KORIXA-UI-SCREEN01-FINAL-VISUAL-POLISH-20260905:
                    // indicador de escritorio dedicado — 3 barras en vez
                    // de la píldora única de mobile (`_OnboardingIndicator`).
                    // Puramente visual (ver [_DesktopOnboardingIndicator]):
                    // no hay swipe/navegación real entre "páginas", solo
                    // la primera barra activa.
                    const _DesktopOnboardingIndicator(),
                    const SizedBox(height: AppSpacing.xl),
                    // CTA "desktop-appropriate": ancho subido a 550 y alto
                    // a 64 (KORIXA-UI-SCREEN01-CRISP-LOGO-TEXT-CTA-20260905,
                    // dentro de los rangos 520-580 / 64-72 pedidos — 64 en
                    // vez de 68 por el mismo motivo que el logo: margen
                    // real a 800×600), label subido de 14 a 20
                    // (`PrimaryGradientButton.fontSize`, ver
                    // `dark_tech_buttons.dart` — parámetro opcional nuevo,
                    // sin efecto en Login/Register/mobile que no lo
                    // pasan). Sigue sin ser ancho completo del viewport ni
                    // del bloque de contenido (680).
                    SizedBox(
                      key: const Key('welcome-desktop-cta'),
                      width: 550,
                      child: PrimaryGradientButton(
                        label: l10n.welcomeGetStarted,
                        onPressed: () => context.go(AppRoute.register),
                        height: 64,
                        fontSize: 20,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Scrim horizontal exclusivo de la composición de escritorio — ver
/// docblock de [_DesktopWelcomeContent]. Un solo tono neutro (no de
/// marca, igual que `AppGradients.imageScrimBottom`) de opaco a
/// transparente; el corte al 60% del ancho deja el ciclista y la mayor
/// parte del paisaje sin oscurecer.
class _DesktopContentScrim extends StatelessWidget {
  const _DesktopContentScrim();

  @override
  Widget build(BuildContext context) {
    return const IgnorePointer(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
            colors: <Color>[Color(0xE6000000), Colors.transparent],
            stops: <double>[0.0, 0.6],
          ),
        ),
      ),
    );
  }
}

/// Hero panorámico de escritorio aprobado por el dueño
/// (`korixa_welcome_hero_desktop.webp`, ~16:9) — distinto archivo del
/// hero vertical de mobile, no el mismo asset reescalado. `BoxFit.cover`
/// con un alineamiento levemente sesgado a la derecha: el margen de
/// recorte real es chico (el aspect ratio del asset ya es cercano al de
/// un viewport de escritorio ancho), pero ese sesgo garantiza que el
/// ciclista/casco/jersey — el sujeto del encuadre, ubicado a la derecha
/// del frame original — se mantengan visibles incluso en anchos de
/// escritorio angostos cerca del breakpoint (transición segura a
/// tablet), sin necesidad de recortar agresivamente el amanecer/lago a
/// la izquierda en los viewports panorámicos donde sobra espacio.
class _DesktopHeroImage extends StatelessWidget {
  const _DesktopHeroImage();

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/korixa_welcome_hero_desktop.webp',
      fit: BoxFit.cover,
      alignment: const Alignment(0.2, 0),
    );
  }
}

/// Foto hero vertical aprobada por el dueño — sin cambios respecto a la
/// versión aprobada. Exclusiva de mobile ahora (ver [_DesktopHeroImage]
/// para el equivalente de escritorio); ya no necesita el ajuste de
/// `alignment` para "contenedor efectivamente panorámico", porque ese
/// caso ahora lo cubre el hero de escritorio dedicado, no este asset
/// estirado.
class _HeroImage extends StatelessWidget {
  const _HeroImage();

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final bool isWide = constraints.maxWidth > constraints.maxHeight;
        return Image.asset(
          'assets/images/korixa_welcome_hero.webp',
          fit: BoxFit.cover,
          // Sesgado levemente hacia arriba en el raro caso de un
          // contenedor efectivamente panorámico (p. ej. un teléfono en
          // horizontal): mantiene casco+jersey visibles en vez de
          // recortarlos por completo — ver docblock de la clase.
          alignment: isWide ? const Alignment(0, -0.15) : Alignment.center,
        );
      },
    );
  }
}

/// Indicador de onboarding — hoy solo existe SCREEN_01, no hay páginas de
/// onboarding swipeables reales. Un único indicador estático (no 3 puntos
/// con uno "activo") evita implicar falsamente que existen más páginas
/// funcionales, sin dejar de asomar el lenguaje visual aprobado (una
/// píldora con el gradiente de marca).
///
/// Exclusivo de mobile — ver [_DesktopOnboardingIndicator] para el
/// equivalente de escritorio (KORIXA-UI-SCREEN01-FINAL-VISUAL-POLISH-20260905).
class _OnboardingIndicator extends StatelessWidget {
  const _OnboardingIndicator();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 32,
      height: 4,
      decoration: const BoxDecoration(
        gradient: AppGradients.primaryCta,
        borderRadius: AppRadius.pillRadius,
      ),
    );
  }
}

/// Indicador de onboarding de escritorio — KORIXA-UI-SCREEN01-FINAL-
/// VISUAL-POLISH-20260905. Pedido explícitamente como 3 barras (vs. la
/// píldora única de mobile) — puramente visual, igual que
/// [_OnboardingIndicator]: no existen 3 páginas de onboarding reales, no
/// hay swipe ni navegación asociada a las barras 2 y 3, solo la primera
/// (activa) importa semánticamente.
class _DesktopOnboardingIndicator extends StatelessWidget {
  const _DesktopOnboardingIndicator();

  static const double _barWidth = 24;
  static const double _barHeight = 4;
  static const double _gap = 6;

  @override
  Widget build(BuildContext context) {
    return const Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        _Bar(active: true),
        SizedBox(width: _gap),
        _Bar(active: false),
        SizedBox(width: _gap),
        _Bar(active: false),
      ],
    );
  }
}

class _Bar extends StatelessWidget {
  const _Bar({required this.active});

  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: _DesktopOnboardingIndicator._barWidth,
      height: _DesktopOnboardingIndicator._barHeight,
      decoration: BoxDecoration(
        // Activa: mismo gradiente de marca que el CTA/indicador mobile.
        // Inactivas: `DarkTech.border` — el tono "gris oscuro" ya
        // existente en el sistema de diseño (no un color nuevo).
        gradient: active ? AppGradients.primaryCta : null,
        color: active ? null : DarkTech.border,
        borderRadius: AppRadius.pillRadius,
      ),
    );
  }
}

/// Botón "Saltar" — vive SOBRE la foto de hero, no sobre una superficie
/// Dark Tech plana, así que lleva su propia píldora translúcida
/// (`DarkTech.overlayScrim`, el mismo scrim ya usado para diálogos/
/// overlays de foto) para garantizar contraste sin importar qué tan
/// clara sea la región de la foto detrás (Sección 9: "Skip accessible
/// contrast").
class _SkipButton extends StatelessWidget {
  const _SkipButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: AppRadius.pillRadius,
          child: Container(
            // ⚠️ Deliberadamente SIN `alignment:` — un `Container` con
            // `alignment` fijado y restricciones LAXAS entrantes (como
            // las que da un `Align` ancestro, acá `Align(topRight)` en
            // el `SafeArea` de arriba) se agranda para OCUPAR TODO el
            // espacio disponible en vez de ajustarse al contenido — bug
            // real encontrado en una iteración anterior: el texto
            // terminaba centrado en la pantalla completa en vez de en la
            // píldora. El padding simétrico ya centra visualmente el
            // texto sin necesitar `alignment`; el padding vertical
            // (`AppSpacing.md` × 2) más el alto de línea del texto ya
            // cubre el mínimo de 44dp por sí solo en la práctica, así
            // que `minHeight`/`minWidth` quedan como piso de
            // accesibilidad, no como el mecanismo real de tamaño.
            constraints: const BoxConstraints(minHeight: 44, minWidth: 44),
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.md),
            decoration: const BoxDecoration(
              color: DarkTech.overlayScrim,
              borderRadius: AppRadius.pillRadius,
            ),
            child: Text(
              label,
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14),
            ),
          ),
        ),
      ),
    );
  }
}
