import 'package:flutter/material.dart';

import '../../../../app/theme/app_colors.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_theme.dart';

/// KORIXA-UI-SCREEN-BATCH-01 — envoltura visual compartida por
/// Welcome/Login/Register (las 3 pantallas "de entrada" a la auth).
///
/// Aplica la identidad Korixa Dark Tech (`AppTheme.darkTech`) SOLO dentro
/// de este subárbol — el `MaterialApp` de la app sigue usando
/// `AppTheme.light`/`AppTheme.dark` vía `themeModeProvider`, sin cambios
/// (ver Sección 5 del encargo: el tema Dark Tech NO se cablea
/// globalmente en esta tarea). Envolver en un `Theme` local reskinea
/// automáticamente cualquier widget de Material estándar dentro de
/// [child] (botones, `TextFormField` vía `inputDecorationTheme`,
/// `Divider`, `SnackBar`, `AppBar`) sin que cada pantalla tenga que
/// repetir sus propios colores — una sola fuente de verdad para las 3.
///
/// Deliberadamente NO conoce autenticación, controladores, validación ni
/// ruteo — solo estructura visual (fondo, límites de ancho, scroll,
/// spacing). Esas responsabilidades siguen en cada `Page`.
class DarkTechAuthShell extends StatelessWidget {
  const DarkTechAuthShell({
    required this.child,
    this.maxWidth = 420,
    this.showAmbientGlow = false,
    this.appBar,
    super.key,
  });

  final Widget child;

  /// Ancho máximo del contenido centrado. Welcome usa 480 (más "hero"),
  /// Login/Register 420 (más compactas, centradas en la tarea) — mismos
  /// valores que ya usaba cada pantalla antes de esta migración visual.
  final double maxWidth;

  /// Iluminación decorativa sutil de marca (Sección 4/6 del encargo:
  /// "optional subtle decorative purple/blue/cyan lighting"). Solo
  /// Welcome la activa — Login/Register deben quedar "más calladas y
  /// centradas en la tarea" (Sección 20).
  final bool showAmbientGlow;

  final PreferredSizeWidget? appBar;

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: AppTheme.darkTech,
      child: Scaffold(
        backgroundColor: DarkTech.background,
        appBar: appBar,
        body: Stack(
          children: <Widget>[
            if (showAmbientGlow) const _AmbientGlow(),
            SafeArea(
              child: LayoutBuilder(
                builder: (BuildContext context, BoxConstraints constraints) {
                  // Centra el contenido verticalmente cuando entra en
                  // pantalla, pero permite scroll cuando no entra (teclado
                  // abierto, texto localizado más largo, pantalla chica)
                  // — sin esto, el `Column` con `Spacer`s de Welcome (o un
                  // formulario largo en Register) se desbordaría en vez de
                  // desplazarse.
                  return SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl, vertical: AppSpacing.lg),
                    child: ConstrainedBox(
                      constraints: BoxConstraints(minHeight: constraints.maxHeight - AppSpacing.lg * 2),
                      child: Center(
                        child: ConstrainedBox(
                          constraints: BoxConstraints(maxWidth: maxWidth),
                          child: IntrinsicHeight(child: child),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Resplandor de fondo muy sutil (un solo tono de marca, alfa bajo) —
/// deliberadamente NO usa `AppGradients.primary`/`primaryCta` (esos son
/// gradientes de 2-3 paradas ya reservados para CTA/hero — reusarlos acá
/// duplicaría su propósito, ver Sección 24 "no ad-hoc gradients"). Un
/// `RadialGradient` de un solo color existente hacia transparente no es
/// un gradiente de marca nuevo, es iluminación ambiental.
class _AmbientGlow extends StatelessWidget {
  const _AmbientGlow();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: Alignment.topCenter,
            radius: 1.0,
            colors: <Color>[
              DarkTech.brandPurple.withValues(alpha: 0.16),
              Colors.transparent,
            ],
          ),
        ),
      ),
    );
  }
}
