import 'package:flutter/material.dart';

/// Tipografía — Korixa Dark Tech (KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01).
///
/// ⚠️ Corrige un defecto real encontrado en la auditoría
/// (KORIXA-UIUX-DESIGN-SYSTEM-AUDIT-01): `AppTheme` fijaba
/// `fontFamily: 'Inter'` con un comentario `// pendiente: añadir fuente a
/// pubspec + assets`, pero `pubspec.yaml` nunca declaraba ninguna
/// `fonts:` y no existía ningún archivo de fuente en `assets/` — la app
/// entera renderizaba en la fuente por defecto del sistema operativo sin
/// que nadie lo supiera. Esta tarea sí bunlea Inter de verdad: fuente
/// variable oficial de Google Fonts (licencia SIL Open Font License 1.1,
/// ver `assets/fonts/inter/OFL.txt`), sin descarga en tiempo de
/// ejecución, funciona offline. Ver `pubspec.yaml` para la declaración
/// `fonts:`.
///
/// Es una fuente VARIABLE (un solo archivo cubre todo el eje de peso) —
/// declarada en `pubspec.yaml` con una entrada por cada [FontWeight] que
/// se usa acá, todas apuntando al mismo archivo; Flutter/Skia resuelve la
/// instancia de peso correcta internamente. Patrón estándar para fuentes
/// variables en Flutter, no un truco.
abstract class AppTypography {
  static const String fontFamily = 'Inter';

  static const FontFeature _tabularFigures = FontFeature.tabularFigures();

  /// `TextTheme` completo — construido explícitamente (la app antes no
  /// tenía ninguno; dependía enteramente del `Typography` M3 por
  /// defecto). [onSurface] es el color de texto principal de la
  /// superficie; [onSurfaceMuted] el secundario/terciario.
  static TextTheme textTheme({required Color onSurface, required Color onSurfaceMuted}) {
    return TextTheme(
      displayLarge: TextStyle(
        fontFamily: fontFamily,
        fontSize: 57,
        height: 64 / 57,
        fontWeight: FontWeight.w800,
        color: onSurface,
      ),
      displayMedium: TextStyle(
        fontFamily: fontFamily,
        fontSize: 45,
        height: 52 / 45,
        fontWeight: FontWeight.w700,
        color: onSurface,
      ),
      headlineLarge: TextStyle(
        fontFamily: fontFamily,
        fontSize: 32,
        height: 40 / 32,
        fontWeight: FontWeight.w700,
        color: onSurface,
      ),
      headlineMedium: TextStyle(
        fontFamily: fontFamily,
        fontSize: 28,
        height: 36 / 28,
        fontWeight: FontWeight.w700,
        color: onSurface,
      ),
      titleLarge: TextStyle(
        fontFamily: fontFamily,
        fontSize: 22,
        height: 28 / 22,
        fontWeight: FontWeight.w600,
        color: onSurface,
      ),
      titleMedium: TextStyle(
        fontFamily: fontFamily,
        fontSize: 16,
        height: 24 / 16,
        fontWeight: FontWeight.w600,
        color: onSurface,
      ),
      bodyLarge: TextStyle(
        fontFamily: fontFamily,
        fontSize: 16,
        height: 24 / 16,
        fontWeight: FontWeight.w400,
        color: onSurface,
      ),
      bodyMedium: TextStyle(
        fontFamily: fontFamily,
        fontSize: 14,
        height: 20 / 14,
        fontWeight: FontWeight.w400,
        color: onSurfaceMuted,
      ),
      bodySmall: TextStyle(
        fontFamily: fontFamily,
        fontSize: 12,
        height: 16 / 12,
        fontWeight: FontWeight.w400,
        color: onSurfaceMuted,
      ),
      labelLarge: TextStyle(
        fontFamily: fontFamily,
        fontSize: 14,
        height: 20 / 14,
        fontWeight: FontWeight.w600,
        color: onSurface,
      ),
      labelMedium: TextStyle(
        fontFamily: fontFamily,
        fontSize: 12,
        height: 16 / 12,
        fontWeight: FontWeight.w600,
        color: onSurface,
      ),
    );
  }

  // ---------------------------------------------------------------------
  // Estilos de métrica — fuera de la escala Material estándar a
  // propósito: velocidad/potencia/cadencia/progreso necesitan una jerarquía
  // propia (ver Sección 7 del HUD en KORIXA-UIUX-DESIGN-SYSTEM-AUDIT-01,
  // hallazgo: hoy los 4 medidores del HUD tienen el mismo peso visual).
  // Cifras tabulares en las 4: un número que cambia de dígitos (36→9) no
  // debe desplazar el layout de al lado.
  // ---------------------------------------------------------------------

  /// El único número "héroe" de una pantalla — p. ej. el % de progreso de
  /// ruta o el cronómetro de la sesión.
  static const TextStyle metricHero = TextStyle(
    fontFamily: fontFamily,
    fontSize: 56,
    height: 60 / 56,
    fontWeight: FontWeight.w800,
    fontFeatures: <FontFeature>[_tabularFigures],
  );

  /// Métricas primarias (velocidad, potencia) — el nivel que un ciclista
  /// mira más seguido durante el esfuerzo.
  static const TextStyle metricLarge = TextStyle(
    fontFamily: fontFamily,
    fontSize: 40,
    height: 44 / 40,
    fontWeight: FontWeight.w800,
    fontFeatures: <FontFeature>[_tabularFigures],
  );

  /// Métricas secundarias (cadencia, frecuencia cardíaca).
  static const TextStyle metricMedium = TextStyle(
    fontFamily: fontFamily,
    fontSize: 28,
    height: 32 / 28,
    fontWeight: FontWeight.w700,
    fontFeatures: <FontFeature>[_tabularFigures],
  );

  /// Estadísticas acumulativas de pie (distancia, calorías) — a propósito
  /// más chicas: son datos retrospectivos, no accionables en el momento.
  static const TextStyle metricSmall = TextStyle(
    fontFamily: fontFamily,
    fontSize: 18,
    height: 22 / 18,
    fontWeight: FontWeight.w700,
    fontFeatures: <FontFeature>[_tabularFigures],
  );
}
