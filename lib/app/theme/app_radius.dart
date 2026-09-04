import 'package:flutter/material.dart';

/// Escala de radios — Korixa Dark Tech (KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01).
///
/// Antes de esta tarea, los radios estaban dispersos entre al menos 7
/// valores distintos sin escala compartida (auditoría
/// KORIXA-UIUX-DESIGN-SYSTEM-AUDIT-01: 1, 6, 8, 10, 12, 14, 16). Esta
/// clase consolida esos valores en una escala de 5 pasos.
abstract class AppRadius {
  static const double sm = 8; // chips, badges, inputs pequeños
  static const double md = 12; // botones, inputs
  static const double lg = 16; // cards (coincide con el `cardTheme` actual)
  static const double xl = 20; // bottom sheets, modales grandes
  static const double pill = 999; // píldoras, avatares, indicadores redondos

  static const BorderRadius smRadius = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius mdRadius = BorderRadius.all(Radius.circular(md));
  static const BorderRadius lgRadius = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius xlRadius = BorderRadius.all(Radius.circular(xl));
  static const BorderRadius pillRadius = BorderRadius.all(Radius.circular(pill));
}
