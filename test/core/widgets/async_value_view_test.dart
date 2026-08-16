import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/error/failures.dart';
import 'package:rouvy_pro/core/widgets/async_value_view.dart';
import 'package:rouvy_pro/l10n/generated/app_localizations.dart';

/// Excepción deliberadamente NO modelada como [Failure] — simula un bug/
/// excepción no anticipada, para probar que `AsyncValueView` nunca
/// muestra su `runtimeType` ni su mensaje crudo al usuario.
class _UnexpectedTestException implements Exception {
  @override
  String toString() => 'UnexpectedTestException: detalle interno no apto para el usuario';
}

Widget _harness({required AsyncValue<String> value, VoidCallback? onRetry}) {
  return MaterialApp(
    locale: const Locale('es'),
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(
      body: AsyncValueView<String>(
        value: value,
        onRetry: onRetry,
        data: (BuildContext context, String data) => Text(data),
      ),
    ),
  );
}

void main() {
  testWidgets('ServerFailure(\'Error simulado\') muestra exactamente ese mensaje',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _harness(
        value: AsyncValue<String>.error(const ServerFailure('Error simulado'), StackTrace.current),
      ),
    );
    await tester.pump();

    expect(find.text('Error simulado'), findsOneWidget);
    expect(find.textContaining('ServerFailure'), findsNothing);
    expect(find.textContaining('Instance of'), findsNothing);
    expect(find.textContaining('minified'), findsNothing);
  });

  testWidgets('NetworkFailure muestra su mensaje amigable y el ícono de sin conexión',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      _harness(value: AsyncValue<String>.error(const NetworkFailure(), StackTrace.current)),
    );
    await tester.pump();

    expect(find.text('No hay conexión a internet.'), findsOneWidget);
    expect(find.byIcon(Icons.wifi_off), findsOneWidget);
    // Un error genérico usa el ícono distinto — confirma que sí diferencia.
    expect(find.byIcon(Icons.error_outline), findsNothing);
  });

  testWidgets(
      'una excepción desconocida (no Failure) muestra el mensaje genérico, '
      'nunca runtimeType, "Exception", stack trace ni "minified:"', (WidgetTester tester) async {
    await tester.pumpWidget(
      _harness(value: AsyncValue<String>.error(_UnexpectedTestException(), StackTrace.current)),
    );
    await tester.pump();

    expect(find.text('Ocurrió un error. Intenta de nuevo.'), findsOneWidget);
    expect(find.textContaining('UnexpectedTestException'), findsNothing);
    expect(find.textContaining('Exception'), findsNothing);
    expect(find.textContaining('minified'), findsNothing);
    expect(find.textContaining('#0'), findsNothing);
    // Un error desconocido usa el ícono genérico, no el de "sin conexión".
    expect(find.byIcon(Icons.error_outline), findsOneWidget);
    expect(find.byIcon(Icons.wifi_off), findsNothing);
  });

  testWidgets(
      'el botón Reintentar sigue funcionando tanto para Failure como para errores desconocidos',
      (WidgetTester tester) async {
    int failureRetries = 0;
    await tester.pumpWidget(
      _harness(
        value: AsyncValue<String>.error(const ServerFailure('x'), StackTrace.current),
        onRetry: () => failureRetries++,
      ),
    );
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Reintentar'));
    expect(failureRetries, 1);

    int unexpectedRetries = 0;
    await tester.pumpWidget(
      _harness(
        value: AsyncValue<String>.error(_UnexpectedTestException(), StackTrace.current),
        onRetry: () => unexpectedRetries++,
      ),
    );
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Reintentar'));
    expect(unexpectedRetries, 1);
  });
}
