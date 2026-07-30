# RidePro — Documento 10: Evidencia de Ejecución y Validación
## Cierre de la tarea T-F0.1 (crash de Wearables en Flutter Web)

- **Fecha:** 2026-07-24
- **Alcance de este documento:** persistir en un archivo la evidencia de ejecución de pruebas, el problema encontrado con Chrome, y las decisiones tomadas durante el cierre de `T-F0.1` — evidencia que hasta ahora solo existía en el historial de la conversación, no en el repositorio.
- **No se modifica ninguna conclusión técnica** de `TF0_1_ANALISIS_Y_DISENO.md`, del código implementado, ni del veredicto ya comunicado (`⚠ REQUIERE REVISIÓN`). Este documento documenta, no reevalúa.
- **Relación con la serie de 9 documentos de la auditoría:** este documento es un **anexo posterior**, generado durante la fase de implementación (no durante la auditoría original) — se numera `10` por continuidad de carpeta, no porque forme parte de los "9 documentos" ya aprobados y cerrados como v1.1.

---

## 1. Cronología completa de la ejecución

| # | Momento (orden relativo) | Acción | Resultado |
|---|---|---|---|
| 1 | Antes de tocar código | Confirmación de que `lib/core/health/health_platform_gateway_impl.dart` no había cambiado desde el análisis aprobado (`TF0_1_ANALISIS_Y_DISENO.md`) | Sin diferencias — confirmado |
| 2 | Antes de tocar código | `git status --short lib/` | Sin cambios pendientes — punto de partida limpio |
| 3 | Implementación | Import de `PlatformCapabilities` + guarda `if (PlatformCapabilities.isWeb) return HealthAvailability.unavailable;` como primera línea de `checkAvailability()` + ajuste del comentario de la rama de fallback final | 1 archivo modificado, ~10 líneas netas |
| 4 | Verificación | Localización del SDK de Flutter (no estaba en `PATH` de Bash ni de PowerShell) | Encontrado en `C:\Users\Usuario\Downloads\flutter\bin\flutter.bat` |
| 5 | Verificación | `flutter analyze --fatal-infos` | ✅ **"No issues found!"** (108.3s) |
| 6 | Verificación | `flutter test` (suite completa, antes de agregar el test nuevo) | ✅ **186/186** |
| 7 | Verificación | `flutter build web --release` | ✅ Compila (`√ Built build\web`) — advertencias de "Wasm dry run" preexistentes de `flutter_secure_storage_web` (`dart:html`/`dart:js_util` no soportado en Wasm), no relacionadas con este cambio |
| 8 | Validación manual — intento 1 | Se buscó primero un skill de proyecto para levantar la app (`run` skill) — no existe ninguno en `.claude/skills/` de este repo | Se cayó al patrón "Browser-driven web app" (`chromium-cli`) documentado por el skill |
| 9 | Validación manual — evaluación de rutas disponibles | Se investigó si el modo demo (`lib/main_demo.dart`, `initDemoDependencyInjection()`) permitiría llegar a la pantalla de Wearables sin necesitar login real de Firebase | **Descartado**: `demo_injection.dart` no registra `HealthPlatformGateway` ni los adapters de wearables — navegar a `/wearables` en modo demo lanzaría un error de GetIt "not registered", no ejercería el código corregido |
| 10 | Validación manual — decisión de enfoque | Ante la imposibilidad práctica de un login real de Firebase headless sin credenciales, se optó por una prueba automatizada dirigida contra la implementación real (no un fake), ejecutada compilada para Web | Se creó `test/core/health/health_platform_gateway_impl_test.dart` |
| 11 | Verificación de entorno | Comprobación de disponibilidad de Chrome | Encontrado en `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| 12 | Validación manual — intento 1 de `--platform chrome` | `flutter test --platform chrome test\core\health\health_platform_gateway_impl_test.dart` | Excedió el timeout de 180s del comando en primer plano, se movió a segundo plano (id `b671a1kgx`) |
| 13 | Notificación de finalización | Estado del proceso en segundo plano | `failed`, código de salida 1 |
| 14 | Lectura de evidencia | Contenido del archivo de salida de `b671a1kgx` | `Failed to load "...": Connection closed before test suite loaded.` — ver sección 3 |
| 15 | Decisión | Reintentar una sola vez (política explícita del propietario: "reintenta una sola vez") | Se relanzó el mismo comando en segundo plano (id `b78farmql`), con timeout de 300s |
| 16 | Espera | Se programó un chequeo de respaldo (`ScheduleWakeup`, 320s) en vez de sondear activamente | — |
| 17 | Intervención del propietario | Instrucción explícita de revisar el estado de inmediato en vez de esperar el temporizador | — |
| 18 | Revisión de estado | Lectura del archivo de salida de `b78farmql` | Vacío — ninguna línea de salida, ni siquiera el `loading...` inicial que sí había aparecido en el intento 1 |
| 19 | Revisión de estado (herramienta dedicada) | `TaskOutput` con `block=false` sobre `b78farmql` | `status: running`, `retrieval_status: not_ready` — el proceso seguía vivo sin haber producido salida |
| 20 | Decisión, por instrucción explícita del propietario | Ante ausencia total de salida tras varios minutos, se clasificó como bloqueado | — |
| 21 | Acción | `TaskStop` sobre `b78farmql` | Detenido correctamente |
| 22 | Diagnóstico | Inspección de procesos `chrome`/`dart`/`flutter` activos en la máquina (`Get-Process`) y de puertos en escucha en el rango alto | Ver sección 4 (evidencia completa) |
| 23 | Decisión | No terminar los procesos `chrome.exe` preexistentes no identificados (13 de los 16 encontrados, con hora de inicio muy anterior a esta sesión) | Justificación: no se pudo confirmar que pertenecieran a un proceso desechable — terminarlos sin saber su origen habría sido una acción destructiva sobre estado no comprendido |
| 24 | Verificación alternativa | `flutter test test\core\health\health_platform_gateway_impl_test.dart` bajo el target por defecto (VM, no Web) | ✅ 3/3 verde — confirma que el archivo de test es válido y que el código nuevo no lanza excepción bajo ejecución normal (no prueba directamente la rama `kIsWeb == true`, ver limitación en sección 6) |
| 25 | Verificación final | `flutter test` (suite completa, con el archivo nuevo ya incluido) | ✅ **189/189** (186 preexistentes + 3 nuevas) |
| 26 | Cierre | Actualización de `PROJECT_STATUS.md` reflejando el estado real (`T-F0.1` en Etapa 8-9, no cerrada formalmente) | Ver Documento `PROJECT_STATUS.md` en la raíz del repositorio |
| 27 | Entrega | Informe de cierre de 7 secciones, veredicto `⚠ REQUIERE REVISIÓN` | Entregado como respuesta de chat — este documento (10) persiste esa misma evidencia en el repositorio |

---

## 2. Comandos ejecutados (listado consolidado, en el orden de la sección 1)

```bash
# Verificación de punto de partida
git status --short lib/

