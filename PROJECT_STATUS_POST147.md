# Korixa — Evidencia Operativa POST-147 — SCREEN_02 Login

> **Documento de cierre puntual posterior a PR #147.** No reemplaza `PROJECT_STATUS.md` como fuente operativa vigente ni reescribe los snapshots históricos anteriores. Su alcance es exclusivamente el cierre visual/técnico de SCREEN_02 Login aprobado por el propietario y fusionado a `main` el 2026-09-13.

## Identidad del cierre

```text
DATE = 2026-09-13
SCOPE = PR #147 / SCREEN_02 Login
PR = #147
PR_HEAD_APPROVED = f98b6b5db3785b419f8a5c0016bb8d423826a09d
PR_STATE = MERGED
MERGE_COMMIT = 27f0989012e0fb0f9e9c406762eb6109d512d7ec
BASE_MAIN_BEFORE_MERGE = 5c98a2f2966105e0f9d4423794843131d3d48272
OWNER_APPROVAL = MOBILE + WEB
PRODUCTION_DEPLOY = NO
```

## Resultado aprobado

SCREEN_02 Login queda cerrada visualmente en las dos variantes aprobadas por el propietario:

```text
SCREEN_02_MOBILE = APPROVED / LOCKED
SCREEN_02_WEB = APPROVED / LOCKED
NO_MORE_VISUAL_CHANGES_IN_THIS_CLOSEOUT = YES
AUTH_BEHAVIOR_CHANGE = NO
BACKEND_CHANGE = NO
BLE_CHANGE = NO
PRODUCTION_CHANGE = NO
```

### Mobile portrait

- Hero dedicado: `assets/images/korixa_login_hero_guatape_mobile.png`.
- Composición full-bleed sobre Guatapé/Piedra del Peñol.
- Sin logo superior flotante en mobile.
- CTA primario `Iniciar sesión` sin flecha.
- Indicador visual de 3 barras con barra central activa.
- Grupo de Login compacto, bottom-anchored y responsive.
- Scroll solo cuando el contenido realmente desborda; no existe piso artificial de altura para forzar scroll.
- Sin `Transform.scale`, `Matrix4` ni zoom runtime del hero.
- Validado durante el PR en viewports móviles representativos, incluyendo 360×680, 390×844, 412×890 y 430×932.

### Web / desktop

- Hero dedicado: `assets/images/korixa_login_hero_guatape_web.png`.
- Asset final aprobado: 4096×1751 px, misma composición aprobada, sin modificación del archivo durante la integración final.
- Render existente con `Image.asset` + `BoxFit.cover`; no se añadió `Transform.scale`, `Matrix4`, `FittedBox` custom ni mecanismo de zoom artificial.
- La composición conserva al ciclista/Piedra del Peñol y mantiene el panel de Login legible a la derecha.
- Validación visual reportada en 1440×900 y 1920×1080.
- El hero de desktop también es el asset compartido por phone landscape; mobile portrait conserva su asset independiente.

> Nota de precisión: `BoxFit.cover` puede escalar/recortar visualmente según la relación de aspecto del viewport; `NO ZOOM` en este cierre significa **sin mecanismo adicional de zoom artificial**. El asset final de 4096 px de ancho se adoptó para reducir pérdida de nitidez en pantallas grandes.

## Archivos integrados por PR #147

El PR #147 acumuló las rondas de refinamiento de SCREEN_02 y cambios compartidos de presentación/tests asociados. GitHub reporta estos archivos en el PR:

```text
assets/images/korixa_login_hero_guatape_mobile.png
assets/images/korixa_login_hero_guatape_web.png
lib/core/design_system/dark_tech_buttons.dart
lib/core/design_system/dark_tech_indicators.dart
lib/features/auth/presentation/pages/login_page.dart
lib/features/auth/presentation/pages/welcome_page.dart
test/features/auth/presentation/pages/login_page_test.dart
test/features/auth/presentation/pages/welcome_page_test.dart
test/navigation/demo_navigation_test.dart
```

La ronda final del hero web fue asset-only más comentario documental; no cambió lógica de autenticación.

## Gates antes del merge

Sobre el HEAD exacto aprobado `f98b6b5db3785b419f8a5c0016bb8d423826a09d`, GitHub Actions terminó en `SUCCESS`:

```text
CI_RUN = 34786218547
CI = SUCCESS
Flutter — analyze + test = SUCCESS
Firestore — reglas de seguridad (A3/A5) = SUCCESS
Backend — migración + e2e (C2) = SUCCESS
Night Agent — security + test = SUCCESS
REQUIRED_CI = 4/4 SUCCESS

iOS — build validation = SUCCESS (run 34786218532)
iOS — simulator smoke test = SUCCESS (run 34786218516)
```

Validación local/reportada en la ronda final:

```text
flutter analyze --fatal-infos = CLEAN
test/features/auth/ = 239/239 PASS
flutter build web --release -t lib/main_development.dart = PASS
```

## Preview de Development usado para revisión visual

```text
FIREBASE_PREVIEW_CHANNEL = korixa-ui
PREVIEW_URL = https://ridepro-development--korixa-ui-jph0suom.web.app
PRODUCTION_DEPLOY = NO
```

El preview fue usado únicamente para revisión/aceptación visual. Este cierre no afirma ni autoriza deploy a Production.

## Decisión del propietario

El 2026-09-13 el propietario aprobó explícitamente:

```text
SCREEN_02_MOBILE = APPROVED
SCREEN_02_WEB = APPROVED
CLOSE_SCREEN_02 = YES
MERGE_PR_147 = AUTHORIZED
```

Tras esa autorización, PR #147 fue fusionado correctamente a `main` con merge commit `27f0989012e0fb0f9e9c406762eb6109d512d7ec`.

## Qué NO demuestra este cierre

```text
PRODUCTION_DEPLOYED = NO
PRODUCTION_READY = NO CLAIM
AUTH_RUNTIME_BEHAVIOR_REVALIDATED_BY_THIS_DOC = NO
NEW_BACKEND_FUNCTIONALITY = NO
NEW_BLE_FUNCTIONALITY = NO
SCREEN_03_OR_LATER_APPROVED = NO CLAIM
```

## Estado final

```text
PR_147 = MERGED
SCREEN_02_MOBILE = CLOSED / APPROVED / LOCKED
SCREEN_02_WEB = CLOSED / APPROVED / LOCKED
DOCUMENTATION_CLOSEOUT = RECORDED
NEXT_VISUAL_WORK = OUTSIDE_SCREEN_02
```
