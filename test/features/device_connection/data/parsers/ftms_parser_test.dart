import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/device_connection/data/parsers/ftms_parser.dart';

void main() {
  group('FtmsParser.parseIndoorBikeData', () {
    test('decodifica velocidad, cadencia, potencia y frecuencia cardíaca', () {
      // Flags: bit0=0 (velocidad presente), bit2=1 (cadencia), bit6=1
      // (potencia), bit9=1 (FC) → 4 + 64 + 512 = 580 = 0x0244.
      final Uint8List packet = Uint8List.fromList(<int>[
        0x44, 0x02, // flags = 580 (LE)
        0xB8, 0x0B, // velocidad: 3000 * 0.01 = 30.0 km/h
        0xB4, 0x00, // cadencia: 180 * 0.5 = 90 rpm
        0xFA, 0x00, // potencia: 250 W
        0x96, // FC: 150 bpm
      ]);

      final FtmsIndoorBikeData result = FtmsParser.parseIndoorBikeData(packet);

      expect(result.speedKmh, 30.0);
      expect(result.cadenceRpm, 90);
      expect(result.powerWatts, 250);
      expect(result.heartRateBpm, 150);
    });

    test('deja los campos ausentes como null según los flags', () {
      // Flags: bit0=1 (velocidad AUSENTE), bit6=1 (potencia presente) → 64.
      final Uint8List packet = Uint8List.fromList(<int>[
        0x41, 0x00, // flags: bit0=1, bit6=1 → 1 + 64 = 65 = 0x41
        0x32, 0x00, // potencia: 50 W
      ]);

      final FtmsIndoorBikeData result = FtmsParser.parseIndoorBikeData(packet);

      expect(result.speedKmh, isNull);
      expect(result.cadenceRpm, isNull);
      expect(result.powerWatts, 50);
      expect(result.heartRateBpm, isNull);
    });

    test('no lanza excepción con un paquete corrupto/demasiado corto', () {
      final Uint8List packet = Uint8List.fromList(<int>[0x01]);
      expect(() => FtmsParser.parseIndoorBikeData(packet), returnsNormally);
    });
  });
}
