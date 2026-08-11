// Configuración manual del entorno Development (`ridepro-development`),
// obtenida con `firebase apps:sdkconfig <PLATFORM> <appId> --project
// ridepro-development` — mismo formato que genera FlutterFire CLI para
// `firebase_options.dart` (Production), pero mantenido a mano. Web, Android
// e iOS ya están registradas y configuradas abajo (Web desde el bootstrap
// inicial, Android desde T-F0.2 Bloque 5A, iOS desde T-F0.2 Bloque 7 — ver
// PROJECT_STATUS.md §5 para el detalle y evidencia de cada una).
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
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError(
          'El proyecto Firebase de Development (`ridepro-development`) no '
          'tiene configuración para $defaultTargetPlatform (Web, Android e '
          'iOS ya están configuradas arriba) — registrá la app que falte '
          'en Firebase (`firebase apps:create`) y agregala acá antes de '
          'correr main_development.dart en esa plataforma.',
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
  /// Google Sign-In Android en Development validado en runtime real el
  /// 2026-08-09 (SHA-1/SHA-256 registrados, login real confirmado en
  /// Firebase Authentication) — ver PROJECT_STATUS.md §5.
  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyC51G-OHGDmZbFHgyRGhUFB-Cis-txJxW8',
    appId: '1:1020003121433:android:cb71425e96b4fe430f6d88',
    messagingSenderId: '1020003121433',
    projectId: 'ridepro-development',
    storageBucket: 'ridepro-development.firebasestorage.app',
  );

  /// Registrada en T-F0.2 iOS Development (Bundle ID com.korixa.app.dev).
  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyDSahBGUaF2hFEVAoQ4IXhtiejSyxjWsGA',
    appId: '1:1020003121433:ios:fdfe193b6d9e99130f6d88',
    messagingSenderId: '1020003121433',
    projectId: 'ridepro-development',
    storageBucket: 'ridepro-development.firebasestorage.app',
    iosClientId: '1020003121433-65qqk5sir98buvfffd6ua0g51jqor8av.apps.googleusercontent.com',
    iosBundleId: 'com.korixa.app.dev',
  );
}
