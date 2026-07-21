import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/core/utils/duration_formatter.dart';

void main() {
  group('DurationFormatter.format', () {
    test('formatea segundos y minutos como mm:ss', () {
      expect(DurationFormatter.format(const Duration(seconds: 5)), '00:05');
      expect(DurationFormatter.format(const Duration(minutes: 4, seconds: 32)), '04:32');
      expect(DurationFormatter.format(const Duration(minutes: 59, seconds: 59)), '59:59');
    });

    test('formatea como hh:mm:ss al superar una hora', () {
      expect(DurationFormatter.format(const Duration(hours: 1)), '01:00:00');
      expect(DurationFormatter.format(const Duration(hours: 2, minutes: 5, seconds: 9)), '02:05:09');
    });

    test('cero se formatea como 00:00', () {
      expect(DurationFormatter.format(Duration.zero), '00:00');
    });
  });
}
