# RidePro — Documento 12: Resultado de los Prerrequisitos de Separación de Firebase
## `.gitignore`, `storage.rules`, y preparación de iOS (Windows)

- **Fecha:** 2026-07-24
- **Rama / HEAD al iniciar:** `feature/d2` / `d3d01d8893b8d9a32b7840de99a100591fb0697b`
- **Autorización:** ejecución de Prerrequisitos 2 y 3 completa; Prerrequisito 1 autorizado solo en la parte realizable en Windows, sin fijar Bundle ID ni generar configuración definitiva de Firebase para iOS — límite respetado, ver sección 3.
- **No se creó ningún proyecto Firebase, no se cambió el proyecto activo, no se hizo `firebase deploy`, no se hizo `git commit`/`push`/`rebase`/`merge`, no se eliminó historial, no se descargó ni generó ninguna clave de cuenta de servicio.**

---

## 1. Estado inicial (Fase 0, reconfirmado)

Sin cambios respecto a lo ya reportado antes de pedir autorización: rama `feature/d2`, HEAD `d3d01d8`, sin nada pendiente relacionado con esta tarea. `ios/Runner.xcodeproj/` no existía. `ios/Runner/GoogleService-Info.plist` y `ios/Runner/Info.plist` eran los únicos 2 archivos de `ios/` trackeados en git.

## 2. Archivos modificados y nuevos (listado completo)

| Archivo | Tipo | Prerrequisito |
|---|---|---|
| `.gitignore` | Modificado | 3 |
| `storage.rules` | Nuevo | 2 |
| `firebase.json` | Modificado (1 clave agregada) | 2 |
| `.metadata` | Modificado (corrección de efecto colateral, ver sección 4.3) | 1 |
| `ios/Runner.xcodeproj/` (proyecto Xcode completo) | Nuevo | 1 |
| `ios/Runner.xcworkspace/` | Nuevo | 1 |
| `ios/Flutter/` (config regenerada) | Nuevo/regenerado | 1 |
| `ios/Runner/AppDelegate.swift` | Nuevo | 1 |
| `ios/Runner/SceneDelegate.swift` | Nuevo | 1 |
| `ios/Runner/Runner-Bridging-Header.h` | Nuevo | 1 |
| `ios/Runner/Assets.xcassets/`, `ios/Runner/Base.lproj/*.storyboard` | Nuevos | 1 |
| `ios/RunnerTests/RunnerTests.swift` | Nuevo (scaffold nativo de Xcode, no ejecutado por `flutter test`) | 1 |
| `ios/.gitignore` | Nuevo (plantilla estándar de Flutter) | 1 |
| `pubspec.lock` | Modificado (solo normalización de fin de línea LF→CRLF, sin cambio de contenido — ver sección 4.4) | 1 (efecto colateral) |
| `test/widget_test.dart` | **Creado y luego eliminado en la misma tarea** (ver sección 4.5) | 1 (efecto colateral corregido) |

**No modificados, verificado explícitamente:** `ios/Runner/GoogleService-Info.plist`, `ios/Runner/Info.plist`, `lib/firebase_options.dart`, `android/app/google-services.json`, `firestore.rules`, `firestore.indexes.json`, `.firebaserc`.

## 3. Diff funcional por archivo

### 3.1 `.gitignore` (Prerrequisito 3)

Se agregaron, al final del bloque de secretos ya existente:
```gitignore
# Firebase Admin / claves de cuenta de servicio (service account) — nunca
# versionar...
*firebase-adminsdk*.json
*service-account*.json
*service_account*.json
serviceAccountKey.json
**/serviceAccountKey.json
**/*firebase-adminsdk*.json

# Certificados y claves privadas...
*.pem
*.p12
*.pfx
**/secrets/
```
Ningún patrón preexistente fue modificado o eliminado. `google-services.json`, `GoogleService-Info.plist`, `firebase_options.dart` **no** están en ningún patrón de exclusión — siguen versionándose, tal como debe ser.

### 3.2 `storage.rules` (nuevo, Prerrequisito 2)

Archivo nuevo, 24 líneas, regla única deny-by-default:
```
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```
Con comentario de cabecera explicando el estado (servicio deshabilitado a propósito, sin consumidor real, criterios para una futura regla por usuario ya anticipados pero no implementados).

### 3.3 `firebase.json` (Prerrequisito 2)

Único cambio: se insertó `"storage":{"rules":"storage.rules"}` entre el bloque `"firestore"` y el bloque `"emulators"` ya existentes. Ninguna otra clave fue tocada.

