import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../di/injection.dart';
import 'firestore_sync_service.dart';
import 'sync_status.dart';

/// Expone el stream de `FirestoreSyncService` (ya arrancado desde
/// `main.dart`) a la capa de presentación. No se crea una nueva instancia
/// del servicio aquí — se reutiliza el singleton de `sl`, para que el
/// estado de conectividad sea uno solo compartido por toda la app, no uno
/// distinto por cada widget que lo observe.
final syncStatusProvider = StreamProvider<SyncStatus>((Ref ref) {
  return sl<FirestoreSyncService>().statusStream;
});
