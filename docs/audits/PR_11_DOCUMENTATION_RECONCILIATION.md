# PR #11 — Reconciliación documental

## Identidad

```text
PR = #11
TITLE = feat(ios): add base Flutter scaffold
STATE = MERGED
BASE_SHA = 4feae4e62227eeb25ea22fe1028bc3bc075ee7b3
HEAD_SHA = ab25da2a634a5ef13e4e29f0874676165218b9f5
MERGE_SHA = 16e81cc1dd2c50449de50266c721710b3694b6bf
COMMITS = 1
CHANGED_FILES = 38
CI_RUN = 30596685674
CI = 3/3 SUCCESS
```

## Qué estableció realmente PR #11

PR #11 integró a `main` el scaffold nativo base de Flutter para iOS generado con Flutter 3.32.0. El diff quedó limitado a `ios/` e incorporó el proyecto/workspace Xcode, configuraciones Flutter, `Runner`, assets, storyboards y `RunnerTests`.

En el HEAD exacto del PR:

```text
IOS_NATIVE_SCAFFOLD = PRESENT
PRODUCT_BUNDLE_IDENTIFIER = com.ridepro.app
IPHONEOS_DEPLOYMENT_TARGET = 13.0
DART_PRODUCTION_CHANGES = 0
FIREBASE_IOS_REAL_CONFIG = NOT_INCLUDED
SIGNING_CREDENTIALS = NOT_INCLUDED
```

El propio PR declaró explícitamente fuera de alcance Firebase iOS real, URL schemes OAuth, credenciales de signing, CocoaPods artefactos y cambios Dart de producción.

## CI del HEAD final

El run `30596685674` terminó con los tres jobs generales en verde:

```text
Flutter — analyze + test = SUCCESS
Firestore — reglas de seguridad (A3/A5) = SUCCESS
Backend — migración + e2e (C2) = SUCCESS
```

El job Flutter corrió en Linux y ejecutó `flutter analyze`, tests y reporte de cobertura. No hubo job macOS/Xcode dentro de este PR.

Por tanto:

```text
STATIC_SCAFFOLD_INTEGRATION = PROVEN
GENERAL_CI = PROVEN
IOS_NATIVE_BUILD_BY_PR11 = NOT_PROVEN
XCODE_RUNTIME_BY_PR11 = NOT_PROVEN
SIMULATOR_OR_DEVICE_LAUNCH_BY_PR11 = NOT_PROVEN
```

Esto coincide con el body histórico del PR, que dejó la validación macOS (`flutter build ios --no-codesign`, CocoaPods, Xcode y lanzamiento) como requisito posterior.

## Persistencia al corte PR #95

El árbol exacto del corte autoritativo PR #95 conserva la estructura iOS introducida por PR #11, incluyendo `Runner.xcodeproj` y `RunnerTests`. La estructura evolucionó después:

```text
PR11_IOS_SCAFFOLD_PRESERVED_AT_PR95 = YES
PR11_BUNDLE_ID_HISTORICAL = com.ridepro.app
PR95_PRODUCTION_BUNDLE_ID = com.korixa.app
PR95_DEVELOPMENT_BUNDLE_ID = com.korixa.app.dev
PR11_DEPLOYMENT_TARGET_HISTORICAL = 13.0
PR95_DEPLOYMENT_TARGET = 14.0
```

Los identificadores y el deployment target del corte #95 proceden de PR posteriores; esta reconciliación no los atribuye retroactivamente a PR #11 ni adelanta su cierre secuencial.

## Drift / riesgo de lectura documental

`docs/audits/AUDITORIA_FINAL/06_MULTIPLATAFORMA.md` es un snapshot de la rama `feature/d2` del 2026-07-24 y ya decía que `ios/` estaba presente. Esa observación histórica no prueba por sí misma que el scaffold estuviera integrado a `main`; PR #11 es la evidencia GitHub que sí establece esa integración.

No se reescribió el Documento 6. Se actualizó `docs/architecture/README.md`, la guía de vigencia de esta reconciliación, para distinguir:

- presencia histórica de `ios/` en la rama auditada;
- integración real a `main` mediante PR #11;
- límites de evidencia de PR #11 (sin build macOS/Xcode);
- evolución posterior del bundle ID y deployment target sin atribución retroactiva.

## Resultado

```text
PR_11_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DOCUMENTATION_CLOSED = YES
FILES_FIXED = docs/architecture/README.md, docs/audits/PR_11_DOCUMENTATION_RECONCILIATION.md
IOS_SCAFFOLD_INTEGRATED_VIA_PR11 = YES
CI_PR11 = 3_OF_3_SUCCESS
IOS_NATIVE_BUILD_PROVEN_BY_PR11 = NO
MACOS_XCODE_VALIDATION_PROVEN_BY_PR11 = NO
PR11_CHANGE_PRESERVED_AT_PR95 = YES
LATER_IOS_EVOLUTION_ATTRIBUTED_TO_PR11 = NO
HISTORICAL_MULTIPLATFORM_AUDIT_REWRITTEN = NO
PROJECT_STATUS.md = UNTOUCHED
PRODUCTION_MUTATIONS = 0
PROGRESS_DOCUMENTATION_CLOSED = 11/95
NEXT = PR #12
```