### 3.4 `.metadata` (corrección de efecto colateral, ver sección 4.3)

`flutter create --platforms=ios .` reemplazó la entrada `platform: android` por `platform: ios` en vez de agregar una entrada nueva. Se corrigió agregando de vuelta la entrada `android` (con los mismos valores de revisión que ya traía, tomados directamente del diff antes de corregir — no inventados), dejando **ambas** plataformas registradas.

### 3.5 iOS — estructura de proyecto nueva

`ios/Runner.xcodeproj/project.pbxproj` y el resto de los archivos nuevos son la salida estándar de `flutter create --platforms=ios .` — sin ninguna edición manual de mi parte, **a propósito**, según lo autorizado (no fijar Bundle ID todavía).

## 4. Comandos ejecutados y resultados completos

### 4.1 Prerrequisito 3
```bash
git ls-files | grep -iE "\.pem$|\.p12$|\.pfx$"          # → vacío, sin trackeados
grep -rn "\.pem" backend/.env.example backend/src         # → solo referencias de config, ningún archivo real
git check-ignore -v ridepro-dbafe-firebase-adminsdk-abc123.json   # → bloqueado por **/*firebase-adminsdk*.json
git check-ignore -v some/nested/path/serviceAccountKey.json       # → bloqueado por **/serviceAccountKey.json
git check-ignore -v my-service-account-key.json                    # → bloqueado por *service-account*.json
git check-ignore -v backend/secrets/jwt_private.pem                # → bloqueado (ver hallazgo 4.2)
git check-ignore -v ios/DistributionCert.p12                       # → bloqueado por *.p12
git check-ignore -v android/app/google-services.json               # → NO bloqueado (correcto)
git check-ignore -v ios/Runner/GoogleService-Info.plist            # → NO bloqueado (correcto)
git check-ignore -v lib/firebase_options.dart                      # → NO bloqueado (correcto)
```
**Resultado: 5/5 patrones de credenciales bloquean correctamente, 3/3 archivos de configuración de cliente siguen sin bloquear.**

### 4.2 Corrección de precisión sobre un hallazgo previo

Al verificar `backend/secrets/jwt_private.pem` con `git check-ignore -v`, el resultado real fue:
```
backend/.gitignore:4:secrets/	backend/secrets/jwt_private.pem
```
Es decir, **ya estaba protegido por un `backend/.gitignore` local** (`node_modules/`, `dist/`, `.env`, `secrets/`, `*.log`, `coverage/`) que no había revisado al escribir el Documento 11 (`11_PLAN_SEPARACION_FIREBASE.md`, hallazgo 4.2). **Corrijo esa imprecisión aquí:** el riesgo real para ese archivo específico era menor de lo que documenté originalmente. La regla nueva (`**/secrets/`, `*.pem` a nivel de raíz) sigue siendo una protección adicional válida y no redundante para cualquier otra ubicación del repositorio donde aparezca un `.pem` o una carpeta `secrets/` sin su propio `.gitignore` local — no se revierte, se mantiene como defensa en profundidad, pero no se atribuye un cierre de riesgo que no era tan grave como se había reportado.

### 4.3 Prerrequisito 2 — validación de sintaxis sin deploy

```bash
node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8')); console.log('JSON valido')"
# → JSON valido

firebase emulators:start --only storage --project demo-ridepro-security-tests   # (con timeout de 25s, sin --deploy, contra el project ID ya establecido como seguro/offline)
# → "All emulators ready! It is now safe to connect your app."
# → Storage emulator arrancó en 127.0.0.1:9199 sin ningún error de compilación de reglas
```
El emulador de Storage **compila las reglas al arrancar** — si `storage.rules` tuviera un error de sintaxis, el arranque habría fallado con un error explícito. Arrancó limpio, confirmando sintaxis válida. **No se ejecutó ningún `firebase deploy`** (ni siquiera `--dry-run`), por respeto estricto a la restricción, aunque esta última hubiera sido inofensiva — se prefirió el camino que no pudiera interpretarse como un deploy bajo ninguna lectura.

Verificado además que el proceso del emulador no quedó corriendo en segundo plano y que no dejó ningún artefacto (log, carpeta de exportación) en el repositorio (`git status --short` limpio de esos elementos).

### 4.4 Prerrequisito 1 (parcial) — generación de estructura iOS

