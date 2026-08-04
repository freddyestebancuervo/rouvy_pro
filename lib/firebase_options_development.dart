// File generated for the Development environment (`ridepro-development`).
// Mirrors the structure FlutterFire CLI produces, restricted to Web only —
// no Android/iOS/Windows app has been registered in `ridepro-development`.
// ignore_for_file: type=lint
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show kIsWeb;

/// [FirebaseOptions] for the Development environment. Used exclusively by
/// `main_development.dart` — never imported from `main.dart` or any
/// Production code path.
class DefaultFirebaseOptionsDevelopment {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    throw UnsupportedError(
      'DefaultFirebaseOptionsDevelopment have not been configured for this '
      'platform — only Web is registered in ridepro-development.',
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
