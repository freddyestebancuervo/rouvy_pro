# PR #12 — Reconciliación documental

## Identidad

```text
PR = #12
TITLE = feat(firebase): configure iOS client
STATE = MERGED
BASE_SHA = 16e81cc1dd2c50449de50266c721710b3694b6bf
HEAD_SHA = ce2efe522bca278f7c1c5830fea8ffc850bf3b13
MERGE_SHA = 90d07a9b24859234f1649b4b38f9fa223be3740f
COMMITS = 1
CHANGED_FILES = 4
CI_RUN = 30597527229
CI = 3/3 SUCCESS
```

## Qué estableció realmente PR #12

PR #12 sustituyó el estado placeholder de Firebase iOS por configuración de cliente real para la app iOS existente en ese momento.

Cambió exactamente:

- `firebase.json`
- `ios/Runner/GoogleService-Info.plist`
- `ios/Runner/Info.plist`
- `lib/firebase_options.dart`

El diff hizo cuatro cosas materiales:

1. registró la app iOS en la configuración Flutter/Firebase del repositorio;
2. reemplazó `GoogleService-Info.plist` placeholder por configuración real de cliente;
3. sustituyó el placeholder del URL scheme de Google por un `REVERSED_CLIENT_ID` real;
4. cambió `DefaultFirebaseOptions.currentPlatform` para devolver opciones iOS reales en vez de lanzar `UnsupportedError`.

En el HEAD exacto de PR #12 la configuración seguía usando el Bundle ID histórico `com.ridepro.app`. Ese valor no se presenta como estado vigente permanente: Bundle IDs y separación de entornos evolucionaron en PR posteriores.

## Alcance que PR #12 NO probó

El propio body del PR dejó fuera de alcance signing, entitlements, CocoaPods artifacts, separación de entornos y cambios nativos adicionales. También dejó explícitamente pendiente la validación macOS.

```text
IOS_STATIC_FIREBASE_CONFIG = PROVEN
IOS_FIREBASE_OPTIONS = PROVEN
IOS_GOOGLE_URL_SCHEME = PROVEN
IOS_NATIVE_BUILD = NOT_PROVEN_BY_PR12
COCOAPODS_RESOLUTION = NOT_PROVEN_BY_PR12
FIREBASE_RUNTIME_INITIALIZATION = NOT_PROVEN_BY_PR12
GOOGLE_SIGN_IN_CALLBACK_RUNTIME = NOT_PROVEN_BY_PR12
ENVIRONMENT_SEPARATION = NOT_IMPLEMENTED_BY_PR12
```

## CI del HEAD final

GitHub Actions conserva el run `30597527229` sobre el HEAD exacto `ce2efe5...` con los tres jobs generales en verde:

```text
Flutter — analyze + test = SUCCESS
Firestore — reglas de seguridad (A3/A5) = SUCCESS
Backend — migración + e2e (C2) = SUCCESS
```

Esos jobs acreditan la integración general del cambio, pero no incluyen un job macOS/Xcode que compile o ejecute la app iOS.

## Persistencia y evolución al corte PR #95

La capacidad introducida por PR #12 persiste al corte autoritativo PR #95:

- `DefaultFirebaseOptions.currentPlatform` sigue devolviendo opciones iOS reales;
- existe configuración Firebase iOS real de Production;
- la estructura iOS contiene configuraciones Firebase separadas por entorno;
- la configuración vigente ya no usa el Bundle ID histórico de PR #12.

```text
PR12_IOS_FIREBASE_CAPABILITY_PRESERVED_AT_PR95 = YES
PR12_PLACEHOLDER_STATE_RETURNED = NO
PR12_HISTORICAL_BUNDLE_ID = com.ridepro.app
PR95_BUNDLE_ID_DIFFERS = YES
LATER_ENVIRONMENT_EVOLUTION_ATTRIBUTED_TO_PR12 = NO
```

La reconciliación usa el corte #95 solo para comprobar persistencia/supersesión; no adjudica a PR #12 los cambios que pertenecen a PR posteriores.

## Drift documental detectado

Dos guías operativas seguían describiendo el estado anterior a PR #12 como si fuera vigente:

### `SETUP_SOCIAL_LOGIN.md`

Afirmaba que:

- `ios/Runner/Info.plist` todavía contenía `YOUR_REVERSED_CLIENT_ID`;
- `GoogleService-Info.plist` seguía siendo un placeholder con valores inventados;
- Firebase Auth iOS no funcionaría hasta reemplazar ese archivo;
- el checklist todavía exigía pegar ambos valores como trabajo pendiente.

Esas instrucciones quedaron superadas directamente por PR #12.

### `PLATFORM_SETUP.md`

Seguía instruyendo pegar `REVERSED_CLIENT_ID_AQUI` en `Info.plist` como si la configuración iOS nunca se hubiera integrado.

## Corrección aplicada

Se actualizaron ambas guías para:

- registrar que la configuración estática Firebase iOS existe desde PR #12;
- eliminar la instrucción obsoleta de rellenar placeholders iOS;
- convertir los pasos iOS en verificaciones de coherencia/reconfiguración;
- separar configuración estática de build/runtime real;
- no congelar como vigentes los Bundle IDs históricos de PR #12;
- no adelantar como cerrados los pendientes Android/Web ni la separación de entornos de PR posteriores.

No se modificó `PROJECT_STATUS.md` y no se tocaron archivos de configuración Firebase/iOS de producción durante esta reconciliación documental.

## Resultado

```text
PR_12_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DOCUMENTATION_CLOSED = YES
FILES_FIXED = SETUP_SOCIAL_LOGIN.md, PLATFORM_SETUP.md, docs/audits/PR_12_DOCUMENTATION_RECONCILIATION.md
IOS_PLACEHOLDER_REMOVED_VIA_PR12 = YES
IOS_FIREBASE_OPTIONS_VIA_PR12 = YES
IOS_GOOGLE_URL_SCHEME_VIA_PR12 = YES
CI_PR12 = 3_OF_3_SUCCESS
IOS_NATIVE_BUILD_PROVEN_BY_PR12 = NO
IOS_RUNTIME_PROVEN_BY_PR12 = NO
LATER_ENVIRONMENT_SEPARATION_ATTRIBUTED_TO_PR12 = NO
PROJECT_STATUS.md = UNTOUCHED
PRODUCTION_MUTATIONS = 0
PROGRESS_DOCUMENTATION_CLOSED = 12/95
NEXT = PR #13
```
