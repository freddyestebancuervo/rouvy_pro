import 'dart:typed_data';

/// Decodifica **Battery Level** (UUID `0x2A19`) del **Battery Service**
/// (`0x180F`) — un único byte, porcentaje directo de 0 a 100.
abstract class BatteryLevelParser {
  static int? parseBatteryLevel(Uint8List data) {
    if (data.isEmpty) return null;
    final int value = data[0];
    return value.clamp(0, 100);
  }
}
