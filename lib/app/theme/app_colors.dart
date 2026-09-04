import 'package:flutter/material.dart';

/// Paleta de la marca. Centralizada aquí para que diseño y desarrollo
/// compartan una única fuente de verdad — nunca usar `Color(0x...)` suelto
/// dentro de un widget.
///
/// ⚠️ Auditoría de accesibilidad (ver `docs/ACCESSIBILITY.md`): los
/// valores de `primary`, `success`, `warning` y `error` fueron ajustados
/// (oscurecidos, mismo matiz/saturación) porque las versiones originales
/// no alcanzaban el contraste mínimo WCAG AA (4.5:1) contra texto blanco
/// — que es exactamente cómo se usan en botones, badges y el
/// `ColorScheme` (`onPrimary`/`onError` blancos). Verificado
/// programáticamente, no a ojo — ver el script de auditoría en el
/// documento citado.
abstract class AppColors {
  // Color primario: energía, rendimiento (evita el azul genérico de ROUVY)
  // Oscurecido de FF4D2E → E82200 (mismo matiz ~9°, misma saturación
  // 100%) para pasar de 3.31:1 a 4.50:1 de contraste con texto blanco.
  static const Color primary = Color(0xFFE82200);
  static const Color primaryDark = Color(0xFFD93A1F);
  static const Color secondary = Color(0xFF00C2A8); // verde-azulado (zonas FC)

  // Neutros — modo claro
  static const Color lightBackground = Color(0xFFF7F7F9);
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightOnSurface = Color(0xFF1A1A1E);

  // Neutros — modo oscuro
  static const Color darkBackground = Color(0xFF0E0E11);
  static const Color darkSurface = Color(0xFF1B1B20);
  static const Color darkOnSurface = Color(0xFFF2F2F4);

  // Semánticos (zonas de frecuencia cardíaca / potencia — usados en el HUD)
  static const Color zone1 = Color(0xFF7FB3FF); // recuperación
  static const Color zone2 = Color(0xFF4DD6C0); // aeróbico
  static const Color zone3 = Color(0xFFFFD166); // tempo
  static const Color zone4 = Color(0xFFFF8C42); // umbral
  static const Color zone5 = Color(0xFFEF476F); // anaeróbico

  // Oscurecidos por el mismo motivo que `primary` — de 2ECC71/F39C12/E74C3C
  // (2.10:1 / 2.19:1 / 3.82:1 con blanco, los 3 reprobaban AA) a estos,
  // los 3 en ~4.5:1. `success` se reajustó de 1F884B (4.4857:1, por debajo
  // del mínimo) a 1F804B (4.94:1) — mismo matiz, un pelín más oscuro.
  static const Color success = Color(0xFF1F804B);
  static const Color error = Color(0xFFE22E1C);
  static const Color warning = Color(0xFFA66908);
}

// ===========================================================================
// KORIXA DARK TECH — fundación de diseño (KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01)
// ===========================================================================
//
// Tokens de la dirección visual aprobada "Korixa Dark Tech" — ver
// `docs/design/KORIXA_VISUAL_DIRECTION.md` y `docs/design/KORIXA_DESIGN_SYSTEM.md`.
//
// ⚠️ TODAVÍA NO están cableados en `AppTheme.light`/`AppTheme.dark` — los
// tokens de `AppColors` de arriba (`primary`/`secondary`/`light*`/`dark*`)
// siguen siendo el tema ACTIVO de la app. Esta tarea es fundación
// únicamente; la migración real de pantallas es una tarea posterior (ver
// `docs/design/KORIXA_SCREEN_SPECS.md`). `AppTheme.darkTech` (ver
// `app_theme.dart`) SÍ construye un `ThemeData` completo con estos tokens,
// para probar que la API funciona — pero no está conectado a
// `MaterialApp` todavía.
//
// Cada valor fue validado programáticamente contra `ColorContrast`
// (`lib/core/utils/color_contrast.dart`), NO copiado a ciegas de la
// propuesta original — dos ajustes concretos, documentados:
//   1. `textMuted` fija en `#8A90A0` (la propuesta solo decía "un neutro
//      oscuro adecuado"): pasa AA de texto normal (4.5:1) contra las 3
//      superficies oscuras (5.61–6.34:1), con margen real.
//   2. `brandCyan` (#00D9FF) es demasiado claro para llevar texto blanco
//      encima — medido: 1.70:1 contra blanco, muy por debajo de 4.5:1, y
//      ninguna variante de cian razonablemente "cian" lo resuelve (hasta
//      un cian sustancialmente más oscuro, #0082A0, sigue en 4.47:1). Por
//      eso el gradiente de marca tiene DOS variantes — ver
//      `app_gradients.dart`: `primary` (3 paradas, decorativo, nunca con
//      texto encima) y `primaryCta` (2 paradas, morado→azul, el único
//      gradiente donde un texto blanco puede apoyarse con seguridad).
abstract class DarkTech {
  // --- Superficies (profundidad tonal, sin sombras Material) ---
  static const Color background = Color(0xFF05060A);
  static const Color surface = Color(0xFF0D1017);
  static const Color surfaceElevated = Color(0xFF131722);
  static const Color border = Color(0xFF242A38);

