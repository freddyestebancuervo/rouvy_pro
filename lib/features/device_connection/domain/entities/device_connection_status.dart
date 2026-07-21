/// Estado de conexión de un dispositivo individual. Se modela como enum
/// explícito (no un simple `bool connected`) porque la UI necesita
/// distinguir "nunca conectado", "conectando", "reconectando tras una
/// caída de señal" y "falló definitivamente" — cada uno se muestra con un
/// ícono/color distinto en `device_tile.dart`.
enum DeviceConnectionStatus {
  disconnected,
  scanning,
  connecting,
  connected,
  reconnecting,
  connectionFailed,
}

/// Calidad de señal derivada del RSSI (Received Signal Strength
/// Indicator, en dBm — típicamente entre -100 y 0, más cercano a 0 es
/// mejor). Se expone como enum discreto en vez del dBm crudo porque es lo
/// que realmente le importa mostrar al usuario (barras de señal), no el
/// número exacto.
enum SignalQuality {
  excellent, // >= -60 dBm
  good, // -60 a -75 dBm
  weak, // -75 a -90 dBm
  veryWeak; // < -90 dBm

  static SignalQuality fromRssi(int rssi) {
    if (rssi >= -60) return SignalQuality.excellent;
    if (rssi >= -75) return SignalQuality.good;
    if (rssi >= -90) return SignalQuality.weak;
    return SignalQuality.veryWeak;
  }
}
