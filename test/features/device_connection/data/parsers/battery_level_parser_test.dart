import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/device_connection/data/parsers/battery_level_parser.dart';

void main() {
  group('BatteryLevelParser', () {
    test('decodifica un porcentaje normal', () {
      expect(BatteryLevelParser.parseBatteryLevel(Uint8List.fromList(<int>[85])), 85);
    });

    test('limita el valor a un máximo de 100', () {
      expect(BatteryLevelParser.parseBatteryLevel(Uint8List.fromList(<int>[200])), 100);
    });

    test('devuelve null con un paquete vacío', () {
      expect(BatteryLevelParser.parseBatteryLevel(Uint8List(0)), isNull);
    });
  });
}
