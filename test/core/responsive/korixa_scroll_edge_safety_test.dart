import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/responsive/korixa_scroll_edge_safety.dart';

/// KORIXA-GLOBAL-SCROLL-EDGE-SAFETY-20260916.
void main() {
  test('minEdgeGap = 8 (AppSpacing.sm) — el piso oficial de Korixa', () {
    expect(KorixaScrollEdgeSafety.minEdgeGap, 8.0);
  });

  group('ensureMinEdgeGap', () {
    test('sube top/bottom al piso cuando están por debajo (el bug real de SCREEN_02)', () {
      const EdgeInsets input = EdgeInsets.fromLTRB(24, 0, 24, 4);
      final EdgeInsets result = KorixaScrollEdgeSafety.ensureMinEdgeGap(input);
      expect(result.top, 8.0, reason: 'top estaba en 0, debe subir al piso');
      expect(result.bottom, 8.0, reason: 'bottom estaba en 4, debe subir al piso');
      expect(result.left, 24.0, reason: 'left no debe tocarse');
      expect(result.right, 24.0, reason: 'right no debe tocarse');
    });

    test('preserva valores ya iguales o mayores al piso — nunca los reduce', () {
      const EdgeInsets input = EdgeInsets.fromLTRB(12, 8, 12, 40);
      final EdgeInsets result = KorixaScrollEdgeSafety.ensureMinEdgeGap(input);
      expect(result.top, 8.0, reason: 'ya estaba exactamente en el piso, sin cambios');
      expect(result.bottom, 40.0, reason: 'ya estaba muy por encima del piso, no debe bajar');
    });

    test('EdgeInsets.zero sube ambos extremos verticales al piso', () {
      final EdgeInsets result = KorixaScrollEdgeSafety.ensureMinEdgeGap(EdgeInsets.zero);
      expect(result.top, 8.0);
      expect(result.bottom, 8.0);
      expect(result.left, 0.0);
      expect(result.right, 0.0);
    });

    test('es un no-op cuando ya se cumple el piso en ambos extremos', () {
      const EdgeInsets input = EdgeInsets.symmetric(horizontal: 12, vertical: 8);
      final EdgeInsets result = KorixaScrollEdgeSafety.ensureMinEdgeGap(input);
      expect(result, input);
    });
  });
}
