# Guía de configuración — HealthKit (iOS) y Health Connect (Android)

Esta guía cubre la integración **real** (sin aprobación de partner) con
Apple Health y Google Fit, implementada en `core/health/` y consumida por
`features/wearables/data/adapters/health_package_adapter.dart`. Ver
también `ARCHITECTURE_DECISIONS.md` (por qué es una integración real) y
`WEARABLES_SETUP.md` (cómo encaja con Garmin/Polar/Coros/Suunto).

---

## 1. Arquitectura de la capa de abstracción

```
features/wearables/data/adapters/health_package_adapter.dart   ← Adapter de negocio
                    │  usa
                    ▼
core/health/health_platform_gateway.dart (interfaz)             ← Capa de abstracción de plataforma
                    │  implementa
                    ▼
core/health/health_platform_gateway_impl.dart                   ← Única clase que importa package:health
                    │  usa
                    ▼
package:health  →  HealthKit (iOS) / Health Connect (Android)
```

**Por qué dos capas y no una:** `HealthPackageAdapter` responde "¿puedo
importar actividades de Apple Health?" (pregunta de negocio);
`HealthPlatformGateway` responde "¿qué puede hacer el sistema operativo en
materia de salud en este dispositivo, ahora mismo?" (pregunta de
capacidad de plataforma). Separarlas es lo que permite testear el adapter
con un `FakeHealthPlatformGateway` (ver
`test/features/wearables/data/adapters/health_package_adapter_test.dart`)
sin un dispositivo real, y sustituir el plugin `health` por otra cosa en
el futuro tocando un único archivo.

---

## 2. Configuración de iOS — HealthKit

### 2.1 Claves de `Info.plist` (ya incluidas en el proyecto)

```xml
<key>NSHealthShareUsageDescription</key>
<string>RidePro necesita leer tus datos de salud (entrenamientos, frecuencia cardíaca) para importar tus actividades desde Apple Health.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>RidePro necesita escribir tus entrenamientos en Apple Health para mantener tu historial de actividad actualizado.</string>
```

- `NSHealthShareUsageDescription`: obligatoria para LEER datos (lo que usa
  hoy `HealthPackageAdapter.fetchActivities()`).
- `NSHealthUpdateUsageDescription`: obligatoria si en el futuro se escribe
  de vuelta a Salud (p. ej. exportar sesiones grabadas en la app). Hoy el
  adapter no escribe nada, pero se declara desde ya para no tener que
  volver a subir una nueva versión solo por esto cuando se implemente.

Ambas deben tener un texto **específico y honesto** sobre qué datos se
usan y para qué — Apple rechaza descripciones genéricas tipo "esta app
necesita tu permiso" en la revisión de App Store.

### 2.2 Capability de Xcode (no se puede hacer por archivo de texto)

1. Abrir `ios/Runner.xcworkspace` en Xcode.
2. Seleccionar el target **Runner** → pestaña **Signing & Capabilities**.
3. **+ Capability** → buscar **HealthKit** → añadir.
4. Verificar que se generó/actualizó `ios/Runner/Runner.entitlements` con:
   ```xml
   <key>com.apple.developer.healthkit</key>
   <true/>
   ```

### 2.3 Limitación conocida y documentada: HealthKit no revela permisos de lectura

Por diseño de privacidad, **iOS nunca informa a una app si el usuario
concedió o denegó un permiso de lectura de HealthKit** — `requestAuthorization`
siempre "tiene éxito" en cuanto el usuario cierra el diálogo del sistema,
sin importar qué interruptores dejó activados individualmente.

**Consecuencia práctica en este proyecto:**
- `HealthPlatformGatewayImpl.requestPermissions()` en iOS solo puede
  devolver `granted` (mejor esfuerzo) o `denied`/`unavailable` ante un
  fallo de la llamada misma — nunca `permanentlyDenied` (ver el docblock
  de `HealthPermissionStatus.permanentlyDenied` para la explicación
  completa).
- `fetchActivities()` maneja la ausencia real de permiso devolviendo una
  lista vacía, NO un error — porque no hay forma de distinguir "no hay
  entrenamientos en este rango" de "no tengo permiso para verlos".
- Si necesitas verificar manualmente si el permiso está concedido durante
  desarrollo: Ajustes del iPhone → Salud → Acceso a apps → RidePro.

### 2.4 Simulador de iOS

HealthKit funciona en el Simulador desde Xcode 9, pero normalmente **sin
datos de salud reales** — para probar `fetchActivities()` con datos, hay
que insertarlos manualmente desde la app Salud del propio simulador (Salud
→ Resumen → añadir datos de muestra) o probar en un dispositivo físico.

---

## 3. Configuración de Android — Health Connect

### 3.1 Permisos en `AndroidManifest.xml` (ya incluidos en el proyecto)

```xml
<uses-permission android:name="android.permission.health.READ_EXERCISE" />
<uses-permission android:name="android.permission.health.READ_HEART_RATE" />
<uses-permission android:name="android.permission.health.READ_ACTIVE_CALORIES_BURNED" />
<uses-permission android:name="android.permission.health.READ_DISTANCE" />
```

