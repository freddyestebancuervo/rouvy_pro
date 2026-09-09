# 27 — Cierre del bloque GIS Web Auth Remediation + Auditoría UI de cierre

```
SOURCE_TASKS = KORIXA-WEB-GOOGLE-AUTH-GIS-REMEDIATION-20260907
                KORIXA-WEB-GOOGLE-AUTH-GIS-FINAL-VALIDATION-20260907
                KORIXA-GIS-WEB-POINTER-INTERACTION-DIAGNOSIS-20260907
                KORIXA-LOGIN-REGISTER-NAVIGATION-ROOT-CAUSE-20260907
                KORIXA-AUTH-WRAP-ROW-CAUSAL-VALIDATION-20260907
                KORIXA-AUTH-NAVIGATION-CLEAN-BUILD-VALIDATION-20260907
                KORIXA-REGISTER-LOGIN-LINK-FINAL-FIX-20260907
                KORIXA-AUTH-UI-VISUAL-CLOSURE-20260908
                KORIXA-AUTH-GIS-STABLE-DEVELOPMENT-FINAL-GATE-20260908
                KORIXA-AUTH-KNOWN-GOOD-VS-BAD-DIFFERENTIAL-AUDIT-20260908
                KORIXA-GIS-PLATFORMVIEW-PRESENCE-AB-TEST-20260908
                KORIXA-WEB-GOOGLE-FIREBASE-POPUP-POC-20260908
                KORIXA-WEB-GOOGLE-FIREBASE-POPUP-HUMAN-ACCEPTANCE-AND-STABLE-DEV-GATE-20260908
                KORIXA-WEB-GOOGLE-FIREBASE-POPUP-FINALIZE-PR-GATE-20260908
STATUS = NO INTEGRADO A `main` todavía — rama aislada, validación de
         Development (preview + estable) completada y aceptada por un
         humano, preparándose para commit/PR bajo la misma tarea que
         cerró este documento. No fusionar sin autorización explícita
         adicional (gate de merge separado).
         ARQUITECTURA VIGENTE: GIS `renderButton()`/`HtmlElementView`
         (descrita en §1-§11 como contexto histórico) fue ABANDONADA y
         reemplazada por `FirebaseAuth` + `GoogleAuthProvider` +
         `signInWithPopup()` — cero plataforma-view en Login/Register,
         Android/iOS nativo sin cambios. Ver §12 para el detalle completo.
         VALIDACIÓN COMPLETA (Development únicamente): preview efímero
         (navegación, login de Google real, sesión, logout/re-login = PASS;
         cancelación del popup = UNPROVEN en esa ronda) y Development
         ESTABLE (`https://ridepro-development.web.app`, fingerprint
         SHA-256 idéntico local/desplegado, mismos PASS más
         `POPUP_CANCEL_RECOVERY = PASS`) — ambos en §12.
         `AUTH_WEB_GOOGLE_FLOW = VALIDATED_IN_DEVELOPMENT`. **Production NO
         fue tocado ni validado en ningún momento de todo este hilo.**
