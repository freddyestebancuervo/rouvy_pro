import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../app/theme/app_gradients.dart';
import '../../app/theme/app_radius.dart';
import '../../app/theme/app_typography.dart';

/// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01 — barra de progreso de ruta.
///
/// El relleno usa `AppGradients.primary` (las 3 paradas, morado→azul→cian)
/// a propósito: es una superficie puramente decorativa, sin texto/ícono
/// legible apoyado encima, así que la restricción de contraste que obliga
/// a `AppGradients.primaryCta` en los botones no aplica acá (ver
/// `app_gradients.dart`). Es exactamente el tipo de uso "selección/
/// progreso de ruta" que la Sección 11 del encargo asigna al morado/azul/
/// cian de marca.
class RouteProgressBar extends StatelessWidget {
  const RouteProgressBar({required this.progress, this.height = 8, super.key});

  /// 0.0–1.0. Se clampa acá también, defensivamente — el valor real ya
  /// viene clampado desde `RideSessionState.routeProgress`, pero este
  /// widget no debe confiar ciegamente en el llamador.
  final double progress;
  final double height;

  @override
  Widget build(BuildContext context) {
    final double clamped = progress.isNaN ? 0 : progress.clamp(0.0, 1.0);

    return ClipRRect(
      borderRadius: BorderRadius.all(Radius.circular(height / 2)),
      child: SizedBox(
        height: height,
        child: Stack(
          children: <Widget>[
            Container(color: DarkTech.surfaceElevated),
            FractionallySizedBox(
              widthFactor: clamped,
              child: Container(decoration: const BoxDecoration(gradient: AppGradients.primary)),
            ),
          ],
        ),
      ),
    );
  }
}

/// Jerarquía de tamaño de métrica — ver `AppTypography.metricHero/Large/
/// Medium/Small` y el hallazgo de la auditoría (KORIXA-UIUX-DESIGN-SYSTEM-AUDIT-01):
/// hoy los 4 medidores del HUD (velocidad/potencia/cadencia/FC) comparten
/// el mismo peso visual sin ninguna jerarquía.
enum MetricTier { hero, large, medium, small }

/// Celda de métrica — valor + unidad + etiqueta, con cifras tabulares
/// (un dígito que cambia de ancho, p. ej. 9→36, no debe desplazar el
/// layout de al lado — ver `AppTypography`).
///
/// [accentColor] es opcional y por defecto `DarkTech.textPrimary` — sirve
/// como el punto de extensión para colorear por zona de FC/potencia en el
/// futuro (Sección 12 del encargo: `ZONE_CLASSIFICATION_ENABLED = NO` por
/// ahora — este widget NO decide ni afirma ninguna zona fisiológica, solo
/// acepta el color que el llamador decida pasarle).
class MetricTile extends StatelessWidget {
  const MetricTile({
    required this.label,
    required this.value,
    this.unit,
    this.tier = MetricTier.medium,
    this.accentColor,
    super.key,
  });

  final String label;
  final String value;
  final String? unit;
  final MetricTier tier;
  final Color? accentColor;

  TextStyle get _valueStyle {
    switch (tier) {
      case MetricTier.hero:
        return AppTypography.metricHero;
      case MetricTier.large:
        return AppTypography.metricLarge;
      case MetricTier.medium:
        return AppTypography.metricMedium;
      case MetricTier.small:
        return AppTypography.metricSmall;
    }
  }

  @override
  Widget build(BuildContext context) {
    final Color color = accentColor ?? DarkTech.textPrimary;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        RichText(
          text: TextSpan(
            children: <InlineSpan>[
              TextSpan(text: value, style: _valueStyle.copyWith(color: color)),
              if (unit != null)
                TextSpan(
                  text: ' $unit',
                  style: const TextStyle(
                    fontFamily: AppTypography.fontFamily,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: DarkTech.textSecondary,
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: const TextStyle(fontFamily: AppTypography.fontFamily, fontSize: 12, color: DarkTech.textMuted),
        ),
      ],
    );
  }
}

/// Deliberadamente sin usar en ningún widget todavía — placeholder de
/// referencia para el radio compartido de las cards de métrica, si una
/// futura pantalla necesita envolver un `MetricTile` en un contenedor.
const BorderRadius metricCardRadius = AppRadius.lgRadius;