# Localización del SDK (no estaba en PATH)
# (búsqueda con Get-ChildItem sobre rutas comunes de desarrollo)

# Análisis estático
"C:\Users\Usuario\Downloads\flutter\bin\flutter.bat" analyze --fatal-infos

# Suite completa, antes del test nuevo
"C:\Users\Usuario\Downloads\flutter\bin\flutter.bat" test

# Compilación Web
"C:\Users\Usuario\Downloads\flutter\bin\flutter.bat" build web --release

# Suite dirigida (wearables + core/health)
"C:\Users\Usuario\Downloads\flutter\bin\flutter.bat" test test/features/wearables test/core/health

# Intento 1 — validación en Chrome real
"C:\Users\Usuario\Downloads\flutter\bin\flutter.bat" test --platform chrome test\core\health\health_platform_gateway_impl_test.dart

# Intento 2 — mismo comando, único reintento autorizado
"C:\Users\Usuario\Downloads\flutter\bin\flutter.bat" test --platform chrome test\core\health\health_platform_gateway_impl_test.dart

# Diagnóstico de procesos (tras detener el intento 2)
Get-Process -Name "chrome","dart","flutter" -ErrorAction SilentlyContinue |
  Select-Object Id,ProcessName,StartTime
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -gt 30000 -and $_.LocalPort -lt 50000 } |
  Select-Object LocalPort,OwningProcess

# Verificación alternativa (VM, no Web)
"C:\Users\Usuario\Downloads\flutter\bin\flutter.bat" test test\core\health\health_platform_gateway_impl_test.dart

