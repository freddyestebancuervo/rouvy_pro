# Guía de activación — Integraciones de wearables

Apple Health y Google Fit ya funcionan de verdad (nada que hacer). Esta
guía cubre **cómo sustituir cada adapter simulado por la integración real**
cuando obtengas acceso oficial de Garmin, Polar, Coros o Suunto — sin tocar
el dominio ni la presentación, según la arquitectura descrita en
`ARCHITECTURE_DECISIONS.md`.

## Apple Health / Google Fit — permisos nativos ya configurados

- **iOS:** `NSHealthShareUsageDescription`/`NSHealthUpdateUsageDescription`
  ya están en `ios/Runner/Info.plist`. Falta únicamente añadir la
  capability **HealthKit** en Xcode (Runner → Signing & Capabilities → +
  Capability → HealthKit) — no se puede hacer desde archivo de texto, solo
  desde Xcode.
- **Android:** los permisos de Health Connect ya están en
  `android/app/src/main/AndroidManifest.xml`. Requiere que el usuario
  tenga la app **Health Connect** instalada (en Android 14+ viene
  preinstalada; en versiones anteriores hay que instalarla desde Play
  Store — la query `com.google.android.apps.healthdata` en el manifest
  permite a la app detectar si está presente).

## Patrón general de activación (aplica a los 4 proveedores)

1. Crear `lib/features/wearables/data/adapters/<proveedor>_adapter_impl.dart`
   implementando `WearableAdapter` (la misma interfaz que ya cumple el mock).
2. En `lib/core/di/injection.dart`, dentro del `Map<WearableProviderType, WearableAdapter>`,
   reemplazar la línea del mock:
   ```dart
   WearableProviderType.garmin: GarminAdapter(), // ← reemplazar esto
   ```
   por la implementación real:
   ```dart
   WearableProviderType.garmin: GarminAdapterImpl(httpClient: sl(), secureStorage: sl()),
   ```
3. Nada más cambia — `WearableRepositoryImpl`, los casos de uso, los
   providers de Riverpod y `WearablesPage` siguen funcionando sin
   modificación porque todos programan contra `WearableAdapter`, no contra
   la clase concreta.

---

## Garmin

**Acceso:** [Garmin Connect Developer Program](https://developer.garmin.com/gc-developer-program/)
— solicitud con caso de uso descrito, aprobación manual (puede tardar
semanas).

**Particularidades técnicas:**
- **OAuth 1.0a**, no 2.0 — a diferencia del resto de proveedores de esta
  lista. Requiere firmar cada request con HMAC-SHA1.
- Garmin funciona principalmente por **push**, no por pull: no hay un
  endpoint tradicional de "dame el historial completo" — el usuario
  autoriza la app, y Garmin empuja un webhook a un **servidor propio**
  cada vez que su reloj sincroniza una actividad nueva.
- Por el punto anterior, esta integración **no puede ser 100%
  cliente-only** como Apple Health/Google Fit: además de `GarminAdapterImpl`
  en Flutter, hace falta un backend (el `wearable-sync-service` descrito
  en el documento de arquitectura del backend) que reciba el webhook, lo
  normalice a `ExternalActivity`, y lo exponga a la app vía tu propia API.
- Documentación: `https://developer.garmin.com/gc-developer-program/health-api/`

---

## Polar

**Acceso:** [Polar AccessLink API](https://www.polar.com/accesslink-api/) —
registro de aplicación, aprobación generalmente más rápida que Garmin.

**Particularidades técnicas:**
- **OAuth2 estándar** — el flujo es directamente análogo al ya usado en
  `AuthRemoteDataSource` para Google/Apple (solo cambian los endpoints de
  authorization/token).
- AccessLink SÍ soporta **pull** bajo demanda vía REST (`GET /v3/users/{user-id}/exercise-transactions`
  y similares) — no es estrictamente necesario un backend propio para el
  caso de uso básico de "importar historial reciente", a diferencia de
  Garmin.
- Documentación: `https://www.polar.com/accesslink-api/#polar-accesslink-api`

---

## Coros

**Acceso:** Coros Open API — programa más reciente que Garmin/Polar;
solicitar acceso directamente al equipo de soporte de Coros.

**Particularidades técnicas:**
- OAuth2 estándar, similar a Polar.
- Cobertura de dispositivos más limitada — algunos modelos antiguos de
  Coros pueden no estar cubiertos por la API pública.
- La documentación pública es más limitada que la de Garmin/Polar: al
  recibir acceso, validar con el equipo de soporte de Coros el formato
  EXACTO de la respuesta de actividades antes de dar por buena la
  traducción a `ExternalActivity` en `CorosAdapterImpl`.

---

## Suunto

**Acceso:** evaluar entre la Suunto App API directa (acceso más
restringido, documentación menos madura) o la integración indirecta vía
**Sports-Tracker** (plataforma que Suunto usa para parte de su
ecosistema) — la decisión depende de qué vía de acceso se consiga
primero.

**Particularidades técnicas:**
- De las 4 integraciones pendientes, esta es la de **mayor incertidumbre
  de alcance**. No asumir que el patrón OAuth2 + REST del resto aplica
  igual aquí sin confirmarlo primero con la documentación que Suunto
  entregue al aprobar el acceso.
- Actualizar esta sección con la decisión final (API directa vs.
  Sports-Tracker) en cuanto se resuelva, para que quede como referencia de
  por qué se tomó ese camino.

---

## Checklist al activar cualquiera de los 4

- [ ] Adapter real creado en `data/adapters/`, implementando `WearableAdapter`
- [ ] Credenciales (client ID/secret, o lo que aplique) añadidas como
      variables de entorno/configuración — **nunca hardcodeadas** en el
      adapter (mismo criterio que `SocialLoginConfig` en el módulo de auth)
- [ ] Línea correspondiente reemplazada en `core/di/injection.dart`
- [ ] Si el proveedor requiere backend propio (caso Garmin): servicio de
      recepción de webhooks desplegado y su URL registrada ante el
      fabricante
- [ ] Probado el flujo completo: conectar → ver `WearableConnectionStatus.connected`
      real (no `pendingPartnerApproval`) → importar actividades → verificar
      que ya NO llevan el prefijo `MOCK-`
- [ ] Actualizada la tabla de la sección 2 de `ARCHITECTURE_DECISIONS.md`
      marcando el proveedor como ✅ Real