BRANCH = fix/web-google-auth-gis-remediation-20260907
BASE_SHA = e4f1dae767000336472335541bd9d8744fc9f444
```

## 1. Qué se implementó (working tree, sin commit)

Reemplazo del flujo Web de "Continuar con Google", que usaba `GoogleSignIn().signIn()` — método marcado deprecado en Web por el propio paquete `google_sign_in_web` porque su detección de cierre de popup vía `popup.closed` es bloqueada por Chrome COOP, causando el bug real original (loading infinito). El nuevo flujo Web usa exclusivamente Google Identity Services (`renderButton()` + `onCurrentUserChanged`), con Android/iOS sin cambios (`signIn()` imperativo intacto). Sin upgrade de `google_sign_in`/`google_sign_in_web` — la versión ya fijada (`0.12.4+4`) ya soporta `renderButton()`.

**Archivos nuevos:**
- `lib/features/auth/presentation/widgets/google_identity_web_button.dart` / `_stub.dart` / `_web.dart` (export condicional `dart.library.html`, mismo patrón ya usado en `web_bluetooth_support.dart`)
- `lib/features/auth/presentation/widgets/google_web_sign_in_listener_mixin.dart`

**Archivos modificados:**
- `lib/core/di/injection.dart`, `lib/features/auth/data/datasources/auth_remote_datasource.dart`, `lib/features/auth/data/repositories/auth_repository_impl.dart` (nuevo `GoogleWebAuthGateway`, interfaz angosta de un solo método — el dominio sigue sin conocer `GoogleSignInAccount`, ver docblock de `auth_repository.dart`), `lib/features/auth/presentation/pages/login_page.dart`, `register_page.dart`, `lib/features/auth/presentation/providers/auth_providers.dart`, `social_auth_controller.dart`, `lib/features/auth/presentation/widgets/social_sign_in_buttons.dart`.
- `pubspec.yaml`/`pubspec.lock`: una sola dependencia nueva declarada (`google_sign_in_web: ^0.12.4`, ya presente como transitiva, ahora `direct main`) — diff del lockfile minimizado a 1 línea real; el entorno sandbox local (SDK Flutter más antiguo que el que generó el lockfile original) regenera ruido no relacionado en cada `flutter analyze`/`test`/`build`, revertido manualmente después de cada corrida.

Tests nuevos: `test/features/auth/presentation/widgets/social_sign_in_buttons_test.dart`, `google_web_sign_in_listener_mixin_test.dart`, `test/features/auth/presentation/providers/social_auth_controller_test.dart`.

## 2. Evidencia runtime real (no solo unitaria)

- Origen `https://ridepro-development.web.app` confirmado autorizado por Google Identity Services (200, cero errores de consola) — a diferencia de `localhost` y de canales de preview efímeros (`origin_mismatch`, 403).
- Click real reproducido contra ese origen: popup real de `accounts.google.com` (identificador de cuenta, sin `origin_mismatch`), cancelación probada (cierre del popup → UI de Korixa nunca queda bloqueada → reintento inmediato abre un popup nuevo), auditoría de red durante el login (5 requests puntuales, 0 requests durante 15s de idle posterior — sin polling).
- Selección real de una cuenta de Google **no fue posible probarla de forma automatizada** — requiere una cuenta de Google real y autenticada en el navegador, algo que un navegador headless sin cookies no puede simular ni debe intentar simular.

## 3. El hallazgo de navegación Login↔Register — cronología y estado real

Esta es la parte más importante de documentar con precisión, porque el propio patrón de investigación reveló una fuente de error significativa.

1. Diagnóstico inicial: hipótesis de que el `HtmlElementView` de GIS interceptaba clics de widgets vecinos (bounding box/overlay). **Descartada con evidencia directa** — `elementFromPoint` en las coordenadas reales de "Inicia sesión"/"Crear cuenta" nunca devolvió el iframe de GIS, y un enlace ("¿Olvidaste tu contraseña?") completamente por ENCIMA del botón de Google también mostraba el mismo síntoma en las pruebas automatizadas de esa sesión.
2. Segunda hipótesis: `Wrap` dentro del `IntrinsicHeight` compartido de `DarkTechAuthShell` como causa estructural. Un experimento controlado A/B (`Wrap`→`Row` solo en Register, Login sin tocar) fue revertido tras comprobar, con evidencia humana real, que **ambas** variantes (`Row` y `Wrap` original) navegaban correctamente — la hipótesis de `Wrap` como causa quedó **descartada**. El experimento `Row` además introdujo una regresión real y demostrada (`RenderFlex overflowed by 43 pixels`, 14 tests fallando) — revertida junto con la hipótesis.
3. Se detectó y probó que el dominio estable `https://ridepro-development.web.app` servía un `main.dart.js` sustancialmente distinto (~150KB de diferencia, ~93% de bytes distintos) del build limpio verificado por fingerprint SHA-256 en ese momento — **`STALE_OR_DIFFERENT_STABLE_DEPLOYMENT = PROVEN`**. Ese dominio corre además un service worker de cacheo persistente heredado (`CACHE_NAME='flutter-app-cache'`) que el build actual ya no genera (el build actual emite un service worker que se autodesregistra) — un vector real de servir contenido obsoleto a cualquier navegador que lo haya visitado antes de un redeploy.
4. En la sesión más reciente de investigación de causa raíz, se descubrió que el propio método de clic automatizado usado en TODA esta investigación (`page.mouse.click(x, y)` por coordenadas crudas, sin un `mousemove` previo realista) producía **falsos negativos sistemáticos** en estos controles específicos — reproducido de forma limpia y repetible (3/3, sin excepciones) usando en cambio la API de más alto nivel de Playwright (`locator.click()`, que sí hace hover real antes del clic), que confirmó navegación exitosa en ambas direcciones (Register→Login y Login→Register) sobre el build limpio verificado por fingerprint.

**Conclusión honesta, sin sobre-afirmar:**

```
REGISTER_TO_LOGIN_CODE_DEFECT = UNPROVEN
CURRENT_BUILD_IMPLEMENTATION = TEST_GREEN
MULTI_ENVIRONMENT_BEHAVIOR = MIXED_HISTORICAL_EVIDENCE
LIKELY_CACHE_OR_ENVIRONMENT_FACTOR = INFERRED
```