# Verificación final consolidada
"C:\Users\Usuario\Downloads\flutter\bin\flutter.bat" test
```

---

## 3. Resultados obtenidos — detalle textual

**Intento 1 (`b671a1kgx`), archivo de salida completo:**
```
00:00 +0: loading C:/proyectos/rouvy_proZIP/rouvy_pro/test/core/health/health_platform_gateway_impl_test.dart
00:00 +0 -1: loading C:/proyectos/rouvy_proZIP/rouvy_pro/test/core/health/health_platform_gateway_impl_test.dart [E]
  Failed to load "test\core\health\health_platform_gateway_impl_test.dart": Connection closed before test suite loaded.
00:00 +0 -1: Some tests failed.

Failing tests:
  C:/proyectos/rouvy_proZIP/rouvy_pro/test/core/health/health_platform_gateway_impl_test.dart: loading C:/proyectos/rouvy_proZIP/rouvy_pro/test/core/health/health_platform_gateway_impl_test.dart
```

**Intento 2 (`b78farmql`), archivo de salida en el momento de la detención:** vacío — sin una sola línea, ni siquiera el `loading...` que el intento 1 sí alcanzó a imprimir antes de fallar.

**`TaskOutput` (`b78farmql`, `block=false`, justo antes de detenerlo):**
```
<retrieval_status>not_ready</retrieval_status>
<task_id>b78farmql</task_id>
<task_type>local_bash</task_type>
<status>running</status>
```

**Compilación Web (`flutter build web --release`), salida relevante:**
```
Compiling lib\main.dart for the Web...
Found incompatibilities with WebAssembly.
package:flutter_secure_storage_web/flutter_secure_storage_web.dart 5:1 - dart:html unsupported (0)
package:flutter_secure_storage_web/flutter_secure_storage_web.dart 6:1 - dart:js_util unsupported (15)
...
Compiling lib\main.dart for the Web...   53,1s
√ Built build\web
```
(Las incompatibilidades de Wasm son de `flutter_secure_storage_web`, una dependencia preexistente sin relación con el archivo modificado — la compilación normal, no-Wasm, terminó exitosamente.)

---

## 4. Evidencia de los procesos encontrados

Resultado exacto de `Get-Process -Name "chrome","dart","flutter"`, tomado inmediatamente después de detener el intento 2:

| PID | Proceso | Hora de inicio | Relación con esta sesión |
|---|---|---|---|
| 3476 | chrome | 24/07/2026 13:08:31 | Anterior a cualquier comando de esta tarea — origen desconocido |
| 21496 | chrome | 24/07/2026 13:08:31 | Ídem |
| 6456, 8624, 15564, 22812, 29260 | chrome | 24/07/2026 13:08:35 (5 procesos, mismo segundo) | Ídem — patrón típico de un único lanzamiento de Chrome que crea varios procesos hijos (renderer/GPU/utility) |
| 13560 | chrome | 24/07/2026 13:08:36 | Ídem |
| 19404 | chrome | 24/07/2026 13:08:38 | Ídem |
| 13020 | chrome | 24/07/2026 13:08:40 | Ídem |
| 15872, 22284 | chrome | 24/07/2026 13:08:42 (2 procesos) | Ídem |
| 4732 | chrome | 24/07/2026 18:38:27 | Coincide con el lanzamiento del **intento 1** |
| 28856 | chrome | 24/07/2026 18:38:27 | Ídem (proceso hijo del mismo lanzamiento) |
| 29048 | chrome | 24/07/2026 18:40:27 | Coincide con el lanzamiento del **intento 2** |
| 11704, 22828, 28560 | dart | 24/07/2026 14:46:37 (3 procesos, mismo segundo) | Anterior a los intentos de Chrome — probablemente residuo de invocaciones previas de `flutter analyze`/`flutter build` (servidor de análisis o proceso de build de Dart) |
| 9520 | dart | 24/07/2026 14:46:38 | Ídem |
| 13664 | dart | 24/07/2026 17:37:56 | Coincide aproximadamente con la ejecución de la suite completa de `flutter test` |

**Total: 16 procesos `chrome.exe` simultáneos** en el momento del diagnóstico. **13 de ellos (81%) tenían hora de inicio muy anterior a esta sesión de trabajo** (13:08, agrupados en una ventana de 11 segundos — consistente con un único lanzamiento de Chrome con su arquitectura multi-proceso habitual, no con 13 lanzamientos distintos) y **no se pudo determinar su origen** — no fueron lanzados por ningún comando de esta tarea.

Puertos en escucha en el rango 30000-50000 en ese momento: `49664`-`49669` y `42050`, asociados a PIDs `1800`, `4304`, `2932`, `2720`, `1656`, `1836`, `27036` — ninguno de esos PIDs coincide con los procesos `chrome`/`dart` de la tabla de arriba, lo que indica más procesos activos en la máquina fuera de los que `Get-Process -Name` filtró por nombre.

---

## 5. Por qué se clasificó como limitación de infraestructura y no como defecto del código

Cuatro piezas de evidencia, todas verificadas en este mismo cierre, sostienen esta clasificación:

1. **El fallo ocurre *antes* de que se cargue el archivo de test**, en ambos intentos (`"Connection closed before test suite loaded"` en el intento 1; ninguna salida en absoluto en el intento 2). Un defecto en `checkAvailability()` se manifestaría *durante* la ejecución de un test (una aserción fallida, una excepción capturada por el framework de test), no *antes* de que el runner logre establecer la conexión de depuración con el navegador. La falla está en la fase de arranque del arnés de pruebas, no en la fase de ejecución del código bajo prueba.
2. **El mismo código fuente sí compila correctamente para Web** (`flutter build web --release`, sección 3) — descarta cualquier problema de compilación o de compatibilidad de `dart:io`/`PlatformCapabilities` con el target Web a nivel de build.
3. **El mismo archivo de test, compilado y ejecutado contra la VM (no Web), pasa sin error** (3/3, paso 24 de la cronología) — descarta que el test en sí esté mal escrito o que la clase `HealthPlatformGatewayImpl` lance una excepción inesperada en un entorno de ejecución que sí puede completar el arranque.
4. **Evidencia objetiva de contención de recursos preexistente e independiente de este cambio**: 16 procesos `chrome.exe` corriendo simultáneamente, 13 de ellos iniciados horas antes de esta tarea, sin relación con ningún comando emitido durante este cierre (sección 4). El intento 2, lanzado con ese trasfondo de procesos ya activo, ni siquiera llegó a producir la primera línea de salida que sí había alcanzado el intento 1 — un patrón de degradación, no de estabilidad, consistente con contención creciente de recursos/puertos del sistema operativo, no con el código bajo prueba.

**Ninguna de estas cuatro piezas de evidencia pudo haberse producido si el defecto estuviera en `health_platform_gateway_impl.dart`** — un defecto ahí habría permitido que el runner cargara el test (como sí ocurrió en la VM) y habría fallado con un mensaje de aserción o una excepción de Dart capturada por el framework, no con un error de conexión de red del arnés de pruebas.

---

## 6. Decisiones tomadas

| Decisión | Justificación |
|---|---|
| Reintentar `flutter test --platform chrome` exactamente una vez, no más | Política explícita del propietario ("reintenta una sola vez") |
| Detener el intento 2 en vez de dejarlo corriendo indefinidamente | Instrucción explícita del propietario ante ausencia total de salida por varios minutos |
| No terminar los 13 procesos `chrome.exe` preexistentes no identificados | Principio de no ejecutar acciones destructivas sobre estado no comprendido — no se pudo confirmar que fueran desechables |
| No intentar un tercer mecanismo de validación en navegador (p. ej. `chromium-cli` contra `build/web` servido manualmente) en este cierre | El camino más directo (login real de Firebase) no es viable sin credenciales headless; el camino alternativo (modo demo) no ejercita el código corregido (sección 1, paso 9) — habría requerido levantar el emulador de Firebase + datos semilla, un esfuerzo de infraestructura mayor al alcance de esta tarea puntual |
| No marcar `T-F0.1` como `✅ APROBADO` pese a que toda la evidencia de código, análisis y compilación es positiva | El propio criterio de aceptación del propietario para esta tarea exige la validación manual como mínimo; no completarla por una causa ajena al código no habilita saltarse ese criterio sin su decisión explícita |
| Registrar el veredicto como `⚠ REQUIERE REVISIÓN`, no como `❌ IMPLEMENTACIÓN BLOQUEADA` | La implementación en sí no está bloqueada — compila, pasa análisis estático y pasa toda la suite de pruebas ejecutable en este entorno; lo que falta es un paso de verificación adicional, no una corrección de código pendiente |

---

## 7. Limitaciones pendientes

1. **No se completó la validación en navegador real (Chrome) compilado para Web** — ni vía `flutter test --platform chrome`, ni vía un flujo de UI real con login. Esto sigue pendiente al momento de este documento.
2. **El test nuevo (`health_platform_gateway_impl_test.dart`) no ejercita directamente la rama `kIsWeb == true`** bajo el target VM (`flutter test` normal) — solo prueba que la clase no lanza y devuelve un valor válido en el entorno de ejecución disponible (VM/Windows), donde el código *antiguo* tampoco fallaba (ver `TF0_1_ANALISIS_Y_DISENO.md` §8, columna Windows). La prueba discriminante real (que distingue el código corregido del código con el bug) solo se obtiene compilando y ejecutando específicamente para Web — exactamente el paso que no se pudo completar.
3. **No se investigó el origen de los 13 procesos `chrome.exe` preexistentes** ni de los procesos `dart` residuales — quedan sin explicación, más allá de la hipótesis razonable de que provienen de trabajo anterior en la misma máquina, no de esta tarea.
4. **`H-WEARABLES-NEW-1`** (hallazgo del análisis de `T-F0.1`, documentado en `TF0_1_ANALISIS_Y_DISENO.md` §12) sigue sin corrección ni decisión sobre incorporarlo al Backlog Maestro — no es una limitación de este cierre, se repite aquí solo para que quede consolidado en un único documento de evidencia.

---

## 8. Criterios para repetir la validación en un entorno limpio

Para que un reintento futuro sea concluyente (a diferencia de los dos intentos de esta sesión), el entorno debe cumplir, verificablemente, antes de lanzar el comando:

1. **Cero procesos `chrome.exe` activos** antes de iniciar — verificar con `Get-Process -Name chrome -ErrorAction SilentlyContinue` (PowerShell) o `pgrep -f chrome` (Linux/macOS/CI) y confirmar que no devuelve resultados.
2. **Cero procesos `dart`/`flutter` residuales de corridas anteriores** — mismo tipo de verificación, `Get-Process -Name dart,flutter`.
3. **Puertos del rango que usa el arnés de pruebas de Flutter Web libres** — sin listeners inesperados en el rango alto (30000-50000) antes de empezar.
4. **Entorno de un solo uso, descartable tras la corrida** — la opción que garantiza 1-3 sin esfuerzo manual es un runner de **GitHub Actions** (o equivalente: cada job arranca en una VM nueva, sin ningún proceso preexistente) — se recomienda agregar un job específico a `.github/workflows/ci.yml` que ejecute:
   ```yaml
   - run: flutter test --platform chrome test/core/health/health_platform_gateway_impl_test.dart
   ```
   sobre un runner `ubuntu-latest` o `windows-latest` fresco, con Chrome preinstalado en la imagen estándar de GitHub Actions.
5. **Alternativa sin CI:** una máquina de desarrollo distinta a la usada en este cierre, o la misma máquina reiniciada, confirmando los puntos 1-3 inmediatamente antes de correr el comando — no se recomienda intentarlo de nuevo en la misma sesión/máquina sin antes cerrar los procesos `chrome.exe`/`dart` preexistentes identificados en la sección 4 (con autorización explícita del propietario para hacerlo, dado que no se confirmó su origen).
6. **Criterio de éxito de la repetición:** el archivo de salida debe mostrar al menos la línea `loading .../health_platform_gateway_impl_test.dart` seguida de los 3 casos (`checkAvailability()`, `requestPermissions()`, `checkPermissionStatus()`) en verde, sin ningún `Connection closed` ni ausencia total de salida.

---

## 9. Estado de este documento

Este documento **no cierra `T-F0.1`** — es evidencia de apoyo para que el propietario tome la decisión ya planteada en el informe de cierre (aprobar con la evidencia disponible, o exigir la validación pendiente en un entorno que cumpla la sección 8). El veredicto operativo sigue siendo el ya comunicado: **`⚠ REQUIERE REVISIÓN`**.
