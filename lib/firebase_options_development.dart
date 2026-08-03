// Configuración manual del entorno Development (`ridepro-development`),
// obtenida con `firebase apps:sdkconfig WEB <appId> --project
// ridepro-development` — mismo formato que genera FlutterFire CLI para
// `firebase_options.dart` (Production), pero mantenido a mano porque hoy
// `ridepro-development` solo tiene registrada una app Web (ver
// `docs/audits/AUDITORIA_FINAL/17_CIERRE_FIRESTORE_RIDEPRO_DEVELOPMENT.md`,
// secciones 11-12). Actualizar corriendo `flutterfire configure --project
// ridepro-development` en cuanto se registren más plataformas.
// ignore_for_file: type=lint
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// Espejo de `DefaultFirebaseOptions` (Production) para Development — ver
/// `lib/core/config/environments/environment_development.dart`, que es el
/// único punto que debería importar esta clase.
class DefaultFirebaseOptionsDevelopment {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      default:
        throw UnsupportedError(
          'El proyecto Firebase de Development (`ridepro-development`) no '
          'tiene configuración para $defaultTargetPlatform todavía (solo Web '
          'y Android, T-F0.2 Bloque 5A) — iOS queda explícitamente pendiente. '
          'Registrá la app que falte en Firebase (`firebase apps:create`) y '
          'agregala acá antes de correr main_development.dart en esa plataforma.',
        );
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyAt5C2nVL3EptKe6uFWWMG6U8Z_lRagQaU',
    appId: '1:1020003121433:web:5920d585dd6dbdb50f6d88',
    messagingSenderId: '1020003121433',
    projectId: 'ridepro-development',
    authDomain: 'ridepro-development.firebaseapp.com',
    storageBucket: 'ridepro-development.firebasestorage.app',
  );

  /// Registrada en T-F0.2 Bloque 5A (Android Development Foundation).
  /// Google Sign-In Android en Development queda pendiente de SHA-1/SHA-256
  /// — ver docs/audits/AUDITORIA_FINAL/24_ANDROID_DEVELOPMENT_FOUNDATION.md.
  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyC51G-OHGDmZbFHgyRGhUFB-Cis-txJxW8',
    appId: '1:1020003121433:android:cb71425e96b4fe430f6d88',
    messagingSenderId: '1020003121433',
    projectId: 'ridepro-development',
    storageBucket: 'ridepro-development.firebasestorage.app',
  );
}
