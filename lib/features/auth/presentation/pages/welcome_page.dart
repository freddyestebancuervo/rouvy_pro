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
/// aprobado por el dueño (Sección 2 del encargo): foto de ciclista a
/// pantalla completa, "Saltar" arriba a la derecha, marca/título/
/// subtítulo/indicadores/CTA anclados abajo con degradado de lectura.
///
/// Deliberadamente NO reusa `DarkTechAuthShell` (compartido con Login/
/// Register): ese shell está construido para un formulario centrado y
/// scrolleable de ancho acotado — el hero de pantalla completa con
/// contenido anclado al fondo es una composición distinta que no encaja
/// ahí sin forzarla. Login/Register no se tocan en absoluto en esta
/// tarea; envuelve el mismo `Theme(data: AppTheme.darkTech)` de forma
/// independiente para no depender de un componente compartido con ellos.
///
/// KORIXA-UI-SCREEN01-ASSET-INTEGRATION-20260904: hero y logo son los
/// archivos exactos aprobados por el dueño (OWNER_PROVIDED, entregados
/// como `korixa_screen01_hero_app_1440x2560.webp` y
/// `korixa_logo_transparent_2048.png`), copiados sin modificar a
/// `assets/images/korixa_welcome_hero.webp` y
/// `assets/icons/korixa_logo.png`. El master 8K (`..._master_8k_...jpg`)
/// es solo fuente de archivo/diseño — deliberadamente NO se empaqueta en
/// los assets del runtime de Flutter, solo la versión 1440×2560 ya
/// pensada para pantalla.
class WelcomePage extends StatelessWidget {
  const WelcomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Theme(
      data: AppTheme.darkTech,
      // KORIXA-UI-SCREEN-01-APPROVED-WELCOME-IMPLEMENTATION-20260904: un
      // `Builder` para que `Theme.of` más abajo resuelva contra ESTE
      // `Theme(data: AppTheme.darkTech)`, no contra el `context` de
      // `build` (que está por encima y resolvería el tema AMBIENTE de
      // `MaterialApp` — el mismo defecto ya corregido una vez en
      // `DarkTechAuthShell`, ver su docblock). Las navegaciones
      // (`context.go`) siguen usando el `context` externo de `build`,
      // igual de válido para eso.
      child: Builder(
        builder: (BuildContext themeContext) {
          final TextTheme textTheme = Theme.of(themeContext).textTheme;
          return Scaffold(
            backgroundColor: DarkTech.background,
            body: Stack(
              fit: StackFit.expand,
              children: <Widget>[
                // Decorativo — el título/subtítulo ya describen la
                // propuesta de valor en texto, así que la foto se excluye
                // de la semántica en vez de duplicarla (Sección 9: "image
                // marked decorative").
                const ExcludeSemantics(
                  key: Key('welcome-hero-image'),
                  child: _HeroImage(),
                ),
                // Degradado de lectura — mismo token que usan las cards
                // de ruta (`DarkTechRouteImage`), nunca un gradiente ad
                // hoc.
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
                        // "Saltar" = saltar el pitch de bienvenida
                        // directo a iniciar sesión — Sección 7: reusa
                        // exactamente el destino que ya tenía el botón
                        // secundario anterior ("Ya tengo cuenta" →
                        // login), no inventa un flujo nuevo ni evade el
                        // guard de autenticación (Login sigue siendo una
                        // auth route legítima).
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
                        // `reverse: true`: en una pantalla muy chica o
                        // con texto muy escalado, lo primero que debe
                        // seguir visible es el CTA (el final del
                        // contenido), no el logo — el scroll parte
                        // mostrando el final.
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
                              // "Comenzar" = mismo destino que antes
                              // tenía el CTA primario ("Crear cuenta" →
                              // register) — el punto de entrada real
                              // para alguien nuevo, Sección 7: no
                              // inventa un flujo de negocio nuevo, solo
                              // relabela el mismo botón/destino.
                              onPressed: () => context.go(AppRoute.register),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Foto hero aprobada por el dueño — ver docblock de [WelcomePage] para
/// procedencia. `BoxFit.cover` a pantalla completa; el punto focal
/// (`alignment`) se ajusta según la forma del viewport para que el
/// ciclista (ubicado en la mitad inferior de la foto original) siga
/// siendo el sujeto dominante incluso cuando un recorte panorámico
/// (desktop, ancho >> alto) recortaría más agresivamente el cielo/
/// montañas que un viewport vertical de celular.
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
          // Sesgado levemente hacia arriba en viewports panorámicos: a
          // 1440×900 el recorte vertical es tan agresivo (~35% del alto
          // original visible) que un alineamiento centrado o hacia abajo
          // deja el casco y el jersey con el logo Korixa FUERA de cuadro,
          // mostrando solo piernas/pedales — se ajustó tras revisar la
          // captura real, no a ciegas. -0.15 mantiene casco+jersey+muslos
          // visibles, el mismo tramo donde vive la marca en la foto.
          alignment: isWide ? const Alignment(0, -0.15) : Alignment.center,
        );
      },
    );
  }
}

/// Logo Korixa aprobado por el dueño (mismo archivo, sin modificar) — ya
/// incluye el ícono de montaña/ruta y el wordmark "KORIXA" dentro de la
/// propia imagen, así que NO se duplica un `Text` "Korixa" debajo (ver
/// docblock de [WelcomePage] para procedencia del archivo).
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

/// Indicador de onboarding — Sección 8, opción B: hoy solo existe
/// SCREEN_01, no hay páginas de onboarding swipeables reales. Un único
/// indicador estático (no 3 puntos con uno "activo") evita implicar
/// falsamente que existen más páginas funcionales, sin dejar de asomar
/// el lenguaje visual aprobado (una píldora con el gradiente de marca).
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
            // real encontrado durante esta tarea: el texto terminaba
            // centrado en la pantalla completa en vez de en la píldora.
            // El padding simétrico ya centra visualmente el texto sin
            // necesitar `alignment`; el padding vertical (`AppSpacing.md`
            // × 2) más el alto de línea del texto ya cubre el mínimo de
            // 44dp por sí solo en la práctica, así que `minHeight`/
            // `minWidth` quedan como piso de accesibilidad, no como el
            // mecanismo real de tamaño.
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
