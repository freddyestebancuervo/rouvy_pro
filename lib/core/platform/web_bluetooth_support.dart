/// Comprueba si el navegador actual expone la Web Bluetooth API
/// (`navigator.bluetooth`) — solo Chrome y Edge (y derivados basados en
/// Chromium) la implementan; Safari y Firefox no, por decisión de esos
/// fabricantes, no por una limitación de esta app.
///
/// En plataformas que NO son Web (Android/iOS/desktop), siempre devuelve
/// `true` — ahí la conectividad BLE la resuelve `flutter_blue_plus` de
/// forma nativa, este chequeo es exclusivamente para el caso Web.
///
/// La implementación real vive en un archivo distinto por plataforma
/// (patrón de **imports condicionales** de Dart) para que el código que
/// toca `dart:html`/JS interop nunca se incluya en el build de
/// Android/iOS, ni viceversa:
/// - `web_bluetooth_support_web.dart` — implementación real para Web.
/// - `web_bluetooth_support_stub.dart` — siempre `true`, para el resto.
library;

export 'web_bluetooth_support_stub.dart'
    if (dart.library.html) 'web_bluetooth_support_web.dart';
