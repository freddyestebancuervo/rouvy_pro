import '../../features/wearables/data/adapters/mock_wearable_adapter.dart';
import '../../features/wearables/domain/entities/wearable_provider_type.dart';

/// Adapters SOLO para modo demo — a diferencia de producción (donde
/// Apple Health/Google Fit son integraciones REALES vía
/// `HealthPackageAdapter`, ver `ARCHITECTURE_DECISIONS.md`), en demo se
/// simulan igual que Garmin/Polar/Coros/Suunto para no depender de
/// HealthKit/Health Connect nativos (que no funcionan en un simulador
/// sin configuración adicional, o en Web/CI en absoluto).
///
/// `requiresPartnerApproval` se fuerza a `false` — a diferencia de la
/// base `MockWearableAdapter` (pensada para Garmin/Polar/Coros/Suunto,
/// que sí requieren aprobación real) — para que la UI de la demo no
/// muestre el badge "pendiente de aprobación oficial" en un proveedor
/// que, en producción, no lo requiere.
class DemoAppleHealthAdapter extends MockWearableAdapter {
  @override
  WearableProviderType get providerType => WearableProviderType.appleHealth;

  @override
  bool get requiresPartnerApproval => false;
}

class DemoGoogleFitAdapter extends MockWearableAdapter {
  @override
  WearableProviderType get providerType => WearableProviderType.googleFit;

  @override
  bool get requiresPartnerApproval => false;
}
