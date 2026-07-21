import 'package:flutter_test/flutter_test.dart';
import 'package:rouvy_pro/features/wearables/domain/entities/wearable_provider_type.dart';

void main() {
  group('WearableProviderType.requiresPartnerApproval', () {
    test('Apple Health y Google Fit NO requieren aprobación de partner', () {
      expect(WearableProviderType.appleHealth.requiresPartnerApproval, isFalse);
      expect(WearableProviderType.googleFit.requiresPartnerApproval, isFalse);
    });

    test('Garmin, Polar, Coros y Suunto SÍ requieren aprobación de partner', () {
      expect(WearableProviderType.garmin.requiresPartnerApproval, isTrue);
      expect(WearableProviderType.polar.requiresPartnerApproval, isTrue);
      expect(WearableProviderType.coros.requiresPartnerApproval, isTrue);
      expect(WearableProviderType.suunto.requiresPartnerApproval, isTrue);
    });
  });
}
