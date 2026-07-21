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
