import '../../domain/entities/wearable_provider_type.dart';
import 'mock_wearable_adapter.dart';

/// Adapter SIMULADO de Coros. La integración real requiere:
///
/// 1. Solicitar acceso a la **Coros Open API** — programa más reciente
///    que Garmin/Polar, con cobertura de dispositivos más limitada
///    (algunos modelos antiguos de Coros no están cubiertos).
/// 2. OAuth2 estándar, similar a Polar.
/// 3. La documentación pública de Coros es más limitada que la de
///    Garmin/Polar — validar el formato exacto de la respuesta de
///    actividades con el equipo de soporte de Coros al recibir acceso,
///    antes de dar por buena la traducción a `ExternalActivity` en la
///    futura implementación real.
///
/// Ver `WEARABLES_SETUP.md` sección Coros.
class CorosAdapter extends MockWearableAdapter {
  @override
  WearableProviderType get providerType => WearableProviderType.coros;
}
