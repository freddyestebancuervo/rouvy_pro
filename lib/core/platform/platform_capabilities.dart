import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// Centraliza la decisión de arquitectura: **Android e iOS son las
/// plataformas principales de entrenamiento** (ver
/// `ARCHITECTURE_DECISIONS.md`, sección 3). Web se mantiene soportado
/// para todo lo que no dependa de BLE (auth, perfil, catálogo de rutas,
/// estadísticas, panel...), pero el flujo de entrenamiento en vivo se
/// comunica como "experiencia completa en móvil" sin bloquear su uso
/// desde Web cuando el navegador sí soporta Web Bluetooth.
///
/// Ninguna pantalla debe repetir esta lógica de plataforma por su cuenta
/// (`if (kIsWeb) ...` disperso por la UI) — todas consultan este único
/// punto, así la decisión de negocio queda en un solo lugar si cambia.
abstract class PlatformCapabilities {
  /// `true` en Android e iOS — las plataformas para las que se optimiza
  /// primero cualquier feature nueva de entrenamiento.
  static bool get isPrimaryTrainingPlatform {
    if (kIsWeb) return false;
    return defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS;
  }

  static bool get isWeb => kIsWeb;
}
