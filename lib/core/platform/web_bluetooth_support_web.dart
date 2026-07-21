import 'dart:html' as html;
import 'dart:js_util' as js_util;

/// Comprueba, vía JS interop, si `navigator.bluetooth` existe en el
/// objeto `window.navigator` del motor del navegador. Es "feature
/// detection" pura — no intenta escanear ni conectar nada, solo pregunta
/// si la API existe. Chrome y Edge (Chromium) la exponen; Safari y
/// Firefox no la implementan (decisión de esos fabricantes, ver
/// `ARCHITECTURE_DECISIONS.md` sección 4).
Future<bool> isWebBluetoothSupported() async {
  try {
    final Object navigator = html.window.navigator;
    return js_util.hasProperty(navigator, 'bluetooth');
  } catch (_) {
    // Cualquier error de interop (muy improbable, pero un navegador
    // exótico podría comportarse distinto) se trata como "no soportado"
    // — es la opción más segura: peor caso, se muestra la pantalla
    // informativa a un navegador que sí lo soportaba, nunca al revés.
    return false;
  }
}

bool get isRunningOnWeb => true;
