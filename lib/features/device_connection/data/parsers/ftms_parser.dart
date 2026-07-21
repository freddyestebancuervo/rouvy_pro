import 'dart:typed_data';

/// Resultado de decodificar un paquete "Indoor Bike Data". Todos los campos
/// son opcionales porque el fabricante decide, vía el bitmask `Flags`, qué
/// incluye en cada paquete — dos rodillos distintos pueden enviar
/// combinaciones distintas de campos y ambos ser válidos según la spec.
class FtmsIndoorBikeData {
  const FtmsIndoorBikeData({
    this.speedKmh,
    this.cadenceRpm,
    this.powerWatts,
    this.heartRateBpm,
    this.totalDistanceMeters,
  });

  final double? speedKmh;
  final int? cadenceRpm;
  final int? powerWatts;
  final int? heartRateBpm;
  final int? totalDistanceMeters;
}

/// Decodifica el característica **Indoor Bike Data** (UUID `0x2AD2`) del
/// **Fitness Machine Service** (`0x1826`), definida en la especificación
/// "Fitness Machine Service" del Bluetooth SIG.
///
/// Formato del paquete (todo little-endian):
/// ```
/// [Flags: uint16] [campos opcionales según Flags, en este orden fijo]
/// ```
/// El bit 0 de Flags funciona al revés que el resto ("More Data": si es 0,
/// la velocidad instantánea SÍ está presente) — es una particularidad de
/// la spec, no un error de esta implementación.
abstract class FtmsParser {
  static FtmsIndoorBikeData parseIndoorBikeData(Uint8List data) {
    if (data.length < 2) {
      return const FtmsIndoorBikeData(); // paquete corrupto/incompleto — se ignora
    }

    final ByteData bytes = ByteData.sublistView(data);
    final int flags = bytes.getUint16(0, Endian.little);
    int offset = 2;

    double? speedKmh;
    int? cadenceRpm;
    int? powerWatts;
    int? heartRateBpm;
    int? totalDistanceMeters;

    bool flagSet(int bit) => (flags & (1 << bit)) != 0;

    // Bit 0 invertido: 0 = presente, 1 = ausente ("More Data").
    if (!flagSet(0) && offset + 2 <= data.length) {
      speedKmh = bytes.getUint16(offset, Endian.little) * 0.01;
      offset += 2;
    }

    // Bit 1: Average Speed — se omite (no la necesitamos en el HUD en vivo).
    if (flagSet(1)) offset += 2;

    // Bit 2: Instantaneous Cadence, resolución de 0.5 rpm.
    if (flagSet(2) && offset + 2 <= data.length) {
      cadenceRpm = (bytes.getUint16(offset, Endian.little) * 0.5).round();
      offset += 2;
    }

    // Bit 3: Average Cadence — se omite.
    if (flagSet(3)) offset += 2;

    // Bit 4: Total Distance — es un uint24 (3 bytes), caso especial sin
    // helper directo en ByteData.
    if (flagSet(4) && offset + 3 <= data.length) {
      totalDistanceMeters = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
      offset += 3;
    }

    // Bit 5: Resistance Level — se omite (no aplica a lectura, solo a control).
    if (flagSet(5)) offset += 2;

    // Bit 6: Instantaneous Power, sint16 vatios.
    if (flagSet(6) && offset + 2 <= data.length) {
      powerWatts = bytes.getInt16(offset, Endian.little);
      offset += 2;
    }

    // Bit 7: Average Power — se omite.
    if (flagSet(7)) offset += 2;

    // Bit 8: Expended Energy (Total, Per Hour: uint16 cada uno; Per Minute: uint8).
    if (flagSet(8)) offset += 5;

    // Bit 9: Heart Rate — algunos rodillos lo retransmiten si el pulsómetro
    // está emparejado directamente CON EL RODILLO (no con el teléfono).
    if (flagSet(9) && offset + 1 <= data.length) {
      heartRateBpm = data[offset];
      offset += 1;
    }

    return FtmsIndoorBikeData(
      speedKmh: speedKmh,
      cadenceRpm: cadenceRpm,
      powerWatts: powerWatts,
      heartRateBpm: heartRateBpm,
      totalDistanceMeters: totalDistanceMeters,
    );
  }
}