Cada permiso corresponde 1:1 a un `HealthDataType` de los que pide
`HealthPlatformGatewayImpl._dataTypes` — si en el futuro se añade un tipo
de dato nuevo al gateway (p. ej. `SPEED` o `POWER`), hay que añadir aquí
el permiso `android.permission.health.READ_SPEED`/`READ_POWER`
correspondiente, o Health Connect rechazará la solicitud de permisos para
ese tipo específicamente (los demás se conceden igual).

### 3.2 Query de detección de instalación (ya incluida)

```xml
<queries>
    <package android:name="com.google.android.apps.healthdata" />
</queries>
```

Sin esto, Android 11+ oculta el paquete de Health Connect a la app aunque
esté instalado (por las restricciones de visibilidad de paquetes) y
`getHealthConnectSdkStatus()` reportaría incorrectamente que no está
disponible.

### 3.3 Rationale de privacidad (Android 14+, ya incluido)

```xml
<activity-alias
    android:name="ViewPermissionUsageActivity"
    android:exported="true"
    android:targetActivity=".MainActivity"
    android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
    <intent-filter>
        <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
        <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
    </intent-filter>
</activity-alias>
```

A partir de Android 14, Health Connect exige que la app tenga una forma de
mostrar su política de privacidad DESDE la propia pantalla de permisos de
Health Connect. Por ahora apunta a `MainActivity`; antes de publicar,
considerar redirigir a una pantalla/URL de política de privacidad real en
vez de la actividad principal.

### 3.4 Health Connect no instalado

En dispositivos con Android <14 (donde Health Connect no viene
preinstalado), o si el usuario lo desinstaló, `checkAvailability()` en el
gateway devuelve `HealthAvailability.notInstalled`. La UI
(`WearableProviderTile`) muestra el mensaje correspondiente; se recomienda
en el futuro añadir un botón directo a la ficha de Play Store de Health
Connect (`market://details?id=com.google.android.apps.healthdata`) en vez
de solo el mensaje de texto actual — pendiente como mejora incremental,
no bloqueante.

### 3.5 minSdkVersion

Health Connect requiere **API 26 (Android 8.0)** como mínimo para la
librería cliente — `android/app/build.gradle` ya tiene `minSdkVersion 26`
(coincide, además, con el mínimo ya fijado por el módulo BLE).

---

## 4. Cómo probar cada uno de los 5 estados manualmente

| Estado | Cómo forzarlo para probar |
|---|---|
| **Concedido** | Conceder el permiso normalmente en el diálogo del sistema |
| **Denegado** | Denegar en el diálogo la primera vez — la app debe seguir mostrando el botón "Conectar" |
| **Denegado permanentemente** (solo Android) | Denegar 2 veces seguidas en el mismo Android — el sistema deja de mostrar el diálogo; verificar que aparece el botón "Abrir ajustes" |
| **No instalado** (solo Android) | Desinstalar la app Health Connect, o probar en un emulador que no la tenga preinstalada |
| **No disponible** | Difícil de forzar en iOS real (HealthKit casi siempre está presente); se puede simular temporalmente lanzando una excepción en `HealthPlatformGatewayImpl.checkAvailability()` durante pruebas manuales |

En todos los casos, verificar que **el resto de la app sigue funcionando
con normalidad** — navegar a Home, Perfil, y a otro proveedor de wearables
(p. ej. Garmin simulado) no debe verse afectado por ningún estado de
Apple Health/Google Fit (ver `ARCHITECTURE_DECISIONS.md`, principio de
degradación local aplicado también aquí).

---

## 5. Mantenimiento del plugin

El paquete `health` (pub.dev) ha cambiado nombres de métodos/enums entre
versiones mayores en el pasado. Antes de actualizar la versión fijada en
`pubspec.yaml`, verificar que siguen existiendo con esta forma:
- `Health().configure()`
- `Health().requestAuthorization(types, permissions: accessTypes)`
- `Health().hasPermissions(types, permissions: accessTypes)`
- `Health().getHealthConnectSdkStatus()` y el enum `HealthConnectSdkStatus`
- `Health().getHealthDataFromTypes(types:, startTime:, endTime:)`
- `HealthDataType`, `HealthDataAccess`, `HealthDataPoint`, `WorkoutHealthValue`

Si algún nombre cambió, el único archivo que hay que tocar es
`core/health/health_platform_gateway_impl.dart` — ni el adapter, ni el
repositorio, ni la UI de wearables deberían necesitar ningún cambio.

---

## 6. Pruebas automatizadas incluidas

- `test/features/wearables/data/adapters/health_package_adapter_test.dart`
  — cubre los 5 estados end-to-end usando `FakeHealthPlatformGateway`
  (doble de prueba controlable, sin tocar HealthKit/Health Connect real),
  más la traducción correcta de `HealthWorkout` → `ExternalActivity`.
- `test/features/wearables/data/repositories/wearable_repository_impl_test.dart`
  — verifica que un `HealthException` con cada `status` se traduce al
  `WearableConnectionStatus`/mensaje correcto, y que un nuevo suscriptor
  al stream de conexiones recibe el estado actual de inmediato (no solo
  cambios futuros).

Correr solo estos tests:
```bash
flutter test test/features/wearables/
```
