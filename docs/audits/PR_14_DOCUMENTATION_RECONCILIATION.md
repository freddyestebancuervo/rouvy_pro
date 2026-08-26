# PR #14 — Reconciliación documental

## Identidad

```text
PR = #14
TITLE = fix(ios): raise deployment target to 14.0
STATE = MERGED
BASE_SHA = 90d07a9b24859234f1649b4b38f9fa223be3740f
HEAD_SHA = 37c1a45f5d0bfea715129afb1e3c7f13eb56254f
MERGE_SHA = 221d2b39b1176680b489c653d2b5853b2572ac3a
COMMITS = 1
CHANGED_FILES = 2
CI_GENERAL_RUN = 30601103345 / SUCCESS
IOS_BUILD_RUN = 30601103258 / SUCCESS
```

## Qué estableció realmente PR #14

PR #14 convirtió en cambio permanente el hallazgo diagnóstico de PR #13. Cambió exactamente:

- `.github/workflows/ios-build.yml`
- `ios/Runner.xcodeproj/project.pbxproj`

El cambio material fue doble:

1. elevó `IPHONEOS_DEPLOYMENT_TARGET` de 13.0 a 14.0 en las tres configuraciones relevantes del proyecto Xcode;
2. integró una versión estable del workflow macOS para compilar iOS sin firma mediante `flutter build ios --debug --no-codesign -v`.

El motivo documentado fue la dependencia resuelta `health` 13.3.1, cuyo podspec exige iOS 14.0. PR #13 había demostrado la hipótesis de forma efímera; PR #14 es el PR que realmente persistió la corrección en `main`.

## CI y evidencia nativa

El HEAD final `37c1a45...` conserva dos workflows completados con éxito:

```text
GENERAL_CI_RUN = 30601103345
Flutter — analyze + test = SUCCESS
Firestore — reglas de seguridad (A3/A5) = SUCCESS
Backend — migración + e2e (C2) = SUCCESS

IOS_BUILD_RUN = 30601103258
iOS — build (no code signing) = SUCCESS
```

En el job iOS terminaron en `SUCCESS` todos los pasos, incluidos:

- diagnóstico del entorno macOS/Xcode/CocoaPods;
- instalación de Flutter 3.32.0;
- `flutter pub get`;
- inspección del proyecto iOS;
- `flutter build ios --debug --no-codesign -v`;
- inspección de artefactos generados.

Por tanto PR #14 sí aporta evidencia de resolución nativa/CocoaPods y compilación Xcode de un build iOS sin firma en un runner macOS de GitHub.

## Alcance que PR #14 NO probó

El propio PR excluyó explícitamente:

- Apple code signing;
- certificados y provisioning profiles;
- distribución/App Store;
- runtime en simulador o dispositivo;
- comportamiento runtime de Firebase, Google Sign-In, HealthKit, APNs o Keychain.

Tampoco debe reinterpretarse el build sin firma como una prueba de login social funcional en dispositivo real.

```text
IOS_DEPLOYMENT_TARGET_14 = PROVEN
IOS_UNSIGNED_NATIVE_BUILD = PROVEN
IOS_COCOAPODS_RESOLUTION = PROVEN_BY_SUCCESSFUL_NATIVE_BUILD
IOS_XCODE_BUILD = PROVEN
IOS_SIGNING = NOT_PROVEN_BY_PR14
IOS_SIMULATOR_DEVICE_RUNTIME = NOT_PROVEN_BY_PR14
FIREBASE_RUNTIME = NOT_PROVEN_BY_PR14
GOOGLE_SIGN_IN_RUNTIME = NOT_PROVEN_BY_PR14
```

## Persistencia y evolución al corte PR #95

En el árbol exacto del corte autoritativo PR #95, `ios/Runner.xcodeproj/project.pbxproj` conserva `IPHONEOS_DEPLOYMENT_TARGET = 14.0`, por lo que la corrección de compatibilidad introducida por PR #14 permanece vigente al corte.

El workflow `.github/workflows/ios-build.yml` también persiste al corte PR #95, aunque evolucionó posteriormente a una matriz independiente Production/Development y a verificaciones adicionales sobre el `Runner.app` compilado.

Esas mejoras posteriores no se atribuyen a PR #14. De igual forma, Bundle IDs y separación Development/Production evolucionaron después del PR.

```text
PR14_IOS14_TARGET_PRESERVED_AT_PR95 = YES
PR14_IOS_BUILD_WORKFLOW_PRESERVED_AT_PR95 = YES
LATER_ENVIRONMENT_MATRIX_ATTRIBUTED_TO_PR14 = NO
LATER_BUNDLE_ID_EVOLUTION_ATTRIBUTED_TO_PR14 = NO
```

## Drift documental detectado

`PLATFORM_SETUP.md` todavía describía como trabajo pendiente, de forma conjunta, ejecutar `flutter build ios --no-codesign`, resolver CocoaPods y probar en simulador/dispositivo.

Esa formulación era correcta tras PR #12, pero quedó parcialmente superada por PR #14: el build sin firma y la ruta CocoaPods/Xcode ya quedaron probados en CI. Lo que continúa sin evidencia por PR #14 es signing/provisioning y runtime en simulador/dispositivo.

## Corrección aplicada

`PLATFORM_SETUP.md` quedó actualizado para distinguir:

- configuración estática Firebase/URL scheme probada desde PR #12;
- build iOS sin firma y resolución nativa/CocoaPods/Xcode probados desde PR #14;
- signing/provisioning y runtime en simulador/dispositivo todavía no probados por PR #14.

`SETUP_SOCIAL_LOGIN.md` no necesitó una corrección atribuible a #14 porque su afirmación estaba acotada correctamente a que **PR #12 por sí solo** no aportó la evidencia nativa.

No se modificó `PROJECT_STATUS.md` ni se ejecutaron mutaciones de Production.

## Resultado

```text
PR_14_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DOCUMENTATION_CLOSED = YES
FILES_FIXED = PLATFORM_SETUP.md, docs/audits/PR_14_DOCUMENTATION_RECONCILIATION.md
IOS_DEPLOYMENT_TARGET_14_VIA_PR14 = YES
IOS_UNSIGNED_NATIVE_BUILD_PROVEN_BY_PR14 = YES
IOS_COCOAPODS_XCODE_BUILD_PROVEN_BY_PR14 = YES
CI_GENERAL_PR14 = 3_OF_3_SUCCESS
IOS_BUILD_WORKFLOW_PR14 = SUCCESS
IOS_SIGNING_PROVEN_BY_PR14 = NO
IOS_RUNTIME_PROVEN_BY_PR14 = NO
PR14_CHANGE_PRESERVED_AT_PR95 = YES
LATER_ENVIRONMENT_EVOLUTION_ATTRIBUTED_TO_PR14 = NO
PROJECT_STATUS.md = UNTOUCHED
PRODUCTION_MUTATIONS = 0
PROGRESS_DOCUMENTATION_CLOSED = 14/95
NEXT = PR #15
```
