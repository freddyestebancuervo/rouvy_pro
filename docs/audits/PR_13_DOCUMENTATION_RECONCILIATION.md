# PR #13 — Reconciliación documental

## Identidad

```text
PR = #13
TITLE = ci(ios): add macOS build validation
STATE = CLOSED
MERGED = NO
BASE_SHA = 90d07a9b24859234f1649b4b38f9fa223be3740f
HEAD_SHA = 5fbbef754d8097b4440d770cde1bd7aa7b31a2f8
COMMITS = 2
CHANGED_FILES = 1
CI_GENERAL_RUN = 30599568472 / SUCCESS
IOS_DIAGNOSTIC_RUN = 30599568531 / FAILURE_BY_DESIGN
```

## Qué hizo realmente PR #13

PR #13 fue un PR experimental de diagnóstico para validar el build iOS en un runner macOS sin firma de código. Modificó únicamente `.github/workflows/ios-build.yml` y no fue fusionado a `main`.

El workflow instaló Flutter 3.32.0, registró el entorno macOS/Xcode/CocoaPods, ejecutó `flutter pub get`, inspeccionó el proyecto iOS e intentó `flutter build ios --debug --no-codesign -v`.

El primer intento mantuvo el deployment target histórico iOS 13.0 y falló durante la resolución nativa. El diagnóstico añadió una inspección del paquete `health` resuelto y encontró que `health` 13.3.1 exige iOS 14.0.

## Prueba efímera y resultado

El HEAD final de PR #13 añadió una prueba deliberadamente efímera dentro del checkout temporal del runner:

```text
IPHONEOS_DEPLOYMENT_TARGET = 13.0 -> 14.0
PERSISTED_TO_REPOSITORY = NO
COMMIT_CREATED = NO
```

Después de aplicar ese cambio solo dentro del runner, el paso `Ephemeral test - bump deployment target to 14.0 (not committed)` terminó en `SUCCESS`. El propio comentario de cierre del PR registra que CocoaPods resolvió, `xcodebuild` completó y se produjo `build/ios/iphoneos/Runner.app` sin firma.

GitHub conserva la secuencia del job final:

```text
STEPS_1_TO_8 = SUCCESS
BUILD_WITH_IOS_13 = FAILURE
EPHEMERAL_IOS_14_RETRY = SUCCESS
ARTIFACT_INSPECTION = SUCCESS
OVERALL_IOS_WORKFLOW = FAILURE
```

El workflow global quedó rojo porque el primer intento con iOS 13.0 era un paso real que fallaba antes de la prueba efímera. Ese rojo no se reinterpreta como un fallo pendiente del producto: forma parte del diagnóstico histórico.

## Qué NO integró PR #13

Como el PR fue cerrado sin merge:

- no cambió permanentemente el deployment target de iOS en `main`;
- no integró un workflow iOS estable;
- no configuró signing, certificados ni provisioning profiles;
- no demostró runtime en simulador o dispositivo;
- no probó Firebase, Google Sign-In, HealthKit, APNs ni Keychain en runtime;
- no ejecutó despliegues ni mutaciones de Production.

```text
IOS_13_NATIVE_BUILD = FAILED_AS_DIAGNOSTIC
ROOT_CAUSE_HEALTH_REQUIRES_IOS_14 = PROVEN_BY_PR13
EPHEMERAL_IOS_14_UNSIGNED_BUILD = PROVEN_BY_PR13
RUNNER_APP_GENERATED = PROVEN_BY_PR13
PERMANENT_IOS_14_FIX = NOT_IN_PR13
IOS_RUNTIME = NOT_PROVEN_BY_PR13
```

## Relación con PR #14

PR #14 es el follow-up que convirtió el hallazgo de #13 en un cambio permanente: fue fusionado y subió `IPHONEOS_DEPLOYMENT_TARGET` de 13.0 a 14.0, además de añadir la versión estable del workflow macOS de build sin firma.

La reconciliación mantiene la atribución estricta:

```text
PR13 = DIAGNOSTIC_EVIDENCE_ONLY
PR14 = PERMANENT_FIX
LATER_FIX_ATTRIBUTED_TO_PR13 = NO
```

## Drift documental

No se detectó una guía operativa que requiriera corrección específica atribuible únicamente a PR #13. Su resultado fue diagnóstico y el cambio permanente fue integrado inmediatamente por PR #14; por tanto, alterar documentación operativa para presentar #13 como implementación sería incorrecto.

La acción documental correcta es preservar el resultado de #13 como evidencia histórica y avanzar al PR #14 para reconciliar el estado permanente.

## Resultado

```text
PR_13_AUDIT = VERIFIED
PR_13_CLASSIFICATION = CLOSED_DIAGNOSTIC_NOT_MERGED
DOCUMENTATION_DRIFT_FOUND = NO_ACTIONABLE_DRIFT_UNIQUE_TO_PR13
DOCUMENTATION_CLOSED = YES
FILES_FIXED = docs/audits/PR_13_DOCUMENTATION_RECONCILIATION.md
IOS_13_BUILD = FAILURE
IOS_14_EPHEMERAL_BUILD = SUCCESS
RUNNER_APP_GENERATED = YES
PERMANENT_FIX_IN_PR13 = NO
PROJECT_STATUS.md = UNTOUCHED
PRODUCTION_MUTATIONS = 0
PROGRESS_DOCUMENTATION_CLOSED = 13/95
NEXT = PR #14
```
