/// Implementación usada en TODAS las plataformas que no son Web
/// (Android, iOS, desktop). Siempre `true`: en esas plataformas la
/// conectividad BLE nunca depende del navegador, así que la pregunta
/// "¿el navegador soporta Web Bluetooth?" no aplica y no debe bloquear
/// nada.
Future<bool> isWebBluetoothSupported() async => true;

/// `false` fuera de Web — usado por la UI para decidir si siquiera vale
/// la pena mostrar la comprobación (evita un parpadeo de loading en
/// móvil, donde la respuesta es instantánea y siempre `true`).
bool get isRunningOnWeb => false;
