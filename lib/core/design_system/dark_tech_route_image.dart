import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../app/theme/app_gradients.dart';
import '../../app/theme/app_radius.dart';
import '../../app/theme/app_spacing.dart';
import 'dark_tech_badges.dart';

/// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01, Sección 13 — reglas de
/// tratamiento de imagen de ruta, como COMPONENTE/API únicamente. NO
/// incluye ninguna librería de fotos de producción (Sección 13 del
/// encargo: "no requiere la librería de fotos final") — [imageProvider]
/// es opcional; si es `null`, se usa el mismo patrón de rectángulo
/// tintado + ícono que ya existe hoy en `route_card.dart`/
/// `route_detail_page.dart` (auditoría KORIXA-UIUX-DESIGN-SYSTEM-AUDIT-01:
/// "no hay pipeline de imágenes de ruta todavía") — este widget no
/// resuelve eso, solo define el contrato para cuando exista.
///
/// Reglas aplicadas:
/// - **Recorte/aspecto**: `aspectRatio` fijo (por defecto 16:9), siempre
///   `BoxFit.cover` — evita que una imagen de proporción distinta
///   distorsione el layout de la card.
/// - **Superposición oscura + degradado inferior**: `AppGradients.imageScrimBottom`
///   siempre presente cuando hay [title] — garantiza contraste de texto
///   legible sin importar el brillo/color de la imagen de fondo.
/// - **Área segura de contraste**: el título va SIEMPRE dentro de la
///   franja inferior donde el scrim es más oscuro (ver `stops` del
///   gradiente), nunca centrado sobre la imagen sin protección.
/// - **Placeholder**: sin imagen → `AppGradients.heroVertical` + ícono
///   central, mismo patrón ya usado hoy, ahora tokenizado.
/// - **Ruta no disponible**: `isAvailable: false` añade un scrim adicional
///   más oscuro sobre TODA el área (no solo el pie) + `ComingSoonBadge` —
///   nunca se disfraza de disponible.
class DarkTechRouteImage extends StatelessWidget {
  const DarkTechRouteImage({
    this.imageProvider,
    this.title,
    this.isAvailable = true,
    this.placeholderIcon = Icons.map_outlined,
    this.aspectRatio = 16 / 9,
    super.key,
  });

  final ImageProvider? imageProvider;
  final String? title;
  final bool isAvailable;
  final IconData placeholderIcon;
  final double aspectRatio;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: AppRadius.lgRadius,
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: Stack(
          fit: StackFit.expand,
          children: <Widget>[
            if (imageProvider != null)
              Image(image: imageProvider!, fit: BoxFit.cover)
            else
              const DecoratedBox(
                decoration: BoxDecoration(gradient: AppGradients.heroVertical),
              ),
            if (imageProvider == null)
              Center(child: Icon(placeholderIcon, size: 48, color: Colors.white.withValues(alpha: 0.85))),
            if (title != null)
              const DecoratedBox(decoration: BoxDecoration(gradient: AppGradients.imageScrimBottom)),
            if (!isAvailable) Container(color: DarkTech.overlayScrim),
            if (title != null)
              Positioned(
                left: AppSpacing.md,
                right: AppSpacing.md,
                bottom: AppSpacing.md,
                child: Text(
                  title!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16),
                ),
              ),
            if (!isAvailable)
              const Positioned(top: AppSpacing.sm, right: AppSpacing.sm, child: ComingSoonBadge()),
          ],
        ),
      ),
    );
  }
}