No se afirma "bug de Register→Login corregido" porque nunca se probó, con una metodología confiable, que existiera un defecto de código — la traza causal completa (habilitado → hit recibido → callback → `context.go` → router → cambio de ruta) resultó verde de punta a punda una vez corregido el método de prueba. Lo que permanece sin probar es por qué una observación manual aislada, en un entorno ya no disponible para reproducir, reportó lo contrario — las explicaciones más plausibles (caché/service worker obsoleto del dominio estable, o un clic real que no llegó a registrarse) quedan como **INFERIDAS**, no como hecho cerrado.

## 4. Auditoría visual de cierre (KORIXA-AUTH-UI-VISUAL-CLOSURE-20260908)

Capturas reales (Playwright, Chromium headless) de Welcome/Login/Register/Forgot-Password en 4 anchos (1920×1080, 1366×768, 1024×768, 390×844) sobre un preview efímero con fingerprint verificado contra el build local. **Sin overflow, sin clipping, sin desbordes** en ninguna combinación página×ancho para Welcome/Login/Register — el botón de Google Identity Services escala correctamente en todos los tamaños probados (`minimumWidth` acotado a `[200, 400]`). Orden de tabulación y visibilidad de foco verificados manualmente vía capturas (email → contraseña → alternar visibilidad → "¿Olvidaste tu contraseña?"), todos con indicador de foco visible. Estado de carga (`PrimaryGradientButton`) confirmado sin desplazamiento de layout por construcción de código — `Ink(height: <fija>)` con el spinner centrado dentro, nunca redimensiona el botón.

**Único hallazgo real, no corregido:** `ForgotPasswordPage` no usa `DarkTechAuthShell` (fondo claro Material por defecto + `AppPrimaryButton` rojo) mientras Login/Register sí lo usan (Dark Tech). Verificado contra `docs/design/KORIXA_SCREEN_SPECS.md` (registro oficial de los 10 screens del rollout Dark Tech): `ForgotPasswordPage` **no es una de las 10 pantallas registradas** — solo aparece como el enlace "forgot password" *dentro* de `SCREEN_02 LOGIN`. Aplicar el shell a esa página unilateralmente en esta tarea habría sido una expansión de alcance no autorizada por ningún roadmap existente — se documenta como recomendación de seguimiento, no se implementa.

## 5. Tests (build limpio, sin el experimento `Row`)

`flutter analyze`: 0 errores/advertencias (12 infos preexistentes no relacionadas en `settings_page.dart`, `deprecated_member_use` de `RadioGroup`). `flutter test test/features/auth/`: 136/136. `flutter test` completo: 531 passed / 5 skipped / 0 failed. `flutter build web --release -t lib/main_development.dart`: exitoso. `git diff --check`: limpio. `pubspec.lock`: diff minimizado a 1 línea real (`google_sign_in_web` transitive→direct main, mismo hash/versión).

## 6. Riesgo de caché / service worker (para cualquier validación manual futura)

Cualquier verificación manual contra `https://ridepro-development.web.app` debe considerar que ese dominio, al momento de este cierre, sirve un build verificablemente distinto del actual y corre un service worker de cacheo persistente heredado. Antes de confiar en una prueba manual contra ese dominio específico: usar una ventana privada/incógnito, o verificar en DevTools → Application → Service Workers que no hay un worker controlando la página con caché obsoleta, o preferir un canal de preview efímero recién desplegado con fingerprint verificado. Este documento **no autoriza** sobrescribir ese dominio — esa decisión queda pendiente del propietario.

## 7. No autorizado / no tocado en todo este bloque

Cero mutaciones de Production, IAM, Secret Manager u OAuth. Cero cambios a dependencias más allá de la única declarada arriba. Cero commits, cero push, cero PR, cero merge en ninguna de las 8 tareas que componen este cierre.

## 8. Próximo paso recomendado (histórico — ver §9 para el estado posterior real)

1. ~~Validación humana real (no automatizada) de Register→"Inicia sesión" contra un preview efímero fresco~~ — sigue pendiente, ver §9.
2. ~~Decisión explícita del propietario sobre si redesplegar `https://ridepro-development.web.app` con el build actual~~ — **ejecutado**, ver §9.
3. Tarea de UI separada, explícitamente autorizada, para decidir si `ForgotPasswordPage` se incorpora al rollout Dark Tech (añadiéndola al registro de `KORIXA_SCREEN_SPECS.md` primero, no como fix silencioso) — sigue pendiente, sin cambios.
4. Solo después de que §9 quede cerrada con QA humano real: commit, PR, revisión y merge de esta rama.

