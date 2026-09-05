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
                // CTA (el final del contenido), no el logo — el scroll
                // parte mostrando el final.
                reverse: true,
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.xl,
                  AppSpacing.xl,
                  AppSpacing.xl,
                  AppSpacing.lg,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    const _KorixaLogo(),
                    const SizedBox(height: AppSpacing.lg),
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
  static const double _contentMaxWidth = 640;

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
                    // Logo materially larger que en mobile (72 -> 140):
                    // mismo archivo, sin modificar, solo escalado. Subido
                    // de 120 a 140 (KORIXA-UI-SCREEN01-DESKTOP-MICRO-
                    // POLISH-20260905, +16.7%, dentro del +15-20% pedido).
                    Image.asset(
                      'assets/icons/korixa_logo.png',
                      height: 140,
                      fit: BoxFit.contain,
                      semanticLabel: 'Korixa',
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    Text(
                      l10n.welcomeTitle,
                      textAlign: TextAlign.left,
                      // KORIXA-UI-SCREEN01-DESKTOP-BRAND-POLISH-20260905:
                      // subido de `headlineLarge` (32) a `displayMedium`
                      // (45, +41%) — más protagonismo visual, acorde al
                      // encargo de que el título "coincida con la
                      // proporción" de una referencia mucho más grande.
                      style: textTheme.displayMedium?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      l10n.welcomeSubtitle,
                      textAlign: TextAlign.left,
                      // Subido de `bodyLarge` (16) a `titleLarge` (22,
                      // +37.5%) — peso `w500` (más liviano que el `w600`
                      // por defecto de `titleLarge`) para que siga
                      // leyéndose como subtítulo, no como un segundo
                      // título compitiendo con el de arriba.
                      style: textTheme.titleLarge?.copyWith(
                        color: DarkTech.textSecondary,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    const _OnboardingIndicator(),
                    const SizedBox(height: AppSpacing.xl),
                    // CTA "desktop-appropriate": ni el ancho mobile (52px
                    // de alto pero angosto), ni ancho completo del
                    // viewport — un ancho fijo intermedio dentro del
                    // bloque de contenido.
                    SizedBox(
                      key: const Key('welcome-desktop-cta'),
                      width: 320,
                      child: PrimaryGradientButton(
                        label: l10n.welcomeGetStarted,
                        onPressed: () => context.go(AppRoute.register),
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

/// Logo Korixa aprobado por el dueño (mismo archivo, sin modificar) — ya
/// incluye el ícono de montaña/ruta y el wordmark "KORIXA" dentro de la
/// propia imagen, así que NO se duplica un `Text` "Korixa" debajo.
class _KorixaLogo extends StatelessWidget {
  const _KorixaLogo();

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/icons/korixa_logo.png',
      height: 72,
      fit: BoxFit.contain,
      semanticLabel: 'Korixa',
    );
  }
}

/// Indicador de onboarding — hoy solo existe SCREEN_01, no hay páginas de
/// onboarding swipeables reales. Un único indicador estático (no 3 puntos
/// con uno "activo") evita implicar falsamente que existen más páginas
/// funcionales, sin dejar de asomar el lenguaje visual aprobado (una
/// píldora con el gradiente de marca).
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
