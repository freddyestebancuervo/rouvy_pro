/// Estado de sincronización combinado (conectividad + escrituras
/// pendientes de Firestore) — lo que consume el banner global de la app.
enum SyncStatus {
  /// Con conexión y sin escrituras locales pendientes de llegar al
  /// servidor. Estado normal, no se muestra ningún banner.
  online,

  /// Sin conexión. Las lecturas se sirven desde caché local y las
  /// escrituras se aceptan igualmente (quedan en cola) — la app sigue
  /// siendo completamente funcional, pero se informa al usuario.
  offline,

  /// Se acaba de recuperar la conexión y hay escrituras locales
  /// pendientes de confirmarse contra el servidor — estado transitorio,
  /// normalmente dura segundos.
  syncingPendingWrites,
}