## 9. Sincronización de Development estable (KORIXA-AUTH-GIS-STABLE-DEVELOPMENT-FINAL-GATE-20260908)

Con autorización explícita de esa tarea (única vez en todo este hilo que se autorizó tocar el dominio estable), se ejecutó `firebase deploy --only hosting --project ridepro-development` con el build limpio exacto ya validado (mismo código que produjo `flutter analyze`/`test`/`build` en verde en el bloque 8 de este documento — cero cambios de código entre ambos bloques).

**Identidad del build, verificada por hash, no por confianza:**
- `LOCAL_MAIN_DART_JS_SHA256 = 6fb364aed7a91f0083351e46dd5efdad3188255cf4d0c708728bc73ff77d9f8d`
- `DEPLOYED_MAIN_DART_JS_SHA256 = 6fb364aed7a91f0083351e46dd5efdad3188255cf4d0c708728bc73ff77d9f8d` (descargado directamente de `https://ridepro-development.web.app/main.dart.js` después del deploy)
- **Idénticos — `BUILD_MATCH_PROVEN = YES`.** Esto cierra formalmente el hallazgo `STALE_OR_DIFFERENT_STABLE_DEPLOYMENT` documentado en §3.3 y en la fila de `PROJECT_STATUS.md` — el dominio estable ahora sirve exactamente el mismo artefacto que el preview efímero ya auditado.

**Service worker heredado, verificado eliminado:** `https://ridepro-development.web.app/flutter_service_worker.js` devuelve ahora el mismo stub de 815 bytes que el build actual siempre genera (`self.skipWaiting()` en `install`, `self.registration.unregister()` + `clients.forEach(client => client.navigate(client.url))` en `activate`) — cero ocurrencias de `CACHE_NAME`, cero lógica de interceptación de `fetch`. El service worker persistente heredado (`CACHE_NAME='flutter-app-cache'`) documentado en §3.3/§6 **ya no se sirve desde este dominio**. Como este nuevo worker llama a `skipWaiting()` y fuerza un `navigate()` de cualquier cliente controlado en cuanto se activa, un navegador que ya tuviera instalado el worker de caché anterior debería autocorregirse solo, sin pasos manuales, en la primera o segunda carga después de este deploy — si algo pareciera desactualizado, una recarga forzada (Ctrl+Shift+R / Cmd+Shift+R) es más que suficiente; no se requiere borrar todos los datos del sitio.

**Verificación no destructiva de autorización de origen tras el deploy:** `gsi/button` respondió `200`, cero errores de consola en `/#/login` — el dominio sigue autorizado por Google Identity Services (la autorización de origen es una propiedad del dominio en Google Cloud Console, no del contenido desplegado, por lo que era esperable que sobreviviera intacta).

**Lo que NO se hizo, deliberadamente:** no se hizo clic en el botón de Google ni se intentó ninguna selección de cuenta desde esta sesión — esa tarea prohibió explícitamente sustituir automatización headless por el gate de aceptación humano (Fase 5), y la selección real de una cuenta de Google requiere una sesión de navegador autenticada real que esta sesión no posee ni debe fabricar. **La validación humana completa (selección de cuenta, credencial, sesión, navegación, logout/re-login) permanece PENDIENTE** — ningún campo de esa fase se marca `PASS` por inferencia.

Cero mutaciones de Production, IAM, Secret Manager, OAuth, backend o dependencias en este bloque — la única acción fue el deploy de Hosting a Development, explícitamente autorizado.

## 10. Auditoría diferencial Known-Good vs. Known-Bad (KORIXA-AUTH-KNOWN-GOOD-VS-BAD-DIFFERENTIAL-AUDIT-20260908)

Tarea de solo lectura, sin cambios de código. Evidencia humana real disponible por primera vez sobre DOS builds concretos:

- `KNOWN_GOOD` = `https://ridepro-development--korixa-ui-jph0suom.web.app` (canal `korixa-ui`, último release 2026-09-07 14:18:26) — humano: Login→Crear cuenta, Register→Inicia sesión, Forgot Password = PASS.
- `KNOWN_BAD` = `https://ridepro-development--korixa-gis-ordering-experiment-el0bynwb.web.app` (bloque 9 del hilo anterior) — humano: navegación de Register/Login peor que KNOWN_GOOD.

