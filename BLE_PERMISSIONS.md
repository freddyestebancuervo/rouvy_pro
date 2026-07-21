# Permisos de Bluetooth — Android e iOS

El código Dart (`BlePermissionHandler`) solicita los permisos en tiempo de
ejecución, pero antes hay que **declararlos** en cada plataforma nativa. Sin
esta declaración, `permission_handler` no puede ni mostrar el diálogo del
sistema.

## Android — `android/app/src/main/AndroidManifest.xml`

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- Android 12+ (API 31+): permisos de tiempo de ejecución dedicados a BLE -->
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN"
        android:usesPermissionFlags="neverForLocation" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />

    <!-- Android ≤11 (API ≤30): escanear BLE requiere ubicación -->
    <uses-permission android:name="android.permission.BLUETOOTH"
        android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN"
        android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"
        android:maxSdkVersion="30" />

    <!-- Declara que la app SOLO usa BLE para conectar accesorios, no para
         rastrear la ubicación del usuario — permite omitir el permiso de
         ubicación en Android 12+ (ver `neverForLocation` arriba). Es
         importante para la ficha de Play Store: sin esto, Google Play
         puede exigir declarar uso de ubicación en el listado de la app. -->
    <uses-feature android:name="android.hardware.bluetooth_le" android:required="true" />

    <application ...>
        ...
    </application>
</manifest>
```

**Nota sobre `neverForLocation`:** solo se puede declarar si la app
realmente no usa el escaneo BLE para inferir ubicación (que es el caso
aquí — solo se usa para conectar sensores). Con este flag, Android 12+ NO
exige `ACCESS_FINE_LOCATION` en absoluto, así que `BlePermissionHandler`
solicitándolo igualmente (ver comentario en el propio archivo) es
inofensivo: el sistema simplemente no lo necesita en SDK 31+.

## iOS — `ios/Runner/Info.plist`

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>RidePro necesita acceso a Bluetooth para conectarse a tu rodillo, pulsómetro y sensores de cadencia/velocidad durante el entrenamiento.</string>

<key>NSBluetoothPeripheralUsageDescription</key>
<string>RidePro necesita acceso a Bluetooth para conectarse a tu rodillo, pulsómetro y sensores de cadencia/velocidad durante el entrenamiento.</string>
```

- `NSBluetoothAlwaysUsageDescription` es el texto que se muestra en el
  diálogo del sistema — es OBLIGATORIO desde iOS 13; sin esto, la app
  **crashea** al primer intento de usar el adaptador Bluetooth (no
  simplemente deniega el permiso).
- `NSBluetoothPeripheralUsageDescription` es el equivalente para iOS ≤12 —
  se incluye igualmente por compatibilidad retroactiva, sin costo.
- iOS no requiere permiso de ubicación para BLE (a diferencia de Android
  ≤11) — no añadir `NSLocationWhenInUseUsageDescription` a menos que otra
  parte de la app lo necesite por otro motivo.

## Verificación rápida

Tras declarar ambos, `BlePermissionHandler.hasBlePermissions()` debería
poder consultarse sin lanzar excepciones incluso ANTES de que el usuario
conceda nada — si lanza una excepción de plugin al arrancar, casi siempre
significa que falta alguna de las claves de arriba en la plataforma que se
está probando.
