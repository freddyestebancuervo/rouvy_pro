import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

const List<String> _requiredScreens = <String>[
  '`SCREEN_01` | `WELCOME`',
  '`SCREEN_02` | `LOGIN`',
  '`SCREEN_03` | `REGISTER`',
  '`SCREEN_04` | `HOME`',
  '`SCREEN_05` | `RIDE_HUD`',
  '`SCREEN_06` | `ROUTE_CATALOG`',
  '`SCREEN_07` | `ROUTE_DETAIL`',
  '`SCREEN_08` | `DEVICES`',
  '`SCREEN_09` | `SESSION_SUMMARY`',
  '`SCREEN_10` | `STATISTICS`',
];

void main() {
  group('docs/design/KORIXA_SCREEN_SPECS.md — registro de las 10 pantallas oficiales (Sección 17)', () {
    late String content;

    setUpAll(() {
      content = File('docs/design/KORIXA_SCREEN_SPECS.md').readAsStringSync();
    });

    for (final String entry in _requiredScreens) {
      test('registra $entry', () {
        expect(content, contains(entry));
      });
    }

    test('no redefine ni omite ningún screen fuera de los 10 esperados', () {
      final RegExp screenIdPattern = RegExp(r'SCREEN_\d\d');
      final Set<String> foundIds = screenIdPattern.allMatches(content).map((RegExpMatch m) => m.group(0)!).toSet();
      final Set<String> expectedIds = List<String>.generate(10, (int i) => 'SCREEN_${(i + 1).toString().padLeft(2, '0')}').toSet();
      expect(foundIds, expectedIds);
    });
  });

  group('docs/design/KORIXA_DESIGN_SYSTEM.md — veracidad funcional y caveats obligatorios', () {
    late String content;

    setUpAll(() {
      content = File('docs/design/KORIXA_DESIGN_SYSTEM.md').readAsStringSync();
    });

    test('declara ZONE_CLASSIFICATION_ENABLED = NO (Sección 12)', () {
      expect(content, contains('ZONE_CLASSIFICATION_ENABLED = NO'));
    });

    test('documenta que el sistema todavía no está conectado a MaterialApp', () {
      expect(content.toLowerCase(), contains('not wired into materialapp'));
    });
  });

  group('docs/design/KORIXA_VISUAL_DIRECTION.md — dirección visual aprobada', () {
    late String content;

    setUpAll(() {
      content = File('docs/design/KORIXA_VISUAL_DIRECTION.md').readAsStringSync();
    });

    test('declara VISUAL_DIRECTION = KORIXA_DARK_TECH', () {
      expect(content, contains('VISUAL_DIRECTION = KORIXA_DARK_TECH'));
    });

    test('declara KORIXA_RIDER_BRANDING = APPROVED', () {
      expect(content, contains('KORIXA_RIDER_BRANDING = APPROVED'));
    });
  });
}
