/// Resultado de solicitar autorización a HealthKit/Health Connect. Cubre
/// los 5 casos que la UI debe distinguir con una acción de recuperación
/// distinta cada uno — ver `WEARABLES_SETUP.md` y `HEALTH_SETUP.md`.
enum HealthPermissionStatus {
  /// Autorización concedida — se puede leer datos de salud.
  granted,

  /// El usuario denegó el permiso esta vez, pero puede volver a
  /// pedírsele (mostrar de nuevo el botón "Conectar").
  denied,

  /// Solo aplica a **Health Connect (Android)**: el usuario ya denegó el
  /// permiso más de una vez en la misma sesión de la app — Android deja
  /// de mostrar el diálogo del sistema en este punto y la única salida es
  /// abrir los ajustes de Health Connect manualmente.
  ///
  /// ⚠️ **Nota honesta sobre HealthKit (iOS):** Apple, por diseño de
  /// privacidad, NUNCA revela a una app si el usuario concedió o denegó un
  /// permiso de LECTURA de HealthKit — `requestAuthorization` siempre
  /// "tiene éxito" en cuanto el usuario cierra el diálogo del sistema,
  /// sin importar qué interruptores dejó activados. Por lo tanto, este
  /// estado (`permanentlyDenied`) NUNCA lo devuelve el gateway en iOS; en
  /// su lugar, iOS solo puede terminar en [granted] (mejor esfuerzo,
  /// ver `HealthPlatformGatewayImpl`) o en un resultado vacío al leer
  /// datos, que la UI debe tratar como "puede que no haya datos, puede
  /// que no haya permiso" — no se puede distinguir, y no es un bug de
  /// esta implementación, es una limitación deliberada de la plataforma.
  permanentlyDenied,

  /// Health Connect no está instalado en este Android (ver
  /// [HealthAvailability.notInstalled]) — no tiene sentido ni pedir el
  /// permiso.
  notInstalled,

  /// La plataforma de salud no está disponible en este dispositivo en
  /// absoluto (ver [HealthAvailability.unavailable]).
  unavailable,
}
