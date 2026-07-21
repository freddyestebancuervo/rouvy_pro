import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/device_connection/data/parsers/csc_parser.dart';

void main() {
  group('CscParser', () {
    test('deriva velocidad y cadencia a partir de dos lecturas de contadores acumulados', () {
      final CscParser parser = CscParser(); // circunferencia por defecto: 2105mm

      // Flags: bit0=1 (rueda) + bit1=1 (biela) = 3.
      final Uint8List first = Uint8List.fromList(<int>[
        0x03, // flags
        0xE8, 0x03, 0x00, 0x00, // wheel revolutions: 1000 (uint32 LE)
        0x00, 0x00, // wheel event time: 0
        0x32, 0x00, // crank revolutions: 50
        0x00, 0x00, // crank event time: 0
      ]);
      final CscReading firstReading = parser.parse(first);

      expect(firstReading.speedKmh, isNull);
      expect(firstReading.cadenceRpm, isNull);

      // 2 segundos después: +8 revoluciones de rueda, +3 de biela.
      final Uint8List second = Uint8List.fromList(<int>[
        0x03,
        0xF0, 0x03, 0x00, 0x00, // wheel revolutions: 1008
        0x00, 0x08, // wheel event time: 2048 (2s)
        0x35, 0x00, // crank revolutions: 53
        0x00, 0x08, // crank event time: 2048
      ]);
      final CscReading secondReading = parser.parse(second);

      // velocidad = 8 rev * 2.105 m / 2 s * 3.6 ≈ 30.31 km/h
      expect(secondReading.speedKmh, closeTo(30.31, 0.05));
      // cadencia = (3 rev / 2 s) * 60 = 90 rpm
      expect(secondReading.cadenceRpm, 90);
    });

    test('respeta una circunferencia de rueda personalizada', () {
      final CscParser parser = CscParser(wheelCircumferenceMm: 1500);

      final Uint8List first = Uint8List.fromList(<int>[0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      parser.parse(first);

      // +10 revoluciones en 1 segundo (1024 unidades).
      final Uint8List second = Uint8List.fromList(<int>[0x01, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x04]);
      final CscReading reading = parser.parse(second);

      // velocidad = 10 * 1.5m / 1s * 3.6 = 54.0 km/h
      expect(reading.speedKmh, closeTo(54.0, 0.01));
    });
  });
}
