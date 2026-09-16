package com.ridepro.app

import android.os.Build
import android.os.Bundle
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * KORIXA-AUTH-REAL-DEVICE-LANDSCAPE-FULLSCREEN-FIT-20260916: experiencia
 * fullscreen/immersive de Korixa vía la API moderna de AndroidX
 * (`WindowCompat` + `WindowInsetsControllerCompat`) — deliberadamente
 * NO el mecanismo legacy de Flutter
 * (`SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky)`).
 * Flutter documenta restricciones conocidas de ese mecanismo a partir de
 * targetSdk 35 (Android ya fuerza edge-to-edge y puede ignorar las
 * banderas legacy `SYSTEM_UI_FLAG_*` que ese modo usa internamente) —
 * este proyecto ya compila con `targetSdk 36` (Android 16), así que el
 * camino legacy quedó descartado sin probarlo primero.
 *
 * Tampoco se usa `android:windowOptOutEdgeToEdgeEnforcement="true"` en
 * el manifest — es un workaround temporal documentado solo para Android
 * 15 y no sobrevive a Android 16+; la solución de abajo es compatible
 * con edge-to-edge de forma nativa (`setDecorFitsSystemWindows(false)`
 * es, literalmente, adoptar edge-to-edge — no evitarlo).
 *
 * Real bug corregido (reportado por el owner probando el APK
 * development en un dispositivo Android real): sin esta configuración,
 * la barra de estado (hora/notificaciones) y la barra de navegación de
 * 3 botones quedaban permanentemente visibles en phone landscape,
 * reduciendo el viewport útil real por debajo de lo que cualquier
 * cálculo en Dart (`MediaQuery`/`SafeArea`) podía anticipar — de ahí que
 * el título/CTA de SCREEN_02 aparecieran cortados pese a que ningún test
 * de widget (que nunca simula system bars reales) lo detectó.
 */
class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableImmersiveMode()
    }

    // KORIXA-AUTH-REAL-DEVICE-LANDSCAPE-FULLSCREEN-FIT-20260916: las
    // barras del sistema pueden reaparecer cuando la ventana recupera el
    // foco (p. ej. al cerrar el teclado, volver de un diálogo del
    // sistema, o el propio gesto de "revelar temporalmente" que
    // `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` permite a propósito) — re-
    // ocultarlas acá es el patrón oficial recomendado por Android para
    // que el modo immersive se sienta "sticky" sin usar las banderas
    // legacy. `android:configChanges` en el manifest ya evita que
    // `onCreate` se vuelva a ejecutar al abrir/cerrar el teclado o rotar,
    // así que este es el único punto de re-aplicación necesario.
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            enableImmersiveMode()
        }
    }

    private fun enableImmersiveMode() {
        // Requisito de la API moderna para poder controlar la
        // visibilidad de las barras del sistema bajo edge-to-edge
        // forzado — sin esto, `hide()` no tiene efecto real en Android
        // 15+.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val insetsController = WindowInsetsControllerCompat(window, window.decorView)
        insetsController.hide(WindowInsetsCompat.Type.systemBars())
        // El usuario puede revelar las barras deslizando desde el borde
        // correspondiente; vuelven a ocultarse solas — comportamiento
        // "immersive" estándar recomendado por Android para apps de
        // contenido inmersivo (deportivas/ciclismo), en vez de
        // `BEHAVIOR_DEFAULT` (las barras quedarían visibles tras
        // revelarlas hasta que el usuario las oculte a mano).
        insetsController.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "korixa.app/android_sdk",
        ).setMethodCallHandler { call, result ->
            if (call.method == "getSdkInt") {
                result.success(Build.VERSION.SDK_INT)
            } else {
                result.notImplemented()
            }
        }
    }
}