  /// Borde de foco/selección (`BORDER_ACTIVE`) — contraste no-textual
  /// (WCAG 1.4.11, umbral 3.0:1) verificado contra `surface`: 3.72:1.
  static const Color borderActive = brandBlue;

  /// Superficie de un control deshabilitado — WCAG exime explícitamente
  /// a los controles inactivos del requisito de contraste (1.4.3), así
  /// que no necesita pasar 4.5:1; solo debe leerse como "apagado".
  static const Color disabledSurface = Color(0xFF1A1E29);
  static const Color disabledForeground = textMuted;

  /// Scrim para diálogos/bottom sheets y overlays de foto en pantallas
  /// emocionales (Sección 13 — legibilidad de texto sobre imagen).
  static const Color overlayScrim = Color(0x99000000); // negro @ 60%

  // --- Marca ---
  /// Morado base — texto blanco encima pasa AA normal con margen real
  /// (5.93:1). Preferir este sobre `brandPurpleBright` para cualquier
  /// superficie que lleve texto (botones, badges).
  static const Color brandPurple = Color(0xFF8B00FF);

  /// Variante más clara/vibrante — texto blanco encima pasa AA normal
  /// justo en el límite (4.60:1, umbral 4.5:1). Preferir para acentos
  /// gráficos/íconos/bordes, no como fondo de texto de cuerpo pequeño.
  static const Color brandPurpleBright = Color(0xFFB026FF);

  static const Color brandBlue = Color(0xFF315CFF);

  /// Uso EXCLUSIVAMENTE decorativo/gráfico (bordes, íconos, extremo de
  /// `AppGradients.primary`) — nunca con texto encima, ver nota de
  /// arriba. Como acento/ícono sobre `surface` sí pasa el umbral no
  /// textual (3.0:1): 11.21:1, con muchísimo margen.
  static const Color brandCyan = Color(0xFF00D9FF);

  // --- Texto ---
  static const Color textPrimary = Color(0xFFF7F8FC);
  static const Color textSecondary = Color(0xFFA7ADBA);
  static const Color textMuted = Color(0xFF8A90A0);

  // --- Semánticos (status — ver Sección 11: verde=conectado/éxito,
  // ámbar=advertencia, rojo=error/desconexión crítica; el morado/azul/
  // cian de marca es para selección/progreso/énfasis interactivo, NUNCA
  // para estos tres significados) ---
  static const Color success = Color(0xFF22C55E);
  static const Color warning = Color(0xFFF5A623);
  static const Color error = Color(0xFFFF5C5C);

  // --- Dificultad de ruta (Sección 11: nunca reusar success/error para
  // esto — es una escala de intensidad de marca, no un semáforo de
  // estado). Reusa los 4 tonos de marca ya definidos arriba, sin
  // introducir colores nuevos. ---
  static const Color difficultyEasy = brandCyan;
  static const Color difficultyModerate = brandBlue;
  static const Color difficultyHard = brandPurple;
  static const Color difficultyExtreme = brandPurpleBright;
}
