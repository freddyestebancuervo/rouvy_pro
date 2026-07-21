import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/device_connection/data/parsers/heart_rate_parser.dart';

void main() {
  group('HeartRateParser', () {
    test('decodifica formato de 1 byte (el más común en pulsómetros)', () {
      final Uint8List packet = Uint8List.fromList(<int>[0x00, 0x48]); // flags=0, bpm=72
      expect(HeartRateParser.parseHeartRateMeasurement(packet), 72);
    });

    test('decodifica formato de 2 bytes cuando el flag lo indica', () {
      final Uint8List packet = Uint8List.fromList(<int>[0x01, 0x2C, 0x01]); // flags=1, bpm=300 (LE)
      expect(HeartRateParser.parseHeartRateMeasurement(packet), 300);
    });

    test('devuelve null con un paquete vacío', () {
      expect(HeartRateParser.parseHeartRateMeasurement(Uint8List(0)), isNull);
    });
  });
}
