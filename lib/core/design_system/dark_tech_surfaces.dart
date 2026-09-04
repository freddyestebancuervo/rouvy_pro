import 'package:flutter/material.dart';

import '../../app/theme/app_borders.dart';
import '../../app/theme/app_colors.dart';
import '../../app/theme/app_radius.dart';
import '../../app/theme/app_spacing.dart';

/// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01 — profundidad tonal (Sección 5):
/// `background` → `surface` → `surfaceElevated`, sin sombras Material.
/// [AppCard] es la superficie base; [ElevatedCard] es un paso más "cerca
/// del usuario" (p. ej. una card dentro de otra card, o un estado
/// destacado) usando `surfaceElevated` en vez de `surface`.
class AppCard extends StatelessWidget {
  const AppCard({
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.base),
    this.onTap,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return _CardShell(
      color: DarkTech.surface,
      border: AppBorders.neutral,
      padding: padding,
      onTap: onTap,
      child: child,
    );
  }
}

/// Ver docblock de [AppCard]. Mismo contrato, un paso tonal más claro.
class ElevatedCard extends StatelessWidget {
  const ElevatedCard({
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.base),
    this.onTap,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return _CardShell(
      color: DarkTech.surfaceElevated,
      border: AppBorders.neutral,
      padding: padding,
      onTap: onTap,
      child: child,
    );
  }
}

/// Card seleccionable — el borde pasa de `AppBorders.neutral` a
/// `AppBorders.active` (Sección 6, `BORDER_ACTIVE`) cuando [selected] es
/// `true`. Nunca depende SOLO del color para comunicar selección: el
/// borde cambia de ancho (1 → 1.5) además de color (Sección 19 —
/// accesibilidad, no depender solo del color).
class SelectableCard extends StatelessWidget {
  const SelectableCard({
    required this.child,
    required this.selected,
    this.onTap,
    this.padding = const EdgeInsets.all(AppSpacing.base),
    super.key,
  });

  final Widget child;
  final bool selected;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      child: _CardShell(
        color: selected ? DarkTech.surfaceElevated : DarkTech.surface,
        border: selected ? AppBorders.active : AppBorders.neutral,
        padding: padding,
        onTap: onTap,
        child: child,
      ),
    );
  }
}

class _CardShell extends StatelessWidget {
  const _CardShell({
    required this.child,
    required this.color,
    required this.border,
    required this.padding,
    this.onTap,
  });

  final Widget child;
  final Color color;
  final BorderSide border;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final Widget content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: color,
        borderRadius: AppRadius.lgRadius,
        border: Border.fromBorderSide(border),
      ),
      child: child,
    );

    if (onTap == null) return content;

    return Material(
      color: Colors.transparent,
      child: InkWell(onTap: onTap, borderRadius: AppRadius.lgRadius, child: content),
    );
  }
}

/// Campo de texto — mismos tokens que `AppTheme.darkTech.inputDecorationTheme`,
/// pero expuestos de forma explícita para que el widget se vea correcto
/// incluso antes de que ese tema esté conectado a `MaterialApp` (ver nota
/// en `app_theme.dart`).
class AppTextField extends StatelessWidget {
  const AppTextField({
    required this.controller,
    this.label,
    this.hintText,
    this.obscureText = false,
    this.errorText,
    this.keyboardType,
    this.textInputAction,
    this.enabled = true,
    super.key,
  });

  final TextEditingController controller;
  final String? label;
  final String? hintText;
  final bool obscureText;
  final String? errorText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      obscureText: obscureText,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      enabled: enabled,
      style: const TextStyle(color: DarkTech.textPrimary),
      decoration: InputDecoration(
        labelText: label,
        hintText: hintText,
        errorText: errorText,
        hintStyle: const TextStyle(color: DarkTech.textMuted),
        labelStyle: const TextStyle(color: DarkTech.textSecondary),
        filled: true,
        fillColor: enabled ? DarkTech.surfaceElevated : DarkTech.disabledSurface,
        contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.base, vertical: AppSpacing.base),
        border: const OutlineInputBorder(borderRadius: AppRadius.mdRadius, borderSide: BorderSide(color: DarkTech.border)),
        enabledBorder: const OutlineInputBorder(borderRadius: AppRadius.mdRadius, borderSide: BorderSide(color: DarkTech.border)),
        focusedBorder: const OutlineInputBorder(
          borderRadius: AppRadius.mdRadius,
          borderSide: BorderSide(color: DarkTech.brandBlue, width: 2),
        ),
        errorBorder: const OutlineInputBorder(borderRadius: AppRadius.mdRadius, borderSide: BorderSide(color: DarkTech.error)),
        disabledBorder: const OutlineInputBorder(borderRadius: AppRadius.mdRadius, borderSide: BorderSide(color: DarkTech.border)),
      ),
    );
  }
}
