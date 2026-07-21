import '../../domain/entities/wearable_provider_type.dart';
import 'mock_wearable_adapter.dart';

/// Adapter SIMULADO de Suunto. La integración real requiere:
///
/// 1. Evaluar entre la **Suunto App API** directa (documentación menos
///    madura y con acceso más restringido) o la integración indirecta vía
///    **Sports-Tracker** (plataforma que Suunto usa para parte de su
///    ecosistema) — la decisión final depende de qué acceso se consiga
///    primero, documentar la elegida en `WEARABLES_SETUP.md` cuando se
///    resuelva.
/// 2. De las 4 integraciones pendientes, esta es la de mayor incertidumbre
///    de alcance — no asumir que el resto de proveedores (OAuth2,
///    endpoints REST) aplica igual aquí sin confirmarlo primero con la
///    documentación que Suunto entregue al aprobar el acceso.
class SuuntoAdapter extends MockWearableAdapter {
  @override
  WearableProviderType get providerType => WearableProviderType.suunto;
}
