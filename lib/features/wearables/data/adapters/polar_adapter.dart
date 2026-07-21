import '../../domain/entities/wearable_provider_type.dart';
import 'mock_wearable_adapter.dart';

/// Adapter SIMULADO de Polar. La integración real requiere:
///
/// 1. Registrar la app en **Polar AccessLink API** (accesslink.polar.com)
///    — requiere aprobación pero suele ser más rápida que Garmin.
/// 2. Implementar OAuth2 estándar (a diferencia de Garmin) — el flujo es
///    directamente compatible con el patrón ya usado en
///    `AuthRemoteDataSource` para Google/Apple, solo cambia el
///    authorization/token endpoint.
/// 3. AccessLink SÍ soporta "pull" bajo demanda de actividades vía REST,
///    a diferencia de Garmin — no requiere backend propio para el caso de
///    uso básico de importar historial.
///
/// Ver `WEARABLES_SETUP.md` sección Polar para los endpoints exactos.
class PolarAdapter extends MockWearableAdapter {
  @override
  WearableProviderType get providerType => WearableProviderType.polar;
}