**Identidad de fuente, PROBADA por evidencia directa (no inferida):** `KNOWN_BAD` es exactamente el build de esta misma rama (`fix/web-google-auth-gis-remediation-20260907`) al cierre de la tarea anterior — SHA-256 de `main.dart.js` idéntico al ya fingerprint-verificado entonces. `KNOWN_GOOD` corresponde a la rama HERMANA `feat/screen02-login-visual-20260907` (mismo ancestro común `e4f1dae767000336472335541bd9d8744fc9f444`, worktree ya existente en `C:\proyectos\rouvy_proZIP\wt-screen02-login-visual-20260907`, HEAD `0897aeb23129df77c818716f7ac787d2cb2af4b3`, timestamp de commit 2026-09-07 14:17:52 — 34 segundos antes del deploy de `korixa-ui`, correlación temporal extremadamente fuerte aunque no criptográficamente probada como el caso de `KNOWN_BAD`).

**Hallazgo central, PROBADO por lectura directa de código (grep exhaustivo, cero coincidencias en la rama hermana):** `KNOWN_GOOD` no tiene absolutamente ningún `HtmlElementView`/`renderButton()`/import directo de `google_sign_in_web` en todo `lib/` — sigue usando el flujo imperativo deprecado `GoogleSignIn().signIn()` sin cambios respecto a la base, con un simple `OutlinedButton.icon` (el único cambio real de esa rama en `social_sign_in_buttons.dart` fue cosmético: reemplazar `Icons.g_mobiledata` por `assets/icons/google_logo.png`). `KNOWN_BAD` sí tiene exactamente una plataforma-view Web (el iframe de GIS). `register_page.dart`, el router, el estado de auth, Firebase/DI y `pubspec.lock` están completamente sin tocar en la rama `KNOWN_GOOD` respecto a `e4f1dae` — la única página modificada ahí es `login_page.dart` (rediseño visual) y `welcome_page.dart` (cambio cosmético de texto).

**Clasificación honesta:** esta es la correlación más limpia obtenida en todo este hilo de investigación entre presencia de plataforma-view Web y el síntoma humano de navegación — pero sigue siendo correlación entre dos ramas divergentes, no una prueba causal del mecanismo interno. `KNOWN_GOOD` probablemente tiene el bug ORIGINAL de Google Sign-In (el que motivó esta remediación) sin resolver, ya que nunca dejó el flujo deprecado — la evidencia humana de esa rama no confirma explícitamente que el login de Google en sí complete. Detalle completo de las 11 fases del análisis (fingerprints exactos, lista de archivos, 5 candidatos rankeados, experimento A/B recomendado) en el reporte de la tarea — no duplicado aquí.

**Próximo experimento recomendado (no ejecutado):** ocultar temporalmente, en un solo build de diagnóstico, únicamente el widget `renderButton()` en UNA página (ej. Register), dejando el resto del build de `KNOWN_BAD` intacto (mismo `Wrap`, mismo `TextButton`, mismo orden), y que un humano pruebe si "Inicia sesión" vuelve a funcionar con el botón de Google oculto — la prueba de una sola variable más pequeña posible para aislar la presencia de la plataforma-view como causa, separada de cualquier otra diferencia entre las ramas.

## 11. Experimento A/B de una sola variable — presencia de la plataforma-view GIS (KORIXA-GIS-PLATFORMVIEW-PRESENCE-AB-TEST-20260908)

Ejecutado exactamente el experimento recomendado en §10. Antes de construirlo, se revirtió el experimento de reordenamiento del bloque §9 anterior (`register_page.dart` volvió a quedar con diff idéntico a `e4f1dae` salvo la remediación GIS legítima — `GoogleWebSignInListenerMixin`) para garantizar que la ÚNICA variable entre las dos variantes fuera la presencia del `HtmlElementView` de GIS.

**Variante A (GIS real)** = `https://ridepro-development--korixa-gis-ab-variant-a-jixhp474.web.app` — SHA-256 de `main.dart.js`: `6fb364aed7a91f0083351e46dd5efdad3188255cf4d0c708728bc73ff77d9f8d` (local y desplegado idénticos). `flt-platform-view`/`iframe` en Register: **1**.

**Variante B (GIS oculto)** = `https://ridepro-development--korixa-gis-ab-variant-b-6al9uruz.web.app` — SHA-256 de `main.dart.js`: `ce717aa2ed7471faeba1efbeff1240ea8690f43ff02c34e108f2e7344c981841` (local y desplegado idénticos). `flt-platform-view`/`iframe` en Register: **0** — el botón de Google fue reemplazado por un `SizedBox` inerte del mismo alto aproximado (44px), en la misma posición, sin mover `"Inicia sesión"`, el divisor, los campos ni el botón de registro (confirmado visualmente, capturas idénticas salvo el área de Google).

