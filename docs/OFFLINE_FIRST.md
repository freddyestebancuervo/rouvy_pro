# Comportamiento Offline-First

Implementa la tarea A1 del `ROADMAP_M0_M1.md`. Este documento describe
**qué hace la app sin conexión**, qué parte es automática (SDK de
Firestore) y qué parte se construyó explícitamente (`core/sync/`), y cómo
verificarlo manualmente — no hay forma de automatizar una prueba real de
"sin red" en este entorno sin un emulador de Firestore y una app corriendo
en un dispositivo, así que la verificación es un protocolo manual
documentado, no un script.

---

## 1. Qué es automático (Firestore `persistenceEnabled`)

Activado en `main.dart`, antes de cualquier otro uso de Firestore:

```dart
FirebaseFirestore.instance.settings = const Settings(
  persistenceEnabled: true,
  cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
);
```

Con esto, el SDK nativo de Firestore (no código propio de este proyecto):

- **Lecturas** (`recentSessions`, `getCurrentUser`...) se sirven desde una
  caché en disco cuando no hay red — la app no muestra un error ni una
  pantalla vacía, muestra los últimos datos conocidos.
- **Escrituras** (`saveSession`, `updateProfile`) se aplican de inmediato
  a la caché local; el `Future` de la operación se resuelve como
  **exitoso en cuanto queda encolada localmente**, sin esperar al
  servidor. Esto es intencional por diseño del SDK — es lo que permite
  que `SessionSummaryPage` muestre "Guardado ✓" incluso sin conexión, sin
  ningún `try/catch` especial para el caso offline en
  `RideSessionRepositoryImpl` (ver el test
  `ride_session_repository_offline_test.dart`, que documenta exactamente
  esta semántica).
- **Sincronización de vuelta:** cuando la conexión regresa, el SDK
  reenvía solo, en orden, todas las escrituras que quedaron en cola —
  ningún código de este proyecto dispara ese reenvío, es responsabilidad
  interna del SDK.

## 2. Qué se construyó explícitamente (`core/sync/`)

La persistencia nativa resuelve el caso de uso, pero no expone ningún
estado observable de "¿ya terminó de sincronizar?". Para eso:

- **`NetworkInfo.onConnectivityChanged`** (ampliación de un puerto ya
  existente) — stream en vivo de conectividad, vía `connectivity_plus`.
- **`FirestoreSyncService`** — combina ese stream con
  `FirebaseFirestore.waitForPendingWrites()` (API real del SDK que
  resuelve exactamente cuando ya no quedan escrituras locales por
  confirmar) para producir un `SyncStatus`:
  `online` → `offline` → `syncingPendingWrites` → `online`.
- **`ConnectivitySyncBanner`** — banner global (montado una sola vez en
  `RideProApp`, no por pantalla) que muestra el estado al usuario. En
  `online` no ocupa espacio; en `offline` informa que los cambios se
  guardarán igual; en `syncingPendingWrites` (transitorio, normalmente
  segundos) muestra un spinner discreto.

```
[sin red]          [conexión vuelve]           [confirmado]
   │                      │                          │
   ▼                      ▼                          ▼
 offline ──────────► syncingPendingWrites ──────► online
                 (waitForPendingWrites())
```

## 3. Modelo de resolución de conflictos

Firestore aplica **last-write-wins a nivel de documento completo** (no
merge de campos individuales entre dos escrituras concurrentes al mismo
documento desde dispositivos distintos). Por qué esto es aceptable para
cada colección de este proyecto:

- **`users/{uid}`** (perfil): en la práctica, un usuario edita su perfil
  desde un solo dispositivo a la vez en la inmensa mayoría de los casos.
  Si editara desde dos dispositivos offline simultáneamente (caso raro),
  la última escritura en sincronizar gana — pérdida de datos aceptable
  para este campo, comunicado como riesgo conocido, no oculto.
- **`ride_sessions/{sessionId}`** (historial): son documentos
  **append-only** (`saveSession` siempre crea uno nuevo con `.add()`,
  nunca edita uno existente) — no hay posibilidad de conflicto porque no
  hay escritura concurrente al MISMO documento. Este es el motivo de
  diseño real detrás de usar `.add()` en vez de un ID determinista: evita
  la categoría entera de conflictos para esta colección.

## 4. Protocolo de verificación manual

No automatizable sin un dispositivo real + emulador de Firestore (fuera
del alcance de este entorno). Pasos para el equipo, antes de dar por
buena cualquier release que toque `core/sync/` o los repositorios de
Firestore:

1. Abrir la app con conexión, iniciar sesión, dejarla en Home.
2. Activar **Modo avión**.
3. Verificar: aparece el banner "Sin conexión — tus cambios se guardarán
   y sincronizarán automáticamente."
4. Ir a Perfil, editar el nombre, guardar → debe verse como exitoso
   (sin error), a pesar de no haber red.
5. Iniciar un entrenamiento libre (`/training`), finalizarlo → en
   `SessionSummaryPage`, el ícono de guardado debe mostrar `cloud_off`
   (esperado: no puede confirmar sincronización mientras sigue offline,
   pero NO debe mostrar ningún diálogo de error bloqueante).
6. Desactivar Modo avión.
7. Verificar: el banner cambia brevemente a "Sincronizando cambios
   pendientes…" y luego desaparece.
8. Cerrar la app por completo y volver a abrirla con conexión → el
   nombre editado en el paso 4 y la sesión del paso 5 deben aparecer
   (confirma que realmente llegaron al servidor, no solo a la caché
   local del dispositivo de prueba).
9. Repetir el ciclo completo en un segundo dispositivo/emulador con la
   MISMA cuenta para observar el caso de last-write-wins descrito en la
   sección 3 (opcional, solo si se sospecha un problema de conflictos).

## 5. Cobertura automatizada existente

Lo que SÍ se testea sin depender de red/emulador real:

- `test/core/network/network_info_test.dart` — mapeo correcto de
  `connectivity_plus` a `bool`.
- `test/core/sync/firestore_sync_service_test.dart` — las 4 transiciones
  de `SyncStatus`, incluyendo el caso de fallo de
  `waitForPendingWrites()` sin dejar el servicio en un estado colgado.
- `test/features/training/data/repositories/ride_session_repository_offline_test.dart`
  — documenta y verifica la semántica de escritura optimista (una
  escritura que "no lanza" se trata como éxito, sea que haya sido online
  u offline — el código no puede ni necesita distinguirlo) y que los
  errores genuinos (permisos, sesión inexistente) sí se siguen
  propagando como `Failure`.

Lo que NO se testea automáticamente (limitación reconocida, no oculta):
persistencia real en disco entre reinicios de la app, y el comportamiento
exacto de last-write-wins ante conflictos reales de dos clientes —
requieren el protocolo manual de la sección 4 o, como mejora futura,
integrar el emulador de Firestore en un pipeline de CI con dispositivos
reales/simulados.
