import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'demo/demo_injection.dart';
import 'demo/demo_overrides.dart';

/// Punto de entrada del MODO DEMO — ver `docs/DEMO_MODE.md`.
///
/// Diferencias deliberadas frente a `main.dart`:
/// - NUNCA llama a `Firebase.initializeApp()`.
/// - NO habilita persistencia de Firestore (no hay Firestore).
/// - NO arranca `FirestoreSyncService` ni `BleDataSource.restoreKnownDevices()`
///   (ninguno de los dos existe en este árbol de ejecución).
/// - Usa `initDemoDependencyInjection()` (solo 3 registros inofensivos)
///   en vez de `initDependencyInjection()` (que registraría
///   `FirebaseAuth`/`FirebaseFirestore` reales).
///
/// Ejecutar con:
///   flutter run -t lib/main_demo.dart
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await initDemoDependencyInjection();

  runApp(
    ProviderScope(
      overrides: buildDemoOverrides(),
      child: const _DemoBannerWrapper(child: RideProApp()),
    ),
  );
}

/// Cinta "DEMO" en la esquina — para que nunca se confunda una build de
/// demostración con la app real, ni siquiera en una captura de pantalla
/// suelta compartida por WhatsApp/Slack.
class _DemoBannerWrapper extends StatelessWidget {
  const _DemoBannerWrapper({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Banner(
      message: 'DEMO',
      location: BannerLocation.topEnd,
      color: Colors.deepPurple,
      child: child,
    );
  }
}
