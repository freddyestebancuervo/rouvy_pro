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
/// ⚠️ KORIXA-UI-SCREEN-01-APPROVED-WELCOME-IMPLEMENTATION-20260904: la
/// foto real de ciclista (Sección 2 "HERO") y el logo oficial de Korixa
/// (Sección 2 "BRAND") NO existen todavía en el repo — `assets/images/`
/// y `assets/icons/` están vacíos, y no se recibió ningún archivo
/// aprobado fuera del repo para copiar. Sustituir con una foto/logo
/// fabricado o descargado violaría la Sección 3 del encargo
/// explícitamente ("no antecedente falso de asset"). Esta pantalla
/// implementa la ESTRUCTURA completa (todos los widgets reales:
/// Saltar/marca-texto/título/subtítulo/indicador/CTA) con un fondo
/// decorativo Dark Tech como placeholder honesto — no una foto
/// fabricada — a la espera de los assets aprobados reales. Ver
/// `_HeroPlaceholder`. FINAL_STATUS de esta entrega = HOLD_APPROVED_VISUAL_ASSET.
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
                // Decorativo únicamente — el título/subtítulo ya
                // describen la propuesta de valor, así que se excluye de
                // la semántica en vez de duplicarla (Sección 9: "image
                // marked decorative").
                const ExcludeSemantics(
                  key: Key('welcome-hero-placeholder'),
                  child: _HeroPlaceholder(),
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
                        // contenido), no el wordmark — el scroll parte
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
                            const _KorixaWordmark(),
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

/// Placeholder honesto del hero — ver docblock de [WelcomePage]. Usa el
/// mismo gradiente vertical de marca que ya sirve de placeholder para
/// imágenes de ruta ausentes (`DarkTechRouteImage`/`AppGradients.heroVertical`),
/// no un color/gradiente nuevo, y sin ícono ni forma que pretenda ser una
/// fotografía real.
class _HeroPlaceholder extends StatelessWidget {
  const _HeroPlaceholder();

  @override
  Widget build(BuildContext context) {
    return const DecoratedBox(decoration: BoxDecoration(gradient: AppGradients.heroVertical));
  }
}

/// Marca Korixa — texto real, NO una imagen de logo (Sección 3: no existe
/// todavía un logo aprobado en el repo, ver docblock de [WelcomePage]).
/// Ortografía oficial exacta: "Korixa".
class _KorixaWordmark extends StatelessWidget {
  const _KorixaWordmark();

  @override
  Widget build(BuildContext context) {
    return Text(
      'Korixa',
      textAlign: TextAlign.center,
      style: Theme.of(context).textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w800,
            letterSpacing: 1.5,
            color: DarkTech.textPrimary,
          ),
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

/// Botón "Saltar" — vive SOBRE la foto/placeholder de hero, no sobre una
/// superficie Dark Tech plana, así que lleva su propia píldora
/// translúcida (`DarkTech.overlayScrim`, el mismo scrim ya usado para
/// diálogos/overlays de foto) para garantizar contraste sin importar
/// cuán clara sea la imagen de fondo real que se agregue después
/// (Sección 9: "Skip accessible contrast").
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
