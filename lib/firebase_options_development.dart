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
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;

/// Espejo de `DefaultFirebaseOptions` (Production) para Development — ver
/// `lib/core/config/environments/environment_development.dart`, que es el
/// único punto que debería importar esta clase.
class DefaultFirebaseOptionsDevelopment {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    throw UnsupportedError(
      'El proyecto Firebase de Development (`ridepro-development`) solo '
      'tiene registrada una app Web hoy — no hay configuración para '
      '$defaultTargetPlatform en este entorno. Registrá la app que falte '
      'en Firebase (`firebase apps:create`) y agregala acá antes de correr '
      'main_development.dart fuera de Web.',
    );
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyAt5C2nVL3EptKe6uFWWMG6U8Z_lRagQaU',
    appId: '1:1020003121433:web:5920d585dd6dbdb50f6d88',
    messagingSenderId: '1020003121433',
    projectId: 'ridepro-development',
    authDomain: 'ridepro-development.firebaseapp.com',
    storageBucket: 'ridepro-development.firebasestorage.app',
  );
}
