import 'dart:typed_data';

/// Decodifica **Heart Rate Measurement** (UUID `0x2A37`) del **Heart Rate
/// Service** (`0x180D`) — soportado prácticamente por cualquier pulsómetro
/// BLE del mercado (pecho o de muñeca).
///
/// Formato: el bit 0 del primer byte (Flags) indica si el valor de bpm
/// viene en 1 byte (uint8, 0-255) o 2 bytes (uint16) — casi todos los
/// pulsómetros usan el formato de 1 byte, pero la spec permite ambos.
abstract class HeartRateParser {
  static int? parseHeartRateMeasurement(Uint8List data) {
    if (data.isEmpty) return null;

    final int flags = data[0];
    final bool isUint16Format = (flags & 0x01) != 0;

    if (isUint16Format) {
      if (data.length < 3) return null;
      return ByteData.sublistView(data).getUint16(1, Endian.little);
    } else {
      if (data.length < 2) return null;
      return data[1];
    }
  }
}