```bash
git ls-files ios/
# → ios/Runner/GoogleService-Info.plist, ios/Runner/Info.plist (los únicos 2 trackeados, antes de continuar)

flutter --version
# → Flutter 3.44.7 • channel stable • Dart 3.12.2

flutter create --platforms=ios .
# → "Wrote 40 files. All done!"

git diff -- ios/Runner/Info.plist ios/Runner/GoogleService-Info.plist
# → vacío — CONFIRMADO: ninguno de los 2 archivos ya trackeados fue tocado

git diff -- .metadata
# → mostró el reemplazo android→ios ya descrito (corregido, sección 3.4)

git diff -- pubspec.lock
# → solo advertencia de fin de línea LF→CRLF, sin diferencia de contenido real

grep -n "PRODUCT_BUNDLE_IDENTIFIER" ios/Runner.xcodeproj/project.pbxproj
# → com.ridepro.app.rouvyPro (valor autogenerado por la herramienta — NO fijado ni confirmado, ver sección 5)
```

### 4.5 Efecto colateral encontrado y corregido: `test/widget_test.dart`

`flutter create` generó `test/widget_test.dart` — la plantilla genérica de Flutter (proyecto "contador"), que importa `MyApp` desde `package:rouvy_pro/main.dart`. Verificado que **esa clase no existe** en este proyecto (`lib/main.dart` define `RideProApp`, no `MyApp`):
```bash
grep -n "class MyApp|RideProApp" lib/main.dart
# → solo "runApp(const ProviderScope(child: RideProApp()));"
```
Ese archivo habría roto la compilación de la suite de tests. Se eliminó (`rm test/widget_test.dart`) por ser un artefacto incidental de esta misma generación, no contenido del proyecto — no se eliminó ningún archivo preexistente de RidePro.

### 4.6 Validaciones finales (tras todos los cambios, incluida la corrección del punto 4.5)

```bash
flutter analyze --fatal-infos
# → "No issues found! (ran in 12.5s)"

flutter test
# → "All tests passed!" — 189/189 (mismo total que al cierre de T-F0.1, confirma que no se perdió ni se rompió ningún test)

grep -RniE "YOUR_FIREBASE_PROJECT_ID|YOUR_|PLACEHOLDER" ios lib/firebase_options.dart
# → mismos placeholders que en la Fase 0 (GoogleService-Info.plist, Info.plist línea 60) — sin cambios,
#   más 2 coincidencias nuevas irrelevantes (atributo XML "placeholder" de Interface Builder en los
#   storyboards recién generados, no son placeholders de configuración)
```

## 5. Valores que requirieron intervención manual — NO inventados, quedan pendientes

| Dato | Estado | Qué falta |
|---|---|---|
| **Bundle ID definitivo de iOS** | 🔴 Sin confirmar. `flutter create` fijó por defecto `com.ridepro.app.rouvyPro` en `project.pbxproj` — **valor NO confirmado, NO es el mismo** que `com.ridepro.app` (el que ya aparece en el placeholder de `GoogleService-Info.plist` y en `backend/.env.example`). Hay ahora dos candidatos distintos, ninguno autoritativo. | Confirmación del propietario: ¿`com.ridepro.app`, `com.ridepro.app.rouvyPro`, u otro? Una vez confirmado, hace falta editar `PRODUCT_BUNDLE_IDENTIFIER` en 6 líneas de `project.pbxproj` (Debug/Release/Profile × Runner/RunnerTests) |
| **Registro de la app iOS en Firebase (`ridepro-dbafe`)** | 🔴 No verificable desde el repositorio | Confirmar en Firebase Console si ya existe, o autorizar que se registre (vía Console manual o `flutterfire configure`, una vez resuelto el Bundle ID) |
| **`GoogleService-Info.plist` real** | 🔴 Sigue siendo el placeholder original, sin tocar | Debe descargarse desde Firebase Console (Configuración del proyecto → Tus apps → iOS) y colocarse en `ios/Runner/GoogleService-Info.plist`, reemplazando el archivo completo |
| **Bloque `ios` en `lib/firebase_options.dart`** | 🔴 No existe — `currentPlatform` sigue lanzando `UnsupportedError` para iOS | Requiere `flutterfire configure --platforms=ios` (o edición manual equivalente) una vez los 3 puntos anteriores estén resueltos |
| **`REVERSED_CLIENT_ID` real en `Info.plist` (Google Sign-In)** | 🔴 Sigue siendo el placeholder (`YOUR_REVERSED_CLIENT_ID`) | Se obtiene del `GoogleService-Info.plist` real una vez descargado (clave `REVERSED_CLIENT_ID`) |

**Detenido exactamente en este punto, tal como pediste** — nada de lo anterior se completó, ni se inventó ningún valor.

