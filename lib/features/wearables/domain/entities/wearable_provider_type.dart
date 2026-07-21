/// Todos los proveedores de wearables que la app puede integrar. El campo
/// [requiresPartnerApproval] es la pieza clave de la decisión de
/// arquitectura: determina si `WearableRepositoryImpl` resuelve este tipo
/// hacia un adapter REAL o hacia un adapter MOCK (ver
/// `ARCHITECTURE_DECISIONS.md`, sección 1-2).
enum WearableProviderType {
  /// HealthKit — on-device, sin aprobación de partner, disponible desde
  /// el primer día. Solo iOS.
  appleHealth(requiresPartnerApproval: false),

  /// Health Connect — sucesor oficial de la API de Google Fit (que Google
  /// dejó de dar servicio en 2024). Sin aprobación de partner, disponible
  /// desde el primer día. Solo Android.
  googleFit(requiresPartnerApproval: false),

  /// Garmin Connect Developer Program — requiere solicitud y aprobación
  /// manual de Garmin (puede tardar semanas). Implementado como MOCK.
  garmin(requiresPartnerApproval: true),

  /// Polar AccessLink API — requiere registro de aplicación aprobado por
  /// Polar. Implementado como MOCK.
  polar(requiresPartnerApproval: true),

  /// Coros Open API — acceso por solicitud, cobertura de dispositivos más
  /// limitada. Implementado como MOCK.
  coros(requiresPartnerApproval: true),

  /// Suunto App API — documentación menos madura, evaluar caso por caso.
  /// Implementado como MOCK.
  suunto(requiresPartnerApproval: true);

  const WearableProviderType({required this.requiresPartnerApproval});

  final bool requiresPartnerApproval;
}
