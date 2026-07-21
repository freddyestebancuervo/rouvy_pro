/// UUIDs estándar del Bluetooth SIG (GATT). Todos los rodillos y sensores
/// compatibles (Wahoo, Tacx, Elite, Zwift Hub, JetBlack, ThinkRider, y
/// pulsómetros/medidores de potencia genéricos) implementan estos mismos
/// servicios — es lo que hace posible soportarlos a todos con el mismo
/// código, sin SDKs propietarios por fabricante.
///
/// Referencia: https://www.bluetooth.com/specifications/assigned-numbers/
abstract class BleUuids {
  // ---------------------------------------------------------------------
  // Servicios (Services)
  // ---------------------------------------------------------------------

  /// Fitness Machine Service — rodillos inteligentes modernos (Wahoo KICKR,
  /// Tacx Neo, Elite Suito/Direto, Zwift Hub). Expone potencia, cadencia,
  /// velocidad Y permite controlar la resistencia (modo ERG/Sim).
  static const String fitnessMachine = '00001826-0000-1000-8000-00805f9b34fb';

  /// Cycling Power Service — medidores de potencia dedicados (pedales,
  /// bielas) y rodillos más antiguos que no implementan FTMS completo.
  static const String cyclingPower = '00001818-0000-1000-8000-00805f9b34fb';

  /// Cycling Speed and Cadence Service — sensores de velocidad/cadencia
  /// independientes (imán en la rueda/biela), comunes en JetBlack y
  /// ThinkRider cuando se usan como sensores sueltos en vez de rodillo FTMS.
  static const String cyclingSpeedCadence = '00001816-0000-1000-8000-00805f9b34fb';

  /// Heart Rate Service — prácticamente universal en pulsómetros BLE.
  static const String heartRate = '0000180d-0000-1000-8000-00805f9b34fb';

  /// Battery Service — nivel de batería del sensor (no todos lo exponen;
  /// algunos rodillos conectados a corriente no lo implementan).
  static const String battery = '0000180f-0000-1000-8000-00805f9b34fb';

  /// Device Information Service — fabricante/modelo, útil para mostrar en
  /// la ficha del dispositivo en la pantalla de gestión.
  static const String deviceInformation = '0000180a-0000-1000-8000-00805f9b34fb';

  // ---------------------------------------------------------------------
  // Características (Characteristics)
  // ---------------------------------------------------------------------

  /// Indoor Bike Data — dentro de [fitnessMachine]. Notifica velocidad,
  /// cadencia, potencia y distancia en un único paquete binario.
  static const String indoorBikeData = '00002ad2-0000-1000-8000-00805f9b34fb';

  /// Fitness Machine Control Point — permite ENVIAR comandos al rodillo
  /// (fijar resistencia objetivo / simular pendiente). Requiere primero
  /// escribir en [fitnessMachineFeature] y negociar control; se implementa
  /// en detalle cuando se construya el módulo de rutas video/3D (M4), que
  /// es quien decide qué pendiente simular.
  static const String fitnessMachineControlPoint = '00002ad9-0000-1000-8000-00805f9b34fb';

  static const String fitnessMachineFeature = '00002acc-0000-1000-8000-00805f9b34fb';

  /// Cycling Power Measurement — dentro de [cyclingPower]. Notifica watts
  /// instantáneos (y opcionalmente cadencia vía "crank revolution data").
  static const String cyclingPowerMeasurement = '00002a63-0000-1000-8000-00805f9b34fb';

  /// CSC Measurement — dentro de [cyclingSpeedCadence]. Notifica contadores
  /// acumulados de revoluciones de rueda/biela; la velocidad/cadencia se
  /// calculan derivando esos contadores en el tiempo (ver `csc_parser.dart`).
  static const String cscMeasurement = '00002a5b-0000-1000-8000-00805f9b34fb';

  /// Heart Rate Measurement — dentro de [heartRate]. Notifica bpm.
  static const String heartRateMeasurement = '00002a37-0000-1000-8000-00805f9b34fb';

  /// Battery Level — dentro de [battery]. Un solo byte, 0-100.
  static const String batteryLevel = '00002a19-0000-1000-8000-00805f9b34fb';

  static const String manufacturerNameString = '00002a29-0000-1000-8000-00805f9b34fb';

  /// Todos los servicios que el escáner filtra activamente — cualquier
  /// dispositivo BLE que no anuncie al menos uno de estos se descarta antes
  /// de mostrarse en la lista, para no saturar al usuario con dispositivos
  /// irrelevantes (auriculares, relojes, etc.) durante el escaneo.
  static const List<String> scannableServices = <String>[
    fitnessMachine,
    cyclingPower,
    cyclingSpeedCadence,
    heartRate,
  ];
}
