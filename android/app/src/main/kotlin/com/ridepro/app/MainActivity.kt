package com.ridepro.app

import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
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
