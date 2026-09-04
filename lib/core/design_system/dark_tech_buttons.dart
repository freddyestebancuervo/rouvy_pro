import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../app/theme/app_gradients.dart';
import '../../app/theme/app_radius.dart';
import '../../app/theme/app_spacing.dart';
import '../../app/theme/app_typography.dart';

/// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01 — botón CTA oficial de Korixa
/// (Sección 10 del encargo): gradiente morado→azul (`AppGradients.primaryCta`
/// — nunca `AppGradients.primary`, que incluye cian y no es seguro para
/// texto blanco encima, ver `app_gradients.dart`).
///
/// Los botones de Material (`ElevatedButton`) no soportan un fondo con
/// gradiente vía `ButtonStyle` — por eso este es un widget dedicado
/// (`Container` decorado + `InkWell`), no una envoltura de `ElevatedButton`.
///
/// Estados cubiertos explícitamente:
/// - normal: gradiente completo, opacidad 1.0
/// - presionado: gradiente atenuado (opacidad 0.85) vía `InkWell` (ya trae
///   su propio efecto de splash/highlight encima)
/// - deshabilitado: reemplaza el gradiente por `DarkTech.disabledSurface`
///   sólido — un gradiente "atenuado" seguiría pareciendo interactivo;
///   sólido y sin color de marca comunica "no disponible" sin depender
///   solo del color (también baja la opacidad del texto)
/// - cargando: spinner en vez de la etiqueta, mismo tamaño, sigue
///   deshabilitado a la interacción
///
/// Objetivo táctil mínimo: 52px de alto (>= 48dp recomendado por Material
/// y WCAG 2.5.5), ancho completo por defecto.
class PrimaryGradientButton extends StatelessWidget {
  const PrimaryGradientButton({
    required this.label,
    required this.onPressed,
    this.isLoading = false,
    this.icon,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;
  final IconData? icon;

  static const double _height = 52;

  bool get _isDisabled => onPressed == null || isLoading;

  @override
  Widget build(BuildContext context) {
    final bool disabled = _isDisabled;

    return Semantics(
      button: true,
      enabled: !disabled,
      label: label,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: disabled ? null : onPressed,
          borderRadius: AppRadius.mdRadius,
          child: Ink(
            height: _height,
            decoration: BoxDecoration(
              gradient: disabled ? null : AppGradients.primaryCta,
              color: disabled ? DarkTech.disabledSurface : null,
              borderRadius: AppRadius.mdRadius,
            ),
            child: Center(
              child: isLoading
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                    )
                  : Row(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        if (icon != null) ...<Widget>[
                          Icon(icon, size: 20, color: disabled ? DarkTech.disabledForeground : Colors.white),
                          const SizedBox(width: AppSpacing.sm),
                        ],
                        Text(
                          label,
                          style: AppTypography.textTheme(
                            onSurface: disabled ? DarkTech.disabledForeground : Colors.white,
                            onSurfaceMuted: DarkTech.textSecondary,
                          ).labelLarge,
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Botón secundario — borde neutral (`AppBorders.neutral`), fondo
/// transparente, texto principal. Para acciones alternativas a la CTA
/// (p. ej. "Ya tengo cuenta" junto a "Crear cuenta").
class SecondaryOutlinedButton extends StatelessWidget {
  const SecondaryOutlinedButton({required this.label, required this.onPressed, this.icon, super.key});

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final bool disabled = onPressed == null;
    final Color foreground = disabled ? DarkTech.disabledForeground : DarkTech.textPrimary;

    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: icon != null ? Icon(icon, size: 20, color: foreground) : const SizedBox.shrink(),
      label: Text(label),
      style: OutlinedButton.styleFrom(
        foregroundColor: foreground,
        disabledForegroundColor: DarkTech.disabledForeground,
        minimumSize: const Size.fromHeight(52),
        side: BorderSide(color: disabled ? DarkTech.disabledSurface : DarkTech.border),
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.mdRadius),
        textStyle: AppTypography.textTheme(onSurface: foreground, onSurfaceMuted: foreground).labelLarge,
      ),
    );
  }
}

/// Botón fantasma — sin fondo ni borde, solo texto en color de marca. Para
/// acciones de bajo énfasis (enlaces en línea, "Olvidé mi contraseña").
///
/// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01A (auditoría de accesibilidad,
/// defecto #2): usaba `DarkTech.brandPurple` como color de texto, que
/// reprueba AA texto normal sobre las 3 superficies oscuras (3.02–3.42:1,
/// ver `DarkTech.interactiveText`). Que blanco SOBRE `brandPurple` pase
/// AA no implica que `brandPurple` sirva COMO texto sobre fondo oscuro —
/// son pares de contraste opuestos.
class GhostButton extends StatelessWidget {
  const GhostButton({required this.label, required this.onPressed, super.key});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        foregroundColor: DarkTech.interactiveText,
        disabledForegroundColor: DarkTech.disabledForeground,
        textStyle: AppTypography.textTheme(
          onSurface: DarkTech.interactiveText,
          onSurfaceMuted: DarkTech.interactiveText,
        ).labelLarge,
      ),
      child: Text(label),
    );
  }
}
