import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/device_connection/data/parsers/cycling_power_parser.dart';

void main() {
  group('CyclingPowerParser', () {
    test('la potencia se lee de inmediato; la cadencia requiere una segunda lectura para derivarse', () {
      final CyclingPowerParser parser = CyclingPowerParser();

      // Flags: bit5=1 (Crank Revolution Data) → 32 = 0x0020.
      final Uint8List first = Uint8List.fromList(<int>[
        0x20, 0x00, // flags
        0xC8, 0x00, // potencia: 200 W
        0x64, 0x00, // crank revolutions: 100
        0x00, 0x00, // crank event time: 0
      ]);
      final CyclingPowerReading? firstReading = parser.parse(first);

      expect(firstReading?.powerWatts, 200);
      expect(firstReading?.cadenceRpm, isNull); // aún no hay intervalo que medir

      // Segunda lectura: 3 revoluciones más, 2 segundos después (2048 en
      // unidades de 1/1024s) → (3 / 2s) * 60 = 90 rpm exactos.
      final Uint8List second = Uint8List.fromList(<int>[
        0x20, 0x00,
        0xC8, 0x00, // potencia: 200 W (sin cambios)
        0x67, 0x00, // crank revolutions: 103
        0x00, 0x08, // crank event time: 2048
      ]);
      final CyclingPowerReading? secondReading = parser.parse(second);

      expect(secondReading?.powerWatts, 200);
      expect(secondReading?.cadenceRpm, 90);
    });

    test('devuelve cadencia 0 cuando no hubo nuevas revoluciones (pedaleo detenido)', () {
      final CyclingPowerParser parser = CyclingPowerParser();

      final Uint8List first = Uint8List.fromList(<int>[0x20, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x00, 0x00]);
      parser.parse(first);

      final Uint8List second = Uint8List.fromList(<int>[0x20, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x00, 0x04]);
      final CyclingPowerReading? reading = parser.parse(second);

      expect(reading?.cadenceRpm, 0);
    });
  });
}
