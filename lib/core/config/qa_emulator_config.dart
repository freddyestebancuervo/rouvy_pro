import 'package:flutter/foundation.dart' show kDebugMode;

/// Activa la conexión a Firebase Local Emulator Suite (Auth + Firestore)
/// en vez del proyecto real (`ridepro-dbafe`). Doble candado: `kDebugMode`
/// (siempre `false` en `flutter build`/`--release`, así que esta rama es
/// código muerto en producción) Y el flag explícito
/// `--dart-define=USE_FIREBASE_EMULATORS=true` (nunca se activa por
/// accidente en un debug normal sin pasarlo). Ver `firebase/seed/` para
/// cómo levantar los emuladores y sembrar datos de prueba.
abstract class QaEmulatorConfig {
  static const bool _flag = bool.fromEnvironment('USE_FIREBASE_EMULATORS');

  static bool get useFirebaseEmulators => kDebugMode && _flag;
}
