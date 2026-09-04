/// Escala de espaciado — Korixa Dark Tech (KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01).
///
/// Antes de esta tarea no existía ningún sistema de espaciado: cada
/// pantalla hardcodeaba su propio `EdgeInsets`/`SizedBox` (auditoría
/// KORIXA-UIUX-DESIGN-SYSTEM-AUDIT-01 contó 31 sitios distintos en 34
/// archivos). Esta clase es la única fuente de verdad para pantallas
/// migradas a partir de ahora — las pantallas todavía no migradas siguen
/// con sus valores actuales (ver `docs/design/KORIXA_SCREEN_SPECS.md`).
abstract class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double base = 16;
  static const double lg = 20;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 40;
}
