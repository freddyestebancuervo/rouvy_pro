plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
    // Aplica el plugin registrado en settings.gradle.kts — es lo que
    // procesa android/app/google-services.json.
    id("com.google.gms.google-services")
    id("com.google.firebase.crashlytics")
}

android {
    namespace = "com.ridepro.app" // TODO: reemplazar por tu namespace real
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // ⚠️ PLACEHOLDER — reemplazar por tu Application ID real, idéntico
        // al "Package name" configurado en Firebase Console. Debe coincidir
        // EXACTAMENTE, o google-services.json no encontrará la
        // configuración correcta en tiempo de ejecución (ver
        // SETUP_SOCIAL_LOGIN.md, sección 2). Sin cambios en este bloque
        // (T-F0.2 Bloque 5A) — Production no se toca; ver flavor
        // "production" abajo, que hereda este mismo valor sin alterarlo.
        applicationId = "com.ridepro.app.YOUR_APPLICATION_ID"

        // flutter_blue_plus (BLE) requiere minSdk 21 como mínimo; se fija
        // en 26 aquí porque algunas APIs de Bluetooth usadas en el módulo
        // device_connection (p. ej. ciertos callbacks de conexión) son más
        // estables a partir de Android 8.0.
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // T-F0.2 Bloque 5A — flavor por entorno. "production" hereda el
    // applicationId de defaultConfig sin modificarlo (Production no se
    // toca en este bloque); "development" usa un applicationId absoluto
    // propio, no un applicationIdSuffix, porque defaultConfig.applicationId
    // todavía es un placeholder sin resolver (ver
    // docs/audits/AUDITORIA_FINAL/24_ANDROID_DEVELOPMENT_FOUNDATION.md) —
    // un sufijo heredaría ese placeholder roto.
    // Ejecutar SIEMPRE junto con el entry point Dart correspondiente:
    // `flutter build apk --flavor development -t lib/main_development.dart`
    // (nunca development + main.dart, ni production + main_development.dart).
    flavorDimensions += "environment"
    productFlavors {
        create("production") {
            dimension = "environment"
        }
        create("development") {
            dimension = "environment"
            applicationId = "com.ridepro.app.dev"
        }
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