Diferencia de código entre ambas variantes: **exactamente una línea** (`const bool _kDiagnosticHideGisPlatformView = false` vs `true`), controlando un único `if` que decide entre el `GoogleSignInButton` real y el `SizedBox` — probado en el propio diff que `Wrap`, `TextButton`, `onPressed`, el listener y el router no cambiaron entre variantes.

Suite de regresión sobre la Variante A: `flutter analyze` 0 errores, `flutter test test/features/auth/` 139/139, `flutter test` completo 534/5/0, `flutter build web` exitoso. Sobre la Variante B: mismo resultado salvo **una falla esperada y explicada** (`el botón de Google Sign-In navega a Home cuando el proveedor social tiene éxito` en `register_page_test.dart`, que depende exactamente del widget removido a propósito para este diagnóstico) — ninguna otra prueba se vio afectada.

**Resultado humano A/B (actualizado 2026-09-08):** primera repetición completada. Variante A (GIS presente): `A_ATTEMPT_1 = FAIL`. Variante B (GIS oculto): `B_ATTEMPT_1 = PASS`. `A_ATTEMPT_2/3` y `B_ATTEMPT_2/3` permanecen `UNPROVEN` — no se han ejecutado repeticiones adicionales.

**`GIS_PLATFORM_VIEW_PRESENCE_CAUSALITY = STRONGLY_SUPPORTED`** — con una sola repetición por variante, no se declara `PROVEN` en el sentido estricto que el propio protocolo de esta investigación exige (que pedía como mínimo 3 intentos por variante para esa clasificación más fuerte), pero el patrón obtenido (única variable de código = presencia del `HtmlElementView` de GIS; A falla, B funciona) es exactamente el que el experimento fue diseñado para detectar. **No se afirma ni se infiere ningún mecanismo interno del motor de Flutter** — solo que la presencia de la plataforma-view de GIS en la misma ruta controla el síntoma observado, consistente con la documentación oficial de Flutter Web ya citada en tareas anteriores sobre plataformas-view interceptando eventos de puntero.

**Estado final del worktree:** el interruptor de diagnóstico fue eliminado por completo después del build de ambas variantes — `register_page.dart` quedó exactamente en el estado limpio previo (solo la remediación GIS legítima), listo para la siguiente tarea sin ningún experimento residual.

