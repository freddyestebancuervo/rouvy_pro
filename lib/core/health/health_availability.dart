/// Si la plataforma de salud del sistema operativo existe siquiera en este
/// dispositivo — pregunta previa e independiente de "¿el usuario dio
/// permiso?". Un iPhone sin la app Salud configurada, o un Android sin
/// Health Connect instalado, están en uno de los estados "no disponible"
/// aquí ANTES de que tenga sentido pedir ningún permiso.
enum HealthAvailability {
  /// HealthKit (iOS) o Health Connect (Android) están listos para usarse.
  available,

  /// Solo se da en Android: el dispositivo tiene un SDK de Android que
  /// soporta Health Connect, pero la app Health Connect no está instalada
  /// (versiones de Android anteriores a la 14 no la traen preinstalada).
  /// HealthKit en iOS no tiene un estado equivalente — siempre está
  /// presente en el sistema operativo desde iOS 8, solo puede faltar el
  /// dato en sí (ver [unavailable]).
  notInstalled,

  /// La plataforma de salud no está disponible en este dispositivo/SO en
  /// absoluto — p. ej. Health Connect requiere Android 9 (API 28) como
  /// mínimo, o (mucho más raro) un caso de HealthKit deshabilitado por
  /// política de dispositivo (MDM corporativo).
  unavailable,
}