## 6. Evidencia consolidada por prerrequisito

- **iOS:** estructura de proyecto Xcode generada y verificable en `ios/Runner.xcodeproj/`; `Info.plist`/`GoogleService-Info.plist` intactos (diff vacío); `flutter analyze`/`flutter test` en verde con la estructura nueva presente.
- **`storage.rules`:** archivo presente, deny-all, sintaxis validada por arranque exitoso del emulador de Storage (sección 4.3), `firebase.json` JSON válido con el bloque `storage` enlazado.
- **`.gitignore`:** 8 patrones nuevos, cada uno verificado individualmente con `git check-ignore -v` contra rutas de ejemplo (sección 4.1), sin falsos positivos sobre configuración de cliente legítima.

## 7. Limitaciones

1. **Build real de iOS no ejecutado ni declarado aprobado** — este entorno es Windows, no macOS. Comando pendiente para cuando exista una máquina macOS:
   ```bash
   flutter build ios --no-codesign
   ```
   (sin flavor, ya que esta tarea no introduce flavors, según lo indicado explícitamente).
2. **`pod install` no ejecutado** — requiere macOS/CocoaPods; `ios/Podfile` fue generado por `flutter create` pero sus dependencias no fueron resueltas ni descargadas.
3. **Bundle ID, registro en Firebase, `GoogleService-Info.plist` real, y bloque `ios` de `firebase_options.dart`** — los 4 puntos de la sección 5, pendientes de información del propietario.
4. **`ios/RunnerTests/RunnerTests.swift`** (scaffold nativo de Xcode) no fue ejecutado ni evaluado — solo corre dentro de Xcode en macOS, fuera del alcance de `flutter test`.

## 8. Rollback

| Cambio | Cómo revertir |
|---|---|
| `.gitignore` | `git diff .gitignore` para ver el bloque agregado; revertir con `git checkout -- .gitignore` (cambios no comiteados) |
| `storage.rules`, bloque `storage` en `firebase.json` | Eliminar `storage.rules`; revertir `firebase.json` con `git checkout -- firebase.json` |
| Estructura iOS completa (`ios/Runner.xcodeproj/`, `ios/Runner.xcworkspace/`, etc.) | Son todos archivos nuevos (no trackeados) — eliminar las carpetas/archivos listados como "Nuevo" en la sección 2 restaura el estado anterior exacto, sin afectar `Info.plist`/`GoogleService-Info.plist` (que nunca cambiaron) |
| `.metadata` | `git checkout -- .metadata` |
| `pubspec.lock` | `git checkout -- pubspec.lock` (solo normalización de fin de línea, sin efecto funcional) |

Ningún cambio de esta tarea toca `firestore.rules`, código de producción no relacionado, ni el proyecto Firebase real — el rollback completo es únicamente operaciones de archivo local, sin ninguna acción remota que deshacer.

---

## 9. Veredicto individual por prerrequisito

### Prerrequisito 1 — Firebase iOS
**⚠ REQUIERE REVISIÓN**
Completado lo realizable en Windows sin inventar datos: estructura de proyecto Xcode generada, `Info.plist`/`GoogleService-Info.plist` verificados intactos, efectos colaterales (`.metadata`, `test/widget_test.dart`) detectados y corregidos. Detenido, tal como se instruyó, antes de fijar el Bundle ID o generar configuración definitiva de Firebase — pendiente de la información listada en la sección 5.

### Prerrequisito 2 — `storage.rules`
**✅ APROBADO**
Regla deny-by-default creada, enlazada correctamente en `firebase.json` (JSON válido verificado), sintaxis validada por arranque exitoso del emulador local, sin ningún deploy. Cumple los 5 principios obligatorios pedidos (deniega todo, sin acceso público, sin asumir funcionalidad futura, sin reglas amplias, servicio bloqueado hasta que exista consumidor y diseño aprobado).

### Prerrequisito 3 — `.gitignore`
**✅ APROBADO**
8 patrones nuevos verificados individualmente con `git check-ignore -v`, sin falsos positivos sobre configuración de cliente legítima, sin ninguna credencial ya trackeada encontrada. Se corrigió una imprecisión del hallazgo original (sección 4.2) en vez de dejarla pasar sin mencionar.

---

## 10. Próximo paso

Este documento no cierra la Fase 1 de separación de entornos — sigue pendiente de tu decisión sobre los 4 puntos de la sección 5 antes de que el Prerrequisito 1 pueda declararse completo. Los Prerrequisitos 2 y 3 están listos sin ninguna acción adicional pendiente.
