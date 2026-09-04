import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_radius.dart';
import 'app_typography.dart';

/// Define los dos `ThemeData` de la app (claro/oscuro). El modo activo se
/// controla desde `ThemeModeNotifier` (ver `theme_provider.dart`) y se
/// persiste en `shared_preferences` para respetar la elección del usuario
/// entre sesiones.
abstract class AppTheme {
  static ThemeData get light => _base(Brightness.light);
  static ThemeData get dark => _base(Brightness.dark);

  /// KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01 — `ThemeData` completo con la
  /// fundación Dark Tech (colores/tipografía/radios nuevos). Existe para
  /// probar que la API del sistema de diseño realmente construye un tema
  /// funcional — TODAVÍA NO está conectado a `MaterialApp` (`light`/`dark`
  /// arriba siguen siendo el tema activo real de la app). La migración de
  /// pantallas y la decisión de cuándo activar este tema son una tarea
  /// posterior — ver `docs/design/KORIXA_SCREEN_SPECS.md`.
  static ThemeData get darkTech => _darkTechBase();

  static ThemeData _darkTechBase() {
    const ColorScheme colorScheme = ColorScheme(
      brightness: Brightness.dark,
      primary: DarkTech.brandPurple,
      onPrimary: Colors.white,
      secondary: DarkTech.brandCyan,
      onSecondary: DarkTech.background, // ver nota de contraste en app_colors.dart: cian nunca lleva texto blanco
      error: DarkTech.error,
      onError: Colors.white,
      surface: DarkTech.surface,
      onSurface: DarkTech.textPrimary,
      outline: DarkTech.border,
      outlineVariant: DarkTech.border,
      surfaceContainerHighest: DarkTech.surfaceElevated,
    );

    final TextTheme textTheme = AppTypography.textTheme(
      onSurface: DarkTech.textPrimary,
      onSurfaceMuted: DarkTech.textSecondary,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: DarkTech.background,
      fontFamily: AppTypography.fontFamily,
      textTheme: textTheme,

      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: DarkTech.textPrimary,
        centerTitle: false,
        titleTextStyle: textTheme.titleLarge,
      ),

      // Fondo sólido de fallback para cualquier `ElevatedButton` plano que
      // todavía no haya migrado a `PrimaryGradientButton` (los botones de
      // Material no soportan gradiente vía tema — por eso el CTA de
      // gradiente real es un widget dedicado, ver
      // `lib/core/design_system/dark_tech_buttons.dart`).
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: DarkTech.brandPurple,
          foregroundColor: Colors.white,
          disabledBackgroundColor: DarkTech.disabledSurface,
          disabledForegroundColor: DarkTech.disabledForeground,
          minimumSize: const Size.fromHeight(52),
          shape: const RoundedRectangleBorder(borderRadius: AppRadius.mdRadius),
          textStyle: textTheme.labelLarge,
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: DarkTech.textPrimary,
          minimumSize: const Size.fromHeight(52),
          side: const BorderSide(color: DarkTech.border),
          shape: const RoundedRectangleBorder(borderRadius: AppRadius.mdRadius),
          textStyle: textTheme.labelLarge,
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: DarkTech.brandPurple,
          textStyle: textTheme.labelLarge,
        ),
      ),

      inputDecorationTheme: const InputDecorationTheme(
        filled: true,
        fillColor: DarkTech.surfaceElevated,
        contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: AppRadius.mdRadius,
          borderSide: BorderSide(color: DarkTech.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadius.mdRadius,
          borderSide: BorderSide(color: DarkTech.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppRadius.mdRadius,
          borderSide: BorderSide(color: DarkTech.brandBlue, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppRadius.mdRadius,
          borderSide: BorderSide(color: DarkTech.error),
        ),
      ),

      cardTheme: const CardThemeData(
        color: DarkTech.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.lgRadius,
          side: BorderSide(color: DarkTech.border),
        ),
        margin: EdgeInsets.zero,
      ),

      dividerTheme: const DividerThemeData(color: DarkTech.border, thickness: 1),

      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: DarkTech.brandBlue,
        linearTrackColor: DarkTech.surfaceElevated,
        circularTrackColor: DarkTech.surfaceElevated,
      ),

      chipTheme: ChipThemeData(
        backgroundColor: DarkTech.surfaceElevated,
        labelStyle: textTheme.labelMedium,
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.pillRadius),
        side: const BorderSide(color: DarkTech.border),
      ),

      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: DarkTech.surfaceElevated,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
        ),
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: DarkTech.surfaceElevated,
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.lgRadius),
        titleTextStyle: textTheme.titleLarge,
        contentTextStyle: textTheme.bodyMedium,
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: DarkTech.surfaceElevated,
        contentTextStyle: textTheme.bodyMedium?.copyWith(color: DarkTech.textPrimary),
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.mdRadius),
      ),
    );
  }

  static ThemeData _base(Brightness brightness) {
    final bool isDark = brightness == Brightness.dark;

    final ColorScheme colorScheme = ColorScheme(
      brightness: brightness,
      primary: AppColors.primary,
      onPrimary: Colors.white,
      secondary: AppColors.secondary,
      onSecondary: Colors.white,
      error: AppColors.error,
      onError: Colors.white,
      surface: isDark ? AppColors.darkSurface : AppColors.lightSurface,
      onSurface: isDark ? AppColors.darkOnSurface : AppColors.lightOnSurface,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: colorScheme,
      scaffoldBackgroundColor:
          isDark ? AppColors.darkBackground : AppColors.lightBackground,
      // KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01 — antes decía `'Inter'` con
      // un comentario "pendiente: añadir fuente a pubspec + assets", pero
      // la fuente nunca se bunleó (sin `fonts:` en pubspec.yaml, sin
      // archivos en assets/) — la app entera renderizaba en la fuente por
      // defecto del sistema operativo. Ahora Inter SÍ está bunleada (ver
      // `AppTypography`/`pubspec.yaml`), así que esta referencia por fin
      // resuelve a algo real.
      fontFamily: AppTypography.fontFamily,

      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: colorScheme.onSurface,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w700,
          color: colorScheme.onSurface,
        ),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          side: BorderSide(color: colorScheme.outline),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? AppColors.darkSurface : Colors.white,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: colorScheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: colorScheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.error),
        ),
      ),

      cardTheme: CardThemeData(
        color: isDark ? AppColors.darkSurface : Colors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        margin: EdgeInsets.zero,
      ),

      dividerTheme: DividerThemeData(
        color: colorScheme.outlineVariant,
        thickness: 1,
      ),
    );
  }
}
