import 'dart:typed_data';

class CscReading {
  const CscReading({this.speedKmh, this.cadenceRpm});

  final double? speedKmh;
  final int? cadenceRpm;
}

/// Decodifica **CSC Measurement** (UUID `0x2A5B`) del **Cycling Speed and
/// Cadence Service** (`0x1816`) — el servicio que usan sensores sueltos
/// tipo imán-en-rueda (comunes como accesorio de JetBlack/ThinkRider
/// cuando no se usa su rodillo FTMS, o sensores genéricos de terceros).
///
/// Igual que `CyclingPowerParser`, requiere estado: el paquete trae
/// contadores acumulados de revoluciones (de rueda y/o de biela) + marca
/// de tiempo del evento, y hay que derivar velocidad/cadencia comparando
/// con la lectura anterior.
class CscParser {
  CscParser({this.wheelCircumferenceMm = 2105});

  /// Circunferencia de la rueda en milímetros — 2105mm es el estándar para
  /// una rueda de carretera 700x23c. Debería ser configurable por el
  /// usuario en Ajustes del dispositivo (tamaño de rueda real), ya que
  /// afecta directamente la precisión de la velocidad calculada; se deja
  /// como parámetro del constructor para que `DeviceRepositoryImpl` pueda
  /// inyectarlo desde una preferencia guardada cuando exista esa pantalla.
  final int wheelCircumferenceMm;

  int? _lastWheelRevolutions;
  int? _lastWheelEventTime;
  int? _lastCrankRevolutions;
  int? _lastCrankEventTime;

  CscReading parse(Uint8List data) {
    if (data.isEmpty) return const CscReading();

    final ByteData bytes = ByteData.sublistView(data);
    final int flags = data[0];
    int offset = 1;

    bool flagSet(int bit) => (flags & (1 << bit)) != 0;

    double? speedKmh;
    int? cadenceRpm;

    // Bit 0: Wheel Revolution Data → velocidad.
    if (flagSet(0) && offset + 6 <= data.length) {
      final int wheelRevolutions = bytes.getUint32(offset, Endian.little);
      final int wheelEventTime = bytes.getUint16(offset + 4, Endian.little);
      offset += 6;

      speedKmh = _deriveSpeed(wheelRevolutions, wheelEventTime);
      _lastWheelRevolutions = wheelRevolutions;
      _lastWheelEventTime = wheelEventTime;
    }

    // Bit 1: Crank Revolution Data → cadencia.
    if (flagSet(1) && offset + 4 <= data.length) {
      final int crankRevolutions = bytes.getUint16(offset, Endian.little);
      final int crankEventTime = bytes.getUint16(offset + 2, Endian.little);
      offset += 4;

      cadenceRpm = _deriveCadence(crankRevolutions, crankEventTime);
      _lastCrankRevolutions = crankRevolutions;
      _lastCrankEventTime = crankEventTime;
    }

    return CscReading(speedKmh: speedKmh, cadenceRpm: cadenceRpm);
  }

  double? _deriveSpeed(int revolutions, int eventTime) {
    if (_lastWheelRevolutions == null || _lastWheelEventTime == null) return null;

    final int revDelta = revolutions >= _lastWheelRevolutions!
        ? revolutions - _lastWheelRevolutions!
        : (revolutions + 4294967296) - _lastWheelRevolutions!; // uint32 wraparound
    final int timeDelta = eventTime >= _lastWheelEventTime!
        ? eventTime - _lastWheelEventTime!
        : (eventTime + 65536) - _lastWheelEventTime!;

    if (timeDelta == 0) return revDelta == 0 ? 0 : null;

    final double seconds = timeDelta / 1024.0;
    final double metersPerSecond = (revDelta * (wheelCircumferenceMm / 1000)) / seconds;
    return metersPerSecond * 3.6; // m/s → km/h
  }

  int? _deriveCadence(int revolutions, int eventTime) {
    if (_lastCrankRevolutions == null || _lastCrankEventTime == null) return null;

    final int revDelta = revolutions >= _lastCrankRevolutions!
        ? revolutions - _lastCrankRevolutions!
        : (revolutions + 65536) - _lastCrankRevolutions!;
    final int timeDelta = eventTime >= _lastCrankEventTime!
        ? eventTime - _lastCrankEventTime!
        : (eventTime + 65536) - _lastCrankEventTime!;

    if (timeDelta == 0) return revDelta == 0 ? 0 : null;

    final double seconds = timeDelta / 1024.0;
    return ((revDelta / seconds) * 60).round();
  }
}