**Tres opciones arquitectónicas propuestas para la siguiente tarea (no ejecutadas, solo si la causalidad se confirma):** (1) aislar el botón de GIS en un paso/pantalla de auth dedicado, sin otros controles de navegación Flutter coexistiendo en la misma ruta; (2) separar la propiedad de la plataforma-view del árbol de navegación mediante una capa de composición independiente (`Overlay`/`OverlayPortal`); (3) migrar a un flujo de Google Sign-In en Web sin plataforma-view si existe uno soportado (p. ej. `FirebaseAuth.instance.signInWithPopup(GoogleAuthProvider())` en vez de `google_sign_in_web`'s GIS) — esta última requeriría verificación propia de que no reintroduce el bug original de COOP que motivó todo este hilo.

## 12. Reemplazo arquitectónico: `FirebaseAuth.signInWithPopup` (KORIXA-WEB-GOOGLE-FIREBASE-POPUP-POC-20260908 + KORIXA-WEB-GOOGLE-FIREBASE-POPUP-HUMAN-ACCEPTANCE-AND-STABLE-DEV-GATE-20260908)

Con `GIS_PLATFORM_VIEW_PRESENCE_CAUSALITY = STRONGLY_SUPPORTED` (§11), se ejecutó la Opción A propuesta al final de §11: abandonar por completo la arquitectura GIS `renderButton()`/`HtmlElementView` en Web y reemplazarla por `FirebaseAuth` + `GoogleAuthProvider` + `signInWithPopup()`, sin volver al flujo imperativo deprecado `GoogleSignIn().signIn()` en Web.

**Falla original en Web (deprecada), para contexto histórico:** `GoogleSignIn().signIn()` en Web dependía de que `google_sign_in_web` detectara el cierre del popup vía `popup.closed`, bloqueado por Chrome COOP — causa raíz del loading infinito que motivó todo este hilo (§1).

**Remediación GIS (§1-§11), y su regresión de interacción:** la remediación con `renderButton()`/`HtmlElementView` (§1) eliminó la dependencia de `popup.closed`, pero introdujo una plataforma-view Web persistente en Login/Register cuya presencia quedó **fuertemente asociada** (`STRONGLY_SUPPORTED`, no `PROVEN` en sentido estricto — una sola repetición por variante, ver §11) a una regresión de interacción con los demás controles de navegación de la misma ruta, mediante un experimento A/B de una sola variable controlada (§11): `A_ATTEMPT_1 = FAIL` (GIS presente), `B_ATTEMPT_1 = PASS` (GIS oculto). No se afirmó ni se afirma ahora ningún mecanismo interno del motor de Flutter — solo la correlación causal entre presencia de la plataforma-view y el síntoma.

**Reemplazo implementado:** `AuthRemoteDataSourceImpl.signInWithGoogle()` ahora bifurca en `kIsWeb` (`debugIsWeb` inyectable solo para tests): en Web, `_firebaseAuth.signInWithPopup(fb.GoogleAuthProvider())` → `credential.user` → el mismo `_fetchOrCreateSocialUser(firebaseUser, AuthProviderType.google)` que ya usaban Android/iOS (sin lógica de sesión/cuenta duplicada). Toda la maquinaria específica de GIS quedó eliminada por ser código muerto: `GoogleWebSignInListenerMixin`, `GoogleWebAuthGateway` (interfaz + implementación + provider + registro DI), `googleSignInProvider`, `google_identity_web_button.dart`/`_stub.dart`/`_web.dart`, y la rama Web de `GoogleSignInButton` (vuelve a ser el mismo `OutlinedButton.icon` incondicional en todas las plataformas). Android/iOS no cambiaron: mismo `GoogleSignIn().signIn()` nativo, mismo registro DI.

```
HTML_PLATFORM_VIEW_COUNT_LOGIN = 0
HTML_PLATFORM_VIEW_COUNT_REGISTER = 0
NEW_DEPENDENCIES = 0 (firebase_auth ya era dependencia; `google_sign_in_web` explícito removido de pubspec.yaml — queda solo transitivo vía `google_sign_in`, sin forzar cirugía de dependencias)
K_COST_RISK = LOW (sin polling nuevo, sin llamadas nuevas a backend/Firebase/DB más allá de la que ya existía)
```

**Corrección explícita conservada de la tarea que autorizó este reemplazo (no debe contradecirse en el futuro):** `FIREBASE_POPUP_CLOSED_POLLING_ABSENT = FALSE` — Firebase JS Auth sí tiene lógica de cancelación que puede inspeccionar `popup.closed`; el criterio de aceptación nunca fue la ausencia teórica de esa inspección, sino la fiabilidad empírica del flujo en el entorno real soportado por Korixa.

**Validación humana — preview efímero** (`https://ridepro-development--korixa-firebase-popup-poc-20799-js6fbrd4.web.app`, fingerprint `main.dart.js` SHA-256 `445e61683d256dec81cbb5c021714c4d3f1bed669f14af35549b5beb46c458fc`, local y desplegado idénticos):

```
HUMAN_LOGIN_TO_REGISTER = PASS
HUMAN_REGISTER_TO_LOGIN = PASS
HUMAN_FORGOT_PASSWORD = PASS
HUMAN_GOOGLE_LOGIN_NORMAL_FLOW = PASS
HUMAN_POPUP_CLOSES_AFTER_SUCCESS = PASS
HUMAN_INFINITE_SPINNER = NO
HUMAN_SESSION_CREATED = PASS
HUMAN_LOGOUT_AND_REPEAT_LOGIN = PASS
POPUP_CANCEL_RECOVERY = UNPROVEN (cierre del popup sin elegir cuenta no fue parte de la validación humana reportada — no se infiere)
```

Diagnóstico automatizado previo (no sustituye la aceptación humana, solo la contextualiza): un clic headless contra este mismo preview mostró que el popup de `signInWithPopup` **sí llega a la página real de selección de cuenta de Google** (a diferencia de la arquitectura GIS, que en canales de preview efímeros era rechazada por `origin_mismatch`) — porque el popup apunta al dominio propio de Firebase (`ridepro-development.firebaseapp.com/__/auth/handler`), no al origen del preview. Se observó en consola, dos veces: `Cross-Origin-Opener-Policy policy would block the window.closed call.` — consistente con la corrección `FIREBASE_POPUP_CLOSED_POLLING_ABSENT = FALSE` de esta tarea; un aviso de consola de COOP no equivale por sí solo a una falla funcional, y la validación humana posterior (`HUMAN_GOOGLE_LOGIN_NORMAL_FLOW = PASS`, sin spinner infinito) confirma que el flujo de éxito no se ve afectado.

```
FIREBASE_POPUP_RUNTIME = PASS
ARCHITECTURE_OPTION_A = ACCEPTED
```

**Tests:** `flutter analyze` 12 issues preexistentes no relacionadas (0 nuevas), `flutter test test/features/auth/` 136/136 (incluye 6 tests nuevos en `test/features/auth/data/datasources/auth_remote_datasource_test.dart` que prueban que la rama Web llama a `signInWithPopup` y nunca a `GoogleSignIn().signIn()`, y viceversa en nativo), `flutter test` completo 531 passed / 5 skipped / 0 failed, `flutter build web --release -t lib/main_development.dart` exitoso, `git diff --check` limpio.

**Validación Development ESTABLE — deploy ejecutado (KORIXA-WEB-GOOGLE-FIREBASE-POPUP-HUMAN-ACCEPTANCE-AND-STABLE-DEV-GATE-20260908):** con autorización explícita de esa tarea (alcance limitado a Hosting de Development, sin tocar Production/OAuth/IAM/Secret Manager/backend/Firestore rules), se ejecutó `firebase deploy --only hosting --project ridepro-development` con el build exacto ya fingerprint-verificado arriba. **Identidad de build, verificada por hash:** `LOCAL_MAIN_DART_JS_SHA256 = 445e61683d256dec81cbb5c021714c4d3f1bed669f14af35549b5beb46c458fc`, `STABLE_DEV_MAIN_DART_JS_SHA256 = 445e61683d256dec81cbb5c021714c4d3f1bed669f14af35549b5beb46c458fc` (descargado directamente de `https://ridepro-development.web.app/main.dart.js` tras el deploy) — **idénticos, `STABLE_DEV_BUILD_MATCH = YES`.** Esto reemplaza el build GIS que §9 había sincronizado en ese mismo dominio — `https://ridepro-development.web.app` ahora sirve la arquitectura `signInWithPopup`, no GIS. Service worker verificado en el dominio estable: `https://ridepro-development.web.app/flutter_service_worker.js` = 815 bytes, cero ocurrencias de `CACHE_NAME`, con `skipWaiting`/`unregister`/`navigate` presentes — mismo stub autodesregistrante esperado, ya no el worker de cacheo persistente heredado. Verificación estructural repetida sobre este mismo dominio estable (Playwright): `HTML_PLATFORM_VIEW_COUNT_LOGIN = 0`, `HTML_PLATFORM_VIEW_COUNT_REGISTER = 0`.

**Aceptación humana real sobre Development ESTABLE (KORIXA-WEB-GOOGLE-FIREBASE-POPUP-FINALIZE-PR-GATE-20260908):** completada contra `https://ridepro-development.web.app` (no el preview efímero):

```
STABLE_LOGIN_TO_REGISTER = PASS
STABLE_REGISTER_TO_LOGIN = PASS
STABLE_FORGOT_PASSWORD = PASS
STABLE_GOOGLE_LOGIN = PASS
STABLE_SESSION_CREATED = YES
STABLE_INFINITE_SPINNER = NO
STABLE_REPEAT_LOGIN = PASS
STABLE_POPUP_CANCEL_RECOVERY = PASS
```

Con esta evidencia, a diferencia de la ronda de preview (§12, más arriba), `POPUP_CANCEL_RECOVERY` queda **PASS** sobre Development estable — cerrar el popup sin elegir cuenta sí fue parte de esta validación y la UI de Korixa se recuperó correctamente (no quedó en loading colgado). Con esto:

```
FIREBASE_POPUP_RUNTIME = PASS
STABLE_DEVELOPMENT_ACCEPTANCE = PASS
ARCHITECTURE_OPTION_A = ACCEPTED
AUTH_WEB_GOOGLE_FLOW = VALIDATED_IN_DEVELOPMENT
HTML_PLATFORM_VIEW_REMEDIATION = PASS
```

**Alcance explícito de esta validación:** cubre Development (preview efímero + Development estable). **Production no fue tocado ni validado en ningún momento de todo este hilo — `AUTH_WEB_GOOGLE_FLOW` se clasifica `VALIDATED_IN_DEVELOPMENT`, nunca `VALIDATED_IN_PRODUCTION`.** Cualquier despliegue a Production requiere una autorización y un gate explícitos y separados, no cubiertos por ninguna tarea de este hilo.

Cero mutaciones de Production, IAM, Secret Manager, OAuth, backend, Firestore rules o base de datos en todo este hilo (§1-§12). Con Development estable ahora aceptado por un humano, este bloque procede a consolidar la documentación final, ejecutar la validación completa, y preparar un commit/PR — sin fusionar sin autorización explícita adicional.
