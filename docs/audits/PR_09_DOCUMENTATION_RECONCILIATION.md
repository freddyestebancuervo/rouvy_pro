# PR #9 — Reconciliación documental

## Identidad

```text
PR = #9
TITLE = fix(health): guard native platform checks on web
STATE = MERGED
BASE_SHA = 976996c4f93b673c48cd92d9bed6665cfb8999d7
HEAD_SHA = 9537f55bbf3bcd6e89e554f34f97047a152c109f
MERGE_SHA = 0582e4933ef9f1e5ab0fce8f18197c6ffb2c7614
COMMITS = 1
CHANGED_FILES = 2
CI_RUN = 30592114526
CI = 3/3 SUCCESS
```

## Qué estableció realmente PR #9

PR #9 implementó la corrección de `T-F0.1` en `HealthPlatformGatewayImpl.checkAvailability()`: antes de evaluar `dart:io Platform.isIOS` / `Platform.isAndroid`, el gateway detecta Web mediante `PlatformCapabilities.isWeb` y devuelve `HealthAvailability.unavailable`.

El cambio quedó limitado a dos archivos:

- `lib/core/health/health_platform_gateway_impl.dart`
- `test/core/health/health_platform_gateway_impl_test.dart`

La implementación añadió un `isWeb` inyectable únicamente para testabilidad y una regresión automatizada que cubre `checkAvailability()`, `requestPermissions()` y `checkPermissionStatus()` en la rama Web, además de preservar el comportamiento no-Web del host de test.

## CI del HEAD final

El run `30592114526` terminó con los tres jobs de CI en verde:

```text
Flutter — analyze + test = SUCCESS
Firestore — reglas de seguridad (A3/A5) = SUCCESS
Backend — migración + e2e (C2) = SUCCESS
```

La afirmación del body del PR de que también se validó `flutter build web` se conserva como metadata del PR, pero GitHub Actions de este PR no contiene un job separado de build Web. Por tanto, esta reconciliación clasifica como directamente probado por GitHub el código, los tests y el CI 3/3; no usa PR #9 por sí solo como evidencia de una interacción manual en navegador real.

## Persistencia al corte PR #95

En el árbol exacto de PR #95 siguen presentes tanto la guarda Web como la regresión automatizada:

```text
WEB_GUARD_PRESENT_AT_PR95 = YES
PLATFORM_CHECKS_AFTER_WEB_GUARD = YES
REGRESSION_TEST_PRESENT_AT_PR95 = YES
PR9_CHANGE_PRESERVED = YES
```

`PROJECT_STATUS.md` al corte #95 registra además que la validación manual complementaria en navegador se completó en una sesión posterior. Esa evidencia posterior confirma el cierre operativo de la tarea, pero no se atribuye retrospectivamente al PR #9.

## Drift documental detectado

`docs/tasks/TF0_1_ANALISIS_Y_DISENO.md` termina correctamente, como snapshot de 2026-07-24, diciendo que la implementación quedaba a la espera de aprobación. Después de PR #9, esa frase ya no puede leerse como estado vigente.

No se reescribió ese documento histórico. Se actualizó `docs/architecture/README.md`, la guía de vigencia documental creada durante la reconciliación, para registrar explícitamente que:

- el análisis/diseño de T-F0.1 fue ejecutado mediante PR #9;
- PR #9 acredita implementación + tests + CI, no por sí solo una validación manual Web real;
- el hallazgo separado `HealthPackageAdapter._isIOS` documentado en la sección 12 del análisis no se considera resuelto por PR #9 porque estaba fuera de alcance.

## Resultado

```text
PR_9_AUDIT = VERIFIED
DOCUMENTATION_DRIFT_FOUND = YES
DOCUMENTATION_CLOSED = YES
FILES_FIXED = docs/architecture/README.md, docs/audits/PR_09_DOCUMENTATION_RECONCILIATION.md
TF0_1_GATEWAY_FIX = IMPLEMENTED_VIA_PR_9
WEB_GUARD_AT_PR95 = PRESENT
REGRESSION_TEST_AT_PR95 = PRESENT
CI_PR9 = 3_OF_3_SUCCESS
MANUAL_BROWSER_VALIDATION_BY_PR9 = NOT_PROVEN
H_WEARABLES_NEW_1_RESOLVED_BY_PR9 = NO
HISTORICAL_DESIGN_REWRITTEN = NO
PROJECT_STATUS.md = UNTOUCHED
PRODUCTION_MUTATIONS = 0
PROGRESS_DOCUMENTATION_CLOSED = 9/95
NEXT = PR #10
```
