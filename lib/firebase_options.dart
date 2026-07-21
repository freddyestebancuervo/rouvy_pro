import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// ⚠️ ARCHIVO GENERADO AUTOMÁTICAMENTE — este es solo un placeholder.
///
/// Antes de ejecutar la app contra un proyecto Firebase real, el equipo
/// debe correr:
///
///   dart pub global activate flutterfire_cli
///   flutterfire configure
///
/// Eso sobrescribirá este archivo con las credenciales reales de cada
/// plataforma (Android/iOS/Web) generadas desde la consola de Firebase.
/// NO se deben escribir API keys a mano aquí.
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions no ha sido configurado para esta plataforma. '
          'Ejecuta `flutterfire configure`.',
        );
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    appId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    messagingSenderId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    projectId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    storageBucket: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    appId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    messagingSenderId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    projectId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    storageBucket: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    appId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    messagingSenderId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    projectId: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    storageBucket: 'REPLACE_WITH_FLUTTERFIRE_CONFIGURE',
    iosBundleId: 'com.ridepro.app',
  );
}
