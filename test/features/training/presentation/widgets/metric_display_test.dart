import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rouvy_pro/features/training/presentation/widgets/metric_display.dart';

/// KORIXA-VISUAL-UI-HARDENING-20260909: `valueStyle` es el parámetro
/// nuevo que deja que el HUD diferencie el peso visual entre métricas
/// primarias/secundarias (hallazgo de auditoría: los 4 medidores tenían
/// el mismo peso). Se prueba aislado, sin ningún provider/router — la
/// forma más barata de probar el comportamiento realmente nuevo.
void main() {
  Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

  testWidgets('usa el fontSize de valueStyle cuando se provee', (WidgetTester tester) async {
    await tester.pumpWidget(
      wrap(
        const MetricDisplay(
          label: 'Velocidad',
          value: '32.4',
          unit: 'km/h',
          valueStyle: TextStyle(fontSize: 40, fontWeight: FontWeight.w800),
        ),
      ),
    );

    final RichText richText = tester.widget<RichText>(find.byKey(const Key('metric-display-value')));
    final TextSpan root = richText.text as TextSpan;
    final TextSpan valueSpan = root.children!.first as TextSpan;

    expect(valueSpan.style?.fontSize, 40);
  });

  testWidgets('sin valueStyle, cae al tamaño anterior (displaySmall) sin romperse', (WidgetTester tester) async {
    await tester.pumpWidget(
      wrap(
        const MetricDisplay(label: 'Cadencia', value: '88', unit: 'rpm'),
      ),
    );

    expect(find.text('88'), findsNothing); // el número vive dentro de un RichText, no un Text plano
    expect(find.byType(RichText), findsWidgets);
    expect(find.text('Cadencia'), findsOneWidget);
  });

  testWidgets('valueStyle no pisa el color calculado (color prop sigue aplicando)', (WidgetTester tester) async {
    await tester.pumpWidget(
      wrap(
        const MetricDisplay(
          label: 'Frecuencia cardíaca',
          value: '150',
          unit: 'bpm',
          color: Colors.redAccent,
          valueStyle: TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
        ),
      ),
    );

    final RichText richText = tester.widget<RichText>(find.byKey(const Key('metric-display-value')));
    final TextSpan root = richText.text as TextSpan;
    final TextSpan valueSpan = root.children!.first as TextSpan;

    expect(valueSpan.style?.color, Colors.redAccent);
    expect(valueSpan.style?.fontSize, 28);
  });
}
