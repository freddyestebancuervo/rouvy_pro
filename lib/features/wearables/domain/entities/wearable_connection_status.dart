/// Estado de conexión de un proveedor. [pendingPartnerApproval] es un
/// estado que NO existe en el módulo BLE (`DeviceConnectionStatus`) — es
/// específico de wearables, porque aquí "no conectado" y "no se puede
/// conectar todavía porque no tenemos acceso oficial" son dos cosas
/// distintas que la UI debe comunicar de forma diferente (un botón
/// deshabilitado con explicación, no un simple "Conectar" que fallaría).
enum WearableConnectionStatus {
  notConnected,
  connecting,
  connected,
  syncing,
  error,
  pendingPartnerApproval,
}
