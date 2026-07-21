import 'dart:js_interop';

/// Getter externo vía JS interop a `navigator.bluetooth`. Si la propiedad
/// no existe en el objeto `navigator` del motor del navegador, devuelve
/// `null` en vez de lanzar — así el feature-detection de abajo puede
/// resolverse con una simple comprobación de nulidad.
@JS('navigator.bluetooth')
external JSAny? get _navigatorBluetooth;

/// Comprueba, vía JS interop, si `navigator.bluetooth` existe en el
/// objeto `window.navigator` del motor del navegador. Es "feature
/// detection" pura — no intenta escanear ni conectar nada, solo pregunta
/// si la API existe. Chrome y Edge (Chromium) la exponen; Safari y
/// Firefox no la implementan (decisión de esos fabricantes, ver
/// `ARCHITECTURE_DECISIONS.md` sección 4).
Future<bool> isWebBluetoothSupported() async {
  try {
    return _navigatorBluetooth != null;
  } catch (_) {
    // Cualquier error de interop (muy improbable, pero un navegador
    // exótico podría comportarse distinto) se trata como "no soportado"
    // — es la opción más segura: peor caso, se muestra la pantalla
    // informativa a un navegador que sí lo soportaba, nunca al revés.
    return false;
  }
}

bool get isRunningOnWeb => true;
