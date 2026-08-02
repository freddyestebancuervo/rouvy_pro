import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_environment.dart';
import '../core/config/qa_emulator_config.dart';
import '../core/di/injection.dart';
import '../core/sync/firestore_sync_service.dart';
import '../features/device_connection/data/datasources/ble_datasource.dart';
import 'app.dart';

/// Arranque compartido entre todos los entry points (`main.dart`,
/// `main_development.dart`, y futuros entry points de entorno — ver
/// Documento 21, Fases 0.1/0.2). Deliberadamente NO importa ningún
/// `firebase_options*.dart`, `social_login_config*.dart` ni
/// `environment_*.dart` — solo recibe el [AppEnvironment] ya resuelto por
/// el entry point que lo llama, para que la garantía de que un binario de
/// un entorno no puede contener físicamente los símbolos de otro entorno
/// siga dependiendo exclusivamente de qué importa cada `main_X.dart`, no
/// de este archivo compartido.
Future<void> bootstrapRideProApp(AppEnvironment environment) async {
  // `runZonedGuarded` + `FlutterError.onError` capturan absolutamente todo:
  // errores de widgets (síncronos) y errores asíncronos no atrapados
  // (p. ej. dentro de un `Future` sin `try/catch`). Sin esto, un error
  // async fuera del árbol de widgets tumbaría la app en producción sin
  // ningún registro en Crashlytics.
  await runZonedGuarded<Future<void>>(() async {
    WidgetsFlutterBinding.ensureInitialized();

    await Firebase.initializeApp(options: environment.firebaseOptions);

    if (QaEmulatorConfig.useFirebaseEmulators) {
      // QA local (ver `firebase/seed/`) — debe llamarse antes de
      // cualquier otro uso de Auth/Firestore, por eso va primero incluso
      // que el bloque de persistencia normal de más abajo.
      await FirebaseAuth.instance.useAuthEmulator('localhost', 9099);
      FirebaseFirestore.instance.useFirestoreEmulator('localhost', 8080);
    } else {
      // ---------------------------------------------------------------------
      // Persistencia offline de Firestore — DEBE configurarse antes de
      // cualquier lectura/escritura (`Settings` solo tiene efecto si se
      // asigna antes del primer uso de una instancia de Firestore; asignarlo
      // más tarde lanza una excepción de "ya inicializado"). Ver
      // `docs/OFFLINE_FIRST.md` para el comportamiento completo.
      //
      // Con esto activado, `cloud_firestore` mantiene una caché local en
      // disco: las lecturas se sirven desde caché cuando no hay red, y las
      // escrituras (p. ej. `RideSessionRepositoryImpl.saveSession`) se
      // aplican de inmediato a la caché local y se cola para sincronizar en
      // cuanto vuelva la conexión — sin que el código de los repositorios
      // necesite ningún `try/catch` adicional para el caso offline, ya que
      // el propio SDK resuelve el `Future` de la escritura como exitoso en
      // cuanto queda persistida localmente.
      FirebaseFirestore.instance.settings = const Settings(
        persistenceEnabled: true,
        cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
      );
    }

    // Errores de Flutter (build/layout/paint) → Crashlytics en release,
    // impresos en consola en debug.
    FlutterError.onError = (FlutterErrorDetails details) {
      if (kDebugMode) {
        FlutterError.presentError(details);
      } else {
        FirebaseCrashlytics.instance.recordFlutterFatalError(details);
      }
    };

    // Analytics: se registra como singleton temprano; los eventos de
    // pantalla se añadirán vía `FirebaseAnalyticsObserver` en GoRouter
    // cuando se defina el árbol completo de rutas.
    FirebaseAnalytics.instance;

    await initDependencyInjection(environment);

    // Empieza a escuchar cambios de conectividad para el banner global de
    // sincronización (ver `core/sync/firestore_sync_service.dart` y
    // `docs/OFFLINE_FIRST.md`) — igual que la reconexión BLE, vive tanto
    // como el proceso, no se detiene nunca explícitamente.
    sl<FirestoreSyncService>().start();

    // No se espera (`unawaited`): la reconexión BLE puede tardar varios
    // segundos por dispositivo y no debe retrasar la primera pantalla. La
    // pantalla de gestión de dispositivos ya refleja el progreso en vivo
    // vía `connectedDevicesStream` en cuanto el usuario entra a verla.
    unawaited(sl<BleDataSource>().restoreKnownDevices());

    runApp(const ProviderScope(child: RideProApp()));
  }, (Object error, StackTrace stackTrace) {
    // Errores async no capturados fuera del árbol de widgets.
    if (kDebugMode) {
      // ignore: avoid_print
      print('Uncaught async error: $error\n$stackTrace');
    } else {
      FirebaseCrashlytics.instance.recordError(error, stackTrace, fatal: true);
    }
  });
}
