/// Tipo funcional del dispositivo — NO el fabricante. Wahoo, Tacx, Elite,
/// Zwift Hub, JetBlack y ThinkRider implementan todos el mismo estándar
/// FTMS, así que a nivel de dominio son indistinguibles como
/// [smartTrainer]; el fabricante es solo un dato informativo (ver
/// `BleDevice.manufacturer`) que no cambia ningún comportamiento.
enum SportDeviceType {
  smartTrainer,
  powerMeter,
  heartRateMonitor,
  cadenceSensor,
  speedSensor,
  speedCadenceCombo,
  unknown;

  /// Un dispositivo puede anunciar varios servicios a la vez (p. ej. un
  /// rodillo FTMS que también expone Cycling Power). Se prioriza en el
  /// orden en que un ciclista esperaría verlo clasificado: primero como
  /// rodillo (lo más específico/capaz), luego potencia, luego cadencia o
  /// velocidad combinadas, y heart rate al final porque nunca se solapa
  /// con los anteriores.
  static SportDeviceType fromAdvertisedServices(List<String> serviceUuids) {
    final Set<String> services = serviceUuids.map((String s) => s.toLowerCase()).toSet();

    bool has(String uuid) => services.contains(uuid.toLowerCase());

    if (has(_fitnessMachine)) return SportDeviceType.smartTrainer;
    if (has(_cyclingPower)) return SportDeviceType.powerMeter;
    if (has(_cyclingSpeedCadence)) return SportDeviceType.speedCadenceCombo;
    if (has(_heartRate)) return SportDeviceType.heartRateMonitor;
    return SportDeviceType.unknown;
  }

  // Duplicadas aquí como const de solo comparación (en vez de importar
  // `BleUuids` desde `core/`) para que esta enumeración de dominio no
  // dependa de una capa de infraestructura — regla de Clean Architecture.
  static const String _fitnessMachine = '00001826-0000-1000-8000-00805f9b34fb';
  static const String _cyclingPower = '00001818-0000-1000-8000-00805f9b34fb';
  static const String _cyclingSpeedCadence = '00001816-0000-1000-8000-00805f9b34fb';
  static const String _heartRate = '0000180d-0000-1000-8000-00805f9b34fb';
}
