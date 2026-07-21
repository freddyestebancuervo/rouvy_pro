import '../../domain/entities/wearable_provider_type.dart';
import 'mock_wearable_adapter.dart';

/// Adapter SIMULADO de Garmin. La integración real requiere:
///
/// 1. Solicitar acceso al **Garmin Connect Developer Program**
///    (health/fitness API) — Garmin aprueba caso por caso, ver
///    `WEARABLES_SETUP.md` sección Garmin.
/// 2. Implementar OAuth 1.0a (Garmin usa OAuth 1.0a, no 2.0 — una
///    particularidad frente al resto de proveedores de esta lista).
/// 3. Registrar un endpoint propio (backend) que reciba los webhooks de
///    actividad que Garmin empuja tras cada sincronización del reloj —
///    Garmin no expone un endpoint de "pull" tradicional para todo el
///    historial, funciona principalmente por push a un servidor.
///
/// Por el punto 3, esta integración en particular no puede ser 100%
/// cliente-only como Apple Health/Google Fit: cuando haya aprobación,
/// hará falta también el `wearable-sync-service` descrito en el
/// documento de arquitectura ampliada (Prompt 2) del lado del backend.
class GarminAdapter extends MockWearableAdapter {
  @override
  WearableProviderType get providerType => WearableProviderType.garmin;
}
