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
/// KORIXA-UI-SCREEN01-VISUAL-REFINEMENT-20260905: la foto aprobada
/// (`assets/images/korixa_welcome_hero.webp`, 1440×2560, retrato) tiene
/// una relación de aspecto MUY distinta a un viewport de escritorio
/// ancho (p. ej. 1440×900). Intentar cubrir un viewport panorámico con
/// `BoxFit.cover` fuerza un recorte vertical severo sin importar el
/// `alignment` elegido — con cualquier ajuste, o se pierde el casco/
/// jersey de arriba, o se pierden piernas/rueda de abajo; no hay
/// alineamiento que "arregle" una relación de aspecto fundamentalmente
/// incompatible. Por eso, en viewports anchos (`> _desktopBreakpoint`),
/// esta pantalla NO estira el hero a pantalla completa — mantiene un
/// "stage" central de proporción cercana al celular (ver [_DesktopStage]),
/// exactamente la composición que Login/Register ya usan para web ancho,
/// para que el recorte del hero vuelva a ser tan suave como en mobile.
class WelcomePage extends StatelessWidget {
  const WelcomePage({super.key});

  /// Por debajo de este ancho lógico, el hero llena el viewport completo
  /// ("fullscreen hero vertical, estilo app real"). Por encima, se activa
  /// el "stage" central — ver docblock de la clase.
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
            final Widget content = _WelcomeContent(l10n: l10n);

            if (constraints.maxWidth <= _desktopBreakpoint) {
              return content;
            }

            return _DesktopStage(height: constraints.maxHeight, child: content);
          },
        ),
      ),
    );
  }
}

/// Composición completa de la pantalla (hero + degradado + Saltar +
/// marca/título/subtítulo/indicador/CTA). Aislada en su propio widget
/// para poder colocarla tal cual dentro del "stage" de desktop
/// ([_DesktopStage]) sin duplicar la estructura — el `Stack` interno
/// siempre se dimensiona relativo a SU padre inmediato (pantalla
/// completa en mobile, el panel angosto en desktop), así que el recorte
/// del hero automáticamente vuelve a ser "modo mobile" dentro del stage.
class _WelcomeContent extends StatelessWidget {
  const _WelcomeContent({required this.l10n});

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

/// "Stage" central para viewports de escritorio/web anchos — ver
/// docblock de [WelcomePage]. Contiene la MISMA composición de
/// [_WelcomeContent] dentro de un panel angosto (ancho fijo, alto igual
/// al del viewport), en vez de estirar el hero a un ancho panorámico
/// donde ningún recorte se ve bien. El área sobrante se llena con el
/// fondo Dark Tech y un resplandor ambiental sutil — mismo patrón ya
/// usado en `DarkTechAuthShell._AmbientGlow`, no un efecto nuevo.
class _DesktopStage extends StatelessWidget {
  const _DesktopStage({required this.height, required this.child});

  final double height;
  final Widget child;

  static const double _stageWidth = 480;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: <Widget>[
        const _DesktopAmbientBackdrop(),
        Center(
          child: SizedBox(
            width: _stageWidth,
            height: height,
            child: ClipRect(child: child),
          ),
        ),
      ],
    );
  }
}

/// Fondo del área sobrante alrededor del "stage" de desktop — sólido
/// Dark Tech más un resplandor radial de marca muy sutil, para que no se
/// sienta como un vacío negro plano (Sección G: "look premium").
class _DesktopAmbientBackdrop extends StatelessWidget {
  const _DesktopAmbientBackdrop();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: DarkTech.background,
      child: IgnorePointer(
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              radius: 1.1,
              colors: <Color>[
                DarkTech.brandPurple.withValues(alpha: 0.14),
                Colors.transparent,
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Foto hero aprobada por el dueño. `BoxFit.cover`; el punto focal
/// (`alignment`) se ajusta según la forma del contenedor inmediato —
/// dentro del "stage" de desktop ([_DesktopStage]) ese contenedor ya
/// tiene una proporción parecida a la de un celular, así que en la
/// práctica casi siempre usa el mismo alineamiento que mobile (ver
/// docblock de [WelcomePage]: ya no se le pide cubrir un viewport
/// panorámico completo).
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
