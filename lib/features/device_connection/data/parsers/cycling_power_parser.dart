import 'dart:typed_data';

class CyclingPowerReading {
  const CyclingPowerReading({required this.powerWatts, this.cadenceRpm});

  final int powerWatts;

  /// Solo presente si el medidor incluye "Crank Revolution Data" — no
  /// todos los medidores de potencia lo hacen (algunos solo miden watts).
  final int? cadenceRpm;
}

/// Decodifica **Cycling Power Measurement** (UUID `0x2A63`) del **Cycling
/// Power Service** (`0x1818`).
///
/// A diferencia de FTMS, la cadencia aquí NO viene como un valor directo:
/// el paquete trae un contador acumulado de revoluciones de biela + una
/// marca de tiempo del evento (resolución 1/1024s). Hay que quedarse con
/// la lectura anterior y **derivar** la cadencia:
///
/// `rpm = (revoluciones_nuevas - revoluciones_anteriores) /
///        ((tiempo_nuevo - tiempo_anterior) / 1024) * 60`
///
/// Por eso este parser NO es una función pura como el de FTMS — es una
/// clase con estado, una instancia por dispositivo conectado (la crea y
/// guarda `BleDataSource` por cada suscripción activa).
class CyclingPowerParser {
  int? _lastCrankRevolutions;
  int? _lastCrankEventTime; // unidades de 1/1024 s, uint16 con wraparound

  CyclingPowerReading? parse(Uint8List data) {
    if (data.length < 4) return null;

    final ByteData bytes = ByteData.sublistView(data);
    final int flags = bytes.getUint16(0, Endian.little);
    int offset = 2;

    // Instantaneous Power: SIEMPRE presente, incondicional a los flags.
    final int powerWatts = bytes.getInt16(offset, Endian.little);
    offset += 2;

    bool flagSet(int bit) => (flags & (1 << bit)) != 0;

    // Bit 0/1: Pedal Power Balance (1 byte) — se omite, no se usa en el HUD.
    if (flagSet(0)) offset += 1;

    // Bit 2/3: Accumulated Torque (uint16) — se omite.
    if (flagSet(2)) offset += 2;

    // Bit 4: Wheel Revolution Data (uint32 + uint16) — se omite aquí; si el
    // medidor también reporta velocidad por rueda, se trataría igual que
    // en `CscParser`, pero es infrecuente en medidores de potencia.
    if (flagSet(4)) offset += 6;

    // Bit 5: Crank Revolution Data — de aquí derivamos cadencia.
    int? cadenceRpm;
    if (flagSet(5) && offset + 4 <= data.length) {
      final int crankRevolutions = bytes.getUint16(offset, Endian.little);
      final int crankEventTime = bytes.getUint16(offset + 2, Endian.little);
      offset += 4;

      cadenceRpm = _deriveCadence(crankRevolutions, crankEventTime);
      _lastCrankRevolutions = crankRevolutions;
      _lastCrankEventTime = crankEventTime;
    }

    return CyclingPowerReading(powerWatts: powerWatts, cadenceRpm: cadenceRpm);
  }

  int? _deriveCadence(int revolutions, int eventTime) {
    if (_lastCrankRevolutions == null || _lastCrankEventTime == null) {
      return null; // primera lectura: aún no hay intervalo que medir
    }

    // Ambos contadores son uint16 y dan la vuelta (wraparound) al llegar a
    // 65536 — se suma 65536 antes de restar cuando el valor "bajó".
    final int revDelta = revolutions >= _lastCrankRevolutions!
        ? revolutions - _lastCrankRevolutions!
        : (revolutions + 65536) - _lastCrankRevolutions!;
    final int timeDelta = eventTime >= _lastCrankEventTime!
        ? eventTime - _lastCrankEventTime!
        : (eventTime + 65536) - _lastCrankEventTime!;

    if (timeDelta == 0 || revDelta == 0) return 0; // pedaleo detenido

    final double seconds = timeDelta / 1024.0;
    return ((revDelta / seconds) * 60).round();
  }
}
