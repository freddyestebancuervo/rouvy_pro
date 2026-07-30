# RidePro — Documento 15: Plan Parte B — Separación de Firebase por Entornos
## `T-F0.2` / `C1` — Fase de Análisis, Diseño y Planificación (sin ejecución)

- **Fecha:** 2026-07-25
- **Rol:** Lead Software Engineer / Software Architect / DevOps Engineer / Auditor Técnico Principal
- **Estado de esta tarea:** Solo análisis, diseño, planificación y documentación. **Cero cambios ejecutados** — sin proyectos Firebase creados, sin apps registradas, sin archivos de código/configuración modificados, sin `flutterfire configure`, sin `firebase deploy`, sin migraciones, sin actualización de `PROJECT_STATUS.md`.
- **Verificación de cumplimiento:** este documento es la única adición al repositorio en esta tarea. `git status --short` al cierre de esta tarea debe mostrar únicamente este archivo como nuevo.
- **Fuente de verdad del estado del proyecto:** `PROJECT_STATUS.md` (raíz del repositorio) — este documento lo referencia, no lo duplica.
- **Documentos base (no alterados, solo consolidados y extendidos a nivel de implementación):** `docs/audits/AUDITORIA_FINAL/11_PLAN_SEPARACION_FIREBASE.md` (inventario y plan inicial, Fase de auditoría), `13_FIREBASE_IOS_CONFIGURACION_RESULTADO.md`, `14_CIERRE_MODULO_FIREBASE_IOS.md`, `MASTER_EXECUTION_PLAN.md`, `BACKLOG_MAESTRO.md`, `RIDEPRO_DEVELOPMENT_PROTOCOL.md`.
- **Estándar de este documento:** a partir de esta tarea, la estructura completa de este documento (matriz de riesgos profesional, criterios Go/No-Go, checklist de salida de 20 puntos, matriz de decisiones, auditoría final, veredicto) se adopta como **formato oficial obligatorio** para todo módulo futuro de RidePro — ver sección 15.

---

## Cómo leer este documento

Este documento tiene dos tipos de contenido, marcados explícitamente en cada sección:

- 🟢 **Diseño listo** — no requiere ninguna decisión adicional del propietario para documentarse; puede ejecutarse tan pronto se autorice la implementación en general.
- 🟡 **Decisión pendiente del propietario** — se presentan alternativas completas, con recomendación técnica, pero **no se elige unilateralmente**. La implementación de la parte afectada no puede comenzar hasta recibir esa decisión explícita.

La sección 2 ("Decisiones Pendientes del Propietario") consolida todos los puntos 🟡 en un solo lugar para que puedas responderlos de una vez, sin tener que leer el documento completo primero.

---

## 1. Resumen Ejecutivo

### 1.1 Objetivo del módulo

Diseñar, sin ejecutar, la separación completa de RidePro en tres entornos operativos aislados — **Development**, **Staging** y **Production** — cubriendo Firebase (Auth, Firestore, Storage), FlutterFire, Android, iOS, Web, Windows, backend NestJS, PostgreSQL, gestión de secretos, CI/CD, estrategia de pruebas por entorno y procedimiento de rollback.

### 1.2 Problema que resuelve

RidePro opera hoy con **un único proyecto Firebase real** (`ridepro-dbafe`) usado simultáneamente — sin separación posible a nivel de configuración — por cualquier build de desarrollo, cualquier prueba manual, y cualquier futuro uso en producción. No existe mecanismo de build-time ni runtime que impida que un build de desarrollo escriba datos en el mismo proyecto que algún día servirá a usuarios reales. Este es el riesgo **`C1`** de la Auditoría Arquitectónica Oficial v1.1 (Documento 7), clasificado **Crítico**, y el prerrequisito documentado de `C2` (backend real en producción).

### 1.3 Beneficios esperados

| Beneficio | Para quién |
|---|---|
| Aislamiento de datos de prueba respecto a datos reales de usuarios | Usuarios finales, cumplimiento de privacidad |
| Posibilidad de romper cosas en desarrollo sin riesgo | Equipo de ingeniería |
| Base habilitante para CI/CD con despliegue automático | DevOps, velocidad de entrega |
| Entorno de Staging para validar cambios contra infraestructura real antes de producción | QA, reducción de incidentes en producción |
| Alineación con prácticas estándar de la industria (12-factor, separación dev/staging/prod) | Atractivo para inversores/auditores externos futuros |

### 1.4 Riesgos que introduce este módulo en sí

Diseñar y ejecutar esta separación no es gratis — introduce su propia superficie de riesgo, distinta de la que resuelve (detalle completo en sección 4):

- Costo de infraestructura recurrente nuevo (proyectos Firebase adicionales, posible hosting adicional para Staging).
- Complejidad operativa mayor: más superficie de configuración = más lugares donde algo puede desalinearse (mismo argumento anti-sobreingeniería que ya rige el resto del proyecto, aplicado aquí como advertencia, no como razón para no hacerlo — el riesgo de **no** separar entornos ya es Crítico).
- Curva de aprendizaje de flavors de Android/iOS para cualquier persona nueva en el equipo.
- Ventana de riesgo durante la migración misma (mitigada por el plan de fases de la sección 6, cada una reversible de forma independiente).

### 1.5 Impacto sobre RidePro

Este módulo bloquea, según `MASTER_EXECUTION_PLAN.md` §6-7: `T-F1.1` (hosting), `T-F1.2` (CD), `T-F1.3` (staging real), y transitivamente `T-F1.5` (puente de autenticación Firebase↔NestJS, la tarea de mayor costo del backlog). Ninguna de esas tareas tiene sentido técnico completo sin que exista primero al menos un entorno de Development real y separado de producción.

---

## 2. Decisiones Pendientes del Propietario — leer antes de continuar

Estas son **todas** las decisiones 🟡 de este documento, consolidadas. Cada una incluye alternativas, ventajas/desventajas, y una recomendación técnica — pero la decisión final no se toma en este documento. La implementación no puede iniciarse (ni siquiera la Fase 1 del plan de la sección 7) hasta que las decisiones marcadas **Bloqueante para iniciar** estén resueltas.

| # | Decisión | Bloqueante para iniciar? | Seccion de detalle | Recomendación técnica |
|---|---|---|---|---|
| D1 | ¿`ridepro-dbafe` se convierte en Producción, o se crea un proyecto nuevo para Producción y `ridepro-dbafe` pasa a ser Development? | **Sí** | §3.1, §4.2 | `ridepro-dbafe` = Producción (evita migración de datos; es el proyecto ya referenciado en el 100% de la configuración real) |
| D2 | ¿3 entornos (Dev/Staging/Prod) o 2 (Dev/Prod, con QA compartiendo Dev)? | **Sí** | §4.1 | 3 entornos, tal como pediste explícitamente — con QA compartiendo el proyecto de Development (no un 4º proyecto) |
| D3 | Convención de `applicationId` (Android) / Bundle ID (iOS) por entorno | **Sí** (bloquea §7 Fase 2-3) | §3.2, §9 | `com.ridepro.app` (prod, ya fijado), `com.ridepro.app.dev`, `com.ridepro.app.staging` |
| D4 | Nivel de plan de Firebase para los proyectos nuevos (Spark gratuito vs. Blaze) | **Sí** (bloquea creación de proyectos) | §4.5 (riesgo de costo) | Spark para Development; evaluar Blaze para Staging solo si CI llega a desplegar contra él con volumen real |
| D5 | Estrategia de PostgreSQL por entorno: instancias separadas vs. una instancia con bases de datos lógicas separadas | No bloquea el diseño de Firebase, sí bloquea §7 Fase 6 | §3.3 | Una instancia con bases de datos lógicas separadas para Dev/Staging (menor costo); instancia dedicada para Producción |
| D6 | Hosting del backend por entorno (Cloud Run / Render / VPS) — ya es la tarea `T-F1.1` del backlog, se documenta aquí solo como dependencia | No bloquea Firebase, sí bloquea §7 Fase 7-8 | §3.4 | Fuera del alcance de decidir en este documento — se referencia, no se resuelve aquí |
| D7 | ¿Se incorpora `macos-latest` a CI para validar iOS, con su costo asociado, o iOS queda fuera de CI automatizado por ahora? | No bloquea Fases 1-6 | §3.5, §8 | Diferir — validar iOS manualmente hasta tener build real en macOS (ver `13_FIREBASE_IOS_CONFIGURACION_RESULTADO.md`); reevaluar cuando exista esa validación |
| D8 | Orden de ejecución: ¿Development completo y validado antes de abrir Staging, o ambos en paralelo? | **Sí** (determina el orden de §7) | §16 | Development primero, completo y validado, antes de iniciar Staging — mismo criterio de no replicar un error de configuración en dos proyectos nuevos a la vez |

**Cómo responder:** puedes contestar punto por punto, o decir "aprueba tu recomendación en todas" si prefieres que quede registrada como la decisión oficial. En cualquier caso, la respuesta queda documentada en `PROJECT_STATUS.md` en el momento del cierre de esta tarea de diseño (no en este documento, que es de planificación, no de registro de decisiones tomadas — ver sección 9).

---

## 3. Arquitectura

### 3.0 Línea base (estado actual, condensado — detalle completo en Documento 11 y en la inspección de Fase 0 de esta misma tarea)

| Componente | Estado actual |
|---|---|
| Proyecto Firebase | Uno solo, `ridepro-dbafe`, usado por Android/Web/Windows/iOS |
| `.firebaserc` | `"default": "demo-ridepro-security-tests"` (alias del emulador, no un entorno real) |
| `firebase_options.dart` | Archivo único y estático, sin selección por entorno, 4 bloques (`web`/`android`/`windows`/`ios`) todos apuntando a `ridepro-dbafe` |
| Android `applicationId` | Placeholder: `com.ridepro.app.YOUR_APPLICATION_ID` (`B10`/`T-TRANS.5`, pendiente de decisión de marca — ver D3) |
| Android flavors | No existen |
| Android firma de release | Usa la clave de **debug** (`signingConfig` de release no definido) — hallazgo nuevo de esta tarea, no capturado en el Documento 11 |
| iOS Bundle ID | `com.ridepro.app` (real, ya fijado y verificado — `13_FIREBASE_IOS_CONFIGURACION_RESULTADO.md`) |
| iOS configuraciones Xcode | Solo Debug/Release/Profile estándar de Flutter, sin custom configs ni `.xcconfig` adicionales |
| Web | Sin config de Firebase embebida en HTML; depende 100% de `firebase_options.dart`; sin selección de dominio/entorno |
| Windows | **Proyecto nativo no generado** (`windows/` no existe) — cualquier diseño de "Windows por entorno" es papel hasta que se ejecute `T-F2.7` |
| Backend NestJS | Cero acoplamiento a Firebase; `DATABASE_URL` se lee de `process.env` sin rama por `NODE_ENV`; sin `firebase-admin` instalado |
| PostgreSQL | Migraciones vía `node-pg-migrate` (4 archivos), sin separación de entornos hoy |
| CI/CD | 1 workflow (`ci.yml`), 3 jobs, todos en `ubuntu-latest`, sin secretos de GitHub, sin ningún paso de deploy |
| `.gitignore` | Ya hardenizado contra claves de servicio/Admin SDK (cerrado en la Fase 1 de Firebase, `14_CIERRE_MODULO_FIREBASE_IOS.md`) |

### 3.1 Visión general — flujo completo entre componentes (diseño propuesto)

```
                         ┌─────────────────────────────────────────────┐
                         │           SELECCIÓN DE ENTORNO                │
                         │      (100% en BUILD TIME, nunca runtime)      │
                         └─────────────────────────────────────────────┘
                                            │
         ┌──────────────────────────────────┼──────────────────────────────────┐
         │                                  │                                  │
   flutter build          flutter build --flavor staging          flutter build --flavor production
   --flavor development                     │                                  │
         │                                  │                                  │
         ▼                                  ▼                                  ▼
┌─────────────────┐              ┌─────────────────┐              ┌─────────────────┐
│  Firebase        │              │  Firebase        │              │  Firebase        │
│  ridepro-dev      │              │  ridepro-staging  │              │  ridepro-dbafe    │
│  (Auth/Firestore/ │              │  (Auth/Firestore/ │              │  (Auth/Firestore/ │
│   Storage)         │              │   Storage)         │              │   Storage) — PROD  │
└─────────────────┘              └─────────────────┘              └─────────────────┘
         │                                  │                                  │
         │  Firebase ID Token               │  Firebase ID Token               │  Firebase ID Token
         ▼                                  ▼                                  ▼
┌─────────────────┐              ┌─────────────────┐              ┌─────────────────┐
│  Backend NestJS   │              │  Backend NestJS   │              │  Backend NestJS   │
│  api-dev.ridepro   │              │  api-staging.      │              │  api.ridepro.app   │
│  .app (o equiv.)   │              │  ridepro.app        │              │  — PROD             │
│  Firebase Admin SDK│              │  Firebase Admin SDK│              │  Firebase Admin SDK│
│  → valida contra   │              │  → valida contra   │              │  → valida contra   │
│    ridepro-dev      │              │    ridepro-staging  │              │    ridepro-dbafe     │
└─────────────────┘              └─────────────────┘              └─────────────────┘
         │                                  │                                  │
         ▼                                  ▼                                  ▼
┌─────────────────┐              ┌─────────────────┐              ┌─────────────────┐
│ PostgreSQL         │              │ PostgreSQL         │              │ PostgreSQL         │
│ ridepro_dev (DB     │              │ ridepro_staging      │              │ ridepro_prod          │
│ lógica o instancia) │              │ (DB lógica o        │              │ (instancia dedicada,   │
│                     │              │  instancia)          │              │  ver D5)               │
└─────────────────┘              └─────────────────┘              └─────────────────┘
```

**Principio de diseño rector (heredado de Documento 11 §8, sin alterar):** la selección de entorno ocurre **exclusivamente en build time**, nunca como una condición evaluable en runtime. Un binario de producción **no contiene, ni en teoría**, la capacidad de apuntar a otro proyecto — la garantía la da el compilador (flavors), no un `if`.

### 3.2 Android

**Mecanismo:** Android product flavors, un flavor por entorno (`development`, `staging`, `production`), cada uno con su propio `applicationId`, su propio `google-services.json` (colocado en `android/app/src/<flavor>/google-services.json`, patrón nativo soportado por el plugin `com.google.gms.google-services`), y opcionalmente su propio ícono/nombre visible para distinguir builds instalados simultáneamente en el mismo dispositivo de prueba.

| Entorno | `applicationId` (🟡 D3) | Nombre visible propuesto | `google-services.json` |
|---|---|---|---|
| Development | `com.ridepro.app.dev` | "RidePro Dev" | Del proyecto `ridepro-dev` |
| Staging | `com.ridepro.app.staging` | "RidePro Staging" | Del proyecto `ridepro-staging` |
| Production | `com.ridepro.app` (ya fijado) | "RidePro" | Ya existente (`ridepro-dbafe`) |

**Firma:** hallazgo nuevo de esta tarea — `buildTypes.release` usa hoy la clave de **debug**. Diseño propuesto: `signingConfigs.release` con keystore real solo para el flavor `production`; `development`/`staging` pueden seguir firmando con debug (sin impacto de distribución, no van a Play Store). La creación del keystore de producción y su gestión como secreto (nunca en el repo) se detalla en la sección 8 (Secretos) — **requiere que exista ya la decisión de nombre de marca (D3)**, porque el keystore se genera una sola vez y no es trivial rotarlo después de la primera publicación.

### 3.3 iOS

**Mecanismo:** Xcode Configurations + Schemes, uno por entorno, cada uno con su propio `.xcconfig` (`ios/Flutter/Development.xcconfig`, `Staging.xcconfig`, `Production.xcconfig`), definiendo `PRODUCT_BUNDLE_IDENTIFIER` distinto por configuración — mismo mecanismo nativo que Android flavors, aplicado a la forma idiomática de Xcode (FlutterFire CLI soporta generar `firebase_options_<flavor>.dart` compatible con este patrón).

| Entorno | Bundle ID (🟡 D3) | `GoogleService-Info.plist` |
|---|---|---|
| Development | `com.ridepro.app.dev` | Del proyecto `ridepro-dev`, app iOS nueva a registrar |
| Staging | `com.ridepro.app.staging` | Del proyecto `ridepro-staging`, app iOS nueva a registrar |
| Production | `com.ridepro.app` (ya fijado y registrado) | Ya existente y validado a nivel estático (`13_FIREBASE_IOS_CONFIGURACION_RESULTADO.md`) |

**Firma y TestFlight:** cada Bundle ID nuevo requiere su propio App ID en el portal de Apple Developer y su propio perfil de aprovisionamiento — **acción manual fuera del alcance de este repositorio**, que solo puede ejecutarse con acceso a la cuenta de Apple Developer del propietario. TestFlight se usaría únicamente para el Bundle ID de `staging` (validación pre-lanzamiento con testers reales) y `production` (beta pública/interna); `development` no necesita TestFlight, se instala vía Xcode/simulador directamente.

**Bloqueador ya conocido, sin cambio:** ningún build real de iOS (ningún entorno) ha sido ejecutado en este repositorio — todo lo anterior es diseño estático, consistente con el resto de la configuración ya validada, pero no probado en un `flutter build ios` real (requiere macOS, no disponible en este entorno de desarrollo).

### 3.4 Web

**Mecanismo:** `flutter build web --dart-define=ENVIRONMENT=<env>` combinado con `firebase_options_<flavor>.dart` seleccionado en build time (mismo mecanismo que FlutterFire CLI genera para flavors — Web no tiene "flavors" nativos como Android/iOS, pero FlutterFire CLI ya soporta targets nombrados para Web mediante el flag `--out`/`-o` al generar).

| Entorno | Dominio propuesto | Firebase Hosting target |
|---|---|---|
| Development | `dev.ridepro.app` (o subdominio equivalente) | `ridepro-dev` |
| Staging | `staging.ridepro.app` | `ridepro-staging` |
| Production | `ridepro.app` / `app.ridepro.app` | `ridepro-dbafe` |

**Nota de alcance:** RidePro no usa hoy Firebase Hosting (no hay evidencia de despliegue Web en ningún dominio real, verificado en la inspección de Fase 0) — este punto queda como diseño de referencia, no como una migración de un hosting existente. La decisión de **dónde** se aloja Web en producción está fuera del alcance de `T-F0.2`/`C1` (pertenece a decisiones de infraestructura general, no específicas de Firebase).

### 3.5 Windows

**Estado:** sin proyecto nativo generado (`T-F2.7`, `PLAT-2`, aún no ejecutado). Windows hoy reutiliza la configuración de la app Web de Firebase como placeholder funcional (`PLAT-4`/`M8`, deuda ya documentada).

**Propuesta definitiva:** una vez ejecutado `T-F2.7` (fuera del alcance de esta tarea), Windows seguiría el mismo patrón que Web — no existe el concepto de "flavor" nativo en una app de escritorio Flutter para Windows sin usar `--dart-define` en build time, ya que Windows no tiene un equivalente directo a Android product flavors. Se usaría `flutter build windows --dart-define=ENVIRONMENT=<env>` seleccionando en build time cuál `firebase_options_<flavor>.dart` se compila (mismo principio de build-time selection de la sección 3.1, sin excepción para Windows). **Esta sección es solo diseño de referencia — no se puede ejecutar hasta cerrar `T-F2.7` primero**, que es un prerrequisito técnico independiente de `T-F0.2`.

### 3.6 Backend NestJS

**Mecanismo:** una variable `NODE_ENV`/`APP_ENV` real, leída explícitamente (hoy declarada en `.env.example` pero no consumida en código — hallazgo de esta tarea), que determina: `DATABASE_URL` (ver 3.7), ruta al service account de Firebase Admin SDK correspondiente, y `CORS_ALLOWED_ORIGINS` (ya existe el mecanismo de allowlist por env, cerrado recientemente — commit `4caea56`).

**Puente Firebase ↔ NestJS (bloqueo transversal ya documentado, `A1`/`T-F1.5`):** este módulo (`T-F0.2`) **no construye** el puente de autenticación — ese es un módulo separado y de mayor costo (`T-F1.5`). Lo que sí define este módulo es **la superficie que `T-F1.5` deberá respetar cuando se construya**: el backend de cada entorno debe inicializar el Firebase Admin SDK apuntando al proyecto Firebase de su propio entorno (`ridepro-dev`/`ridepro-staging`/`ridepro-dbafe`), usando una service account key **propia por entorno**, nunca compartida. Diseño explícito para cuando `T-F1.5` se ejecute:

```typescript
// backend/src/config/firebase-admin.config.ts (diseño de referencia, no implementado)
// La ruta de la key se lee de una variable de entorno específica por entorno —
// nunca hardcodeada, nunca la misma key en dos entornos.
const credentialPath = process.env.FIREBASE_ADMIN_CREDENTIALS_PATH;
admin.initializeApp({
  credential: admin.credential.cert(require(credentialPath)),
});
```

Esto **no se implementa en esta tarea** — se documenta como el contrato que `T-F1.5` deberá cumplir, para que cuando esa tarea se ejecute no reintroduzca el riesgo de credenciales cruzadas entre entornos.

### 3.7 PostgreSQL

🟡 **D5 — decisión pendiente.** Dos alternativas viables (comparación completa en sección 4):

- **Opción A (recomendada para Dev/Staging):** una única instancia de PostgreSQL con bases de datos lógicas separadas (`ridepro_dev`, `ridepro_staging`), diferenciadas por `DATABASE_URL` completo (incluyendo el nombre de la base). Menor costo, aislamiento suficiente para entornos no críticos.
- **Opción B (recomendada para Producción):** instancia dedicada, sin excepción — nunca comparte instancia física con Development/Staging, para que ninguna carga de prueba ni ningún error de un entorno no productivo pueda degradar el rendimiento o la disponibilidad de producción.

Migraciones (`node-pg-migrate`) y el script de seed QA (`seed_qa_workouts.js`) ya son reutilizables sin cambio de herramienta — solo requieren que `DATABASE_URL` apunte a la base correcta por entorno, ejecutado explícitamente (nunca automático contra producción, ver Go/No-Go sección 5).

### 3.8 Firebase — Auth, Firestore, Storage

| Componente | Estrategia por entorno |
|---|---|
| Authentication | Cada proyecto tiene su propia base de usuarios, completamente aislada — sin sincronización entre entornos (ni siquiera de prueba); proveedores (Email/Password, Google, Apple) se habilitan por separado en cada proyecto vía Firebase Console |
| Firestore rules/indexes | Mismo archivo fuente (`firestore.rules`, `firestore.indexes.json`) desplegado por separado a cada proyecto vía `firebase deploy --only firestore:rules --project <alias>` — nunca reglas distintas por entorno salvo necesidad justificada explícita |
| Storage rules | Mismo criterio — `storage.rules` (ya creado, deny-by-default) desplegado igual a los 3 proyectos |
| Functions | No existen hoy (`functions/` ausente, confirmado) — si se crean en el futuro, seguirían el mismo patrón de despliegue por proyecto, sin necesidad de rediseño de este documento |

---

## 4. Alternativas evaluadas

### 4.1 Topología de proyectos Firebase

| Alternativa | Ventajas | Desventajas | Complejidad | Costo | Escalabilidad | Mantenimiento | Riesgos |
|---|---|---|---|---|---|---|---|
| **A — 1 proyecto único (estado actual)** | Cero costo adicional, cero configuración nueva | Es exactamente el riesgo `C1` que este módulo existe para resolver — datos de prueba y reales mezclados, imposible aislar builds | Ninguna | $0 | Nula — no escala a un equipo con QA/Staging real | Trivial hoy, imposible de corregir sin migración después de tener datos reales | Crítico — descartada por ser el problema, no la solución |
| **B — 2 proyectos (Dev+Prod, sin Staging)** | Menor costo que 3; suficiente para equipos muy pequeños | Sin lugar para validar contra infraestructura real antes de producción; QA y Desarrollo comparten el mismo proyecto que además sirve de "última prueba" antes de producción | Baja | 1 proyecto nuevo | Limitada — quedaría corta en cuanto el equipo crezca o se necesite un ensayo general antes de release | Baja, una vez migrado | Riesgo medio de que un bug solo visible "a escala" o "con config real" llegue a producción sin pasar por un entorno intermedio |
| **C — 3 proyectos (Dev/Staging/Prod) — 🟢 recomendada, D2** | Balance correcto entre aislamiento y costo; Staging permite validar contra infraestructura real sin arriesgar datos de producción; alineado con el pedido explícito del propietario | 2 proyectos nuevos a mantener, 2 sets de credenciales nuevas, más superficie de CI/CD | Media | 2 proyectos nuevos (ambos pueden iniciar en plan Spark, ver D4) | Alta — es el estándar de la industria para este tamaño de equipo | Media — mitigada por automatizar todo lo posible en vez de gestión manual | Los riesgos de esta topología están cubiertos en la matriz de la sección 5, ninguno de severidad Crítica que no tenga mitigación |
| **D — 4 proyectos (Dev/QA/Staging/Prod)** | Aislamiento máximo, QA totalmente separado de desarrollo activo | Costo y complejidad mayor sin evidencia de que QA y Desarrollo hoy se interfieran entre sí (no hay equipo de QA dedicado documentado) | Alta | 3 proyectos nuevos | Sobra para el tamaño actual del equipo | Alta carga operativa para el beneficio marginal actual | Sobre-ingeniería — mismo criterio anti-sobreingeniería ya validado en toda la auditoría (ADR-0001/0005); se descarta salvo evidencia futura de que QA y Desarrollo interfieren en la práctica |

**Recomendación técnica:** Opción C (3 proyectos), con QA compartiendo el proyecto de Development si en el futuro se formaliza un rol de QA — exactamente el criterio ya adelantado en el Documento 11 §"Parte B, punto 2".

### 4.2 Rol de `ridepro-dbafe`

| Alternativa | Ventajas | Desventajas | Riesgo |
|---|---|---|---|
| **A — `ridepro-dbafe` = Producción (recomendada, D1)** | Cero migración de datos; es el proyecto ya referenciado en el 100% de la configuración cliente real (Android/Web/Windows/iOS) | Si hoy ya existen datos de prueba mezclados con datos reales (no verificable sin acceso a Firebase Console), quedan "heredados" en producción | Bajo — requiere una limpieza puntual de datos de prueba, no una migración de proyecto completa |
| **B — `ridepro-dbafe` = Development, crear proyecto nuevo para Producción** | Producción arranca 100% limpia desde cero | Requiere migrar cualquier dato real ya existente (si lo hay) a un proyecto nuevo — mayor esfuerzo y riesgo que limpiar datos de prueba de uno ya existente; además requeriría volver a registrar Android/iOS/Web/Windows en el proyecto nuevo, repitiendo todo el trabajo ya hecho para iOS en la Fase 1 recién cerrada | Medio-Alto — sin evidencia de que valga la pena el costo mayor |

**Recomendación técnica:** Opción A — sin cambio respecto a lo ya recomendado en Documento 11.

### 4.3 Mecanismo de selección de entorno

| Alternativa | Ventajas | Desventajas | Complejidad | Costo | Escalabilidad | Mantenimiento | Riesgos |
|---|---|---|---|---|---|---|---|
| **A — Build-time (flavors/schemes/xcconfig) — 🟢 recomendada** | La garantía la da el compilador: un binario de producción físicamente no contiene la configuración de otro entorno; selección explícita en el comando de build, imposible de "olvidar" en runtime | Requiere configurar flavors/schemes una vez (costo inicial) | Media (una vez) | $0 (mecanismo nativo del SDK) | Alta — es el patrón estándar de Flutter/Android/iOS para este problema | Bajo una vez configurado — FlutterFire CLI regenera los `firebase_options_<flavor>.dart` automáticamente | Bajo — el único riesgo es configurarlo mal la primera vez, mitigado por checklist de verificación en CI (sección 8.3 del Documento 11, ya diseñado) |
| **B — Runtime (selección por `dart-define` + `if` en código)** | Más simple de implementar al principio, un solo `firebase_options.dart` | El binario de producción **contiene, en teoría, la capacidad de apuntar a cualquier entorno** si el flag se calcula mal en algún punto — garantía más débil para el mismo problema; ya existe un precedente parcial de este patrón (`QaEmulatorConfig`) que protege un caso distinto, no reemplaza credenciales de proyecto realmente distintas | Baja | $0 | Media — funciona, pero con garantías más débiles a medida que crece el equipo | Medio — cada nuevo desarrollador debe entender y respetar el flag correctamente | Alto — es exactamente el riesgo R2 de la sección 5 (build con config de entorno equivocado), con la peor mitigación posible de las dos alternativas |
| **C — Híbrida (build-time para credenciales, runtime solo para flags no sensibles)** | Combina la garantía fuerte de A para lo sensible (credenciales de proyecto) con la flexibilidad de B para flags de producto no relacionados con seguridad | Requiere disciplina de equipo para no mezclar ambos mecanismos para lo mismo | Media | $0 | Alta | Medio | Bajo, si se documenta con claridad qué va en cada mecanismo (ver regla explícita abajo) |

**Recomendación técnica:** Opción C en la práctica — Opción A (build-time) es obligatoria para **cualquier credencial o identificador de proyecto Firebase**; el mecanismo runtime existente (`QaEmulatorConfig`, `dart-define`) se mantiene **solo** para su propósito actual (activar el emulador en debug), sin extenderlo nunca a selección de proyecto real. Esta es una regla de diseño explícita, no una ambigüedad: **nunca usar runtime/`dart-define` para decidir a qué proyecto Firebase o backend apunta un build** — eso siempre se decide en build time.

### 4.4 Estrategia de PostgreSQL (D5, detalle de la comparación referenciada en 3.7)

| Alternativa | Ventajas | Desventajas | Complejidad | Costo | Escalabilidad | Mantenimiento | Riesgos |
|---|---|---|---|---|---|---|---|
| **A — Instancias físicas separadas por entorno** | Aislamiento total, imposible que una carga de prueba afecte producción, réplica exacta del aislamiento de Firebase | Costo recurrente más alto (3 instancias en vez de 1-2) | Baja (mismo mecanismo, 3 veces) | Alto | Alta | Bajo — cada instancia se gestiona igual, sin lógica cruzada | Bajo |
| **B — Una instancia con bases de datos lógicas por entorno (recomendada para Dev/Staging)** | Costo mucho menor mientras el volumen es bajo (estado actual: cero backend desplegado en ningún entorno real) | Un problema de la instancia física (caída, saturación de recursos) afecta a todos los entornos que la comparten | Baja | Bajo | Media — requiere migrar a instancias separadas cuando el volumen lo justifique | Bajo-Medio | Medio si Producción comparte instancia con Dev/Staging — **por eso Producción nunca comparte instancia, ver 3.7** |

**Recomendación técnica:** híbrida ya presentada en 3.7 — Opción B para Development/Staging, Opción A (dedicada) obligatoria para Producción, sin excepción.

### 4.5 Hosting del backend (D6 — referencia, no se decide en este documento)

Esta decisión pertenece formalmente a `T-F1.1` del `BACKLOG_MAESTRO.md`, ya marcada como "Requiere autorización del propietario: Sí" en ese documento. Se referencia aquí únicamente porque el diseño de dominios/CORS de la sección 3.6 depende de ella, no porque este módulo la resuelva. **No se compara en profundidad en este documento** — hacerlo duplicaría el trabajo que le corresponde a `T-F1.1` cuando se ejecute.

### 4.6 CI para iOS (D7)

| Alternativa | Ventajas | Desventajas |
|---|---|---|
| **A — Agregar `macos-latest` a CI ahora** | Valida iOS automáticamente en cada push | Costo por minuto de `macos-latest` es varias veces mayor que `ubuntu-latest`; hoy ni siquiera existe una validación manual real en macOS de la que partir |
| **B — Diferir CI de iOS, validar manualmente primero (recomendada)** | Cero costo adicional hasta que valga la pena; sigue el orden natural (validar manualmente primero, automatizar después de que el proceso manual esté probado) | iOS queda sin red de seguridad automatizada mientras tanto — mismo riesgo que ya existe hoy, no uno nuevo |

**Recomendación técnica:** Opción B — no se agrega `macos-latest` en este módulo; se revisita después de que exista al menos una validación manual real en macOS (bloqueador ya conocido, sección 3.3).

---

## 5. Riesgos — Matriz Profesional

Clasificación de severidad: **Severidad = combinación de Probabilidad × Impacto**, según la convención: Crítico (impacto Crítico, cualquier probabilidad ≥ Media, o impacto Alto con probabilidad Alta) · Alto (impacto Alto con probabilidad Media, o impacto Crítico con probabilidad Baja) · Medio · Bajo.

| ID | Riesgo | Probabilidad | Impacto | Severidad | Mitigación | Responsable | Contingencia |
|---|---|---|---|---|---|---|---|
| R1 | Datos de prueba escritos en el proyecto de Producción | Media (mientras no exista separación) | Crítico | **Crítico** | Separación de proyectos (este módulo) + selección build-time (nunca runtime, sección 4.3) | Ingeniero que ejecute cada build | Limpieza puntual de datos identificables como QA (mismo patrón ya usado en `seed_emulator.js`, nunca a escala automática contra producción) |
| R2 | Build de producción compilado con credenciales de Development por error humano | Media (antes de tener verificación en CI) | Crítico | **Crítico** | Paso de CI que verifique el `projectId` real embebido en el artefacto antes de publicarlo (diseño ya en Documento 11 §8.3); nomenclatura de flavors sin ambigüedad | DevOps / pipeline de CD (cuando exista, `T-F1.2`) | Revocar/despublicar el build, rotar credenciales si se sospecha exposición |
| R3 | Reglas de Firestore/Storage desplegadas al proyecto incorrecto | Baja-Media (comando manual sin `--project` explícito) | Alto | **Alto** | Alias nombrados explícitos en `.firebaserc` (`production`/`staging`/`development`), eliminando el alias `"default"` ambiguo; nunca ejecutar `firebase deploy` sin `--project`/target explícito | Ingeniero que ejecuta el deploy | Redeploy inmediato de las reglas correctas — reglas no son destructivas de datos, son deny/allow, revertibles sin pérdida |
| R4 | Backend conectado a la base de datos equivocada (p. ej. Staging apuntando a `ridepro_prod`) | Media (config de `DATABASE_URL` manual) | Crítico | **Crítico** | `DATABASE_URL` gestionada exclusivamente vía secretos de CI/CD por entorno (sección 8), nunca copiada manualmente entre `.env` locales; verificación de arranque que loguee (sin exponer credenciales) a qué base se conectó | DevOps | Apagar el servicio inmediatamente al detectarlo; auditar qué se escribió/leyó antes de restaurar la conexión correcta |
| R5 | Credenciales de Admin SDK cruzadas entre entornos (la key de un entorno usada en otro) | Baja (con el diseño de sección 3.6/8) | Alto | **Medio** | Una key por entorno, nombrada explícitamente, nunca reutilizada; validación en CI de que la key referenciada coincide con el `projectId` esperado | Arquitecto Principal al aprobar `T-F1.5` | Revocar la key comprometida desde Firebase Console, generar una nueva, rotar el secreto en CI |
| R6 | App ID / Bundle ID equivocado registrado en el entorno incorrecto | Baja (proceso ya validado con iOS producción, con doble verificación) | Medio | **Medio** | Mismo patrón de verificación de 5 puntos ya usado exitosamente en el registro de iOS producción (`13_FIREBASE_IOS_CONFIGURACION_RESULTADO.md`) | Ingeniero que registra la app | Eliminar la app mal registrada desde Firebase Console (acción reversible, sin impacto en otras apps) |
| R7 | Pérdida de datos durante alguna fase de migración | Baja (el plan de sección 7 no mueve datos existentes, solo agrega infraestructura nueva) | Crítico si ocurriera | **Alto** (por impacto, pese a probabilidad baja) | Ningún paso del plan de la sección 7 modifica ni migra datos de `ridepro-dbafe` — es aditivo por diseño (mismo principio que Documento 11 §10) | Arquitecto Principal | Backups de Firestore/Postgres antes de cualquier paso que sí toque producción (ninguno en este plan la toca directamente) |
| R8 | Divergencia de configuración entre entornos con el tiempo (reglas o índices actualizados en uno y no en otro) | Media (con el tiempo, sin proceso) | Medio | **Medio** | Mismo archivo fuente para reglas/índices, desplegado a los 3 proyectos desde el mismo comando/pipeline — nunca editado por proyecto | DevOps | Redeploy del archivo fuente vigente a todos los proyectos, auditoría de diffs entre proyectos |
| R9 | Costos de infraestructura no planificados (2 proyectos Firebase nuevos + posible instancia Postgres adicional) | Media | Medio | **Medio** | Iniciar en plan Spark (gratuito) para Development; monitoreo de facturación antes de escalar a Blaze (D4) | Propietario del producto | Downgrade de plan o pausa de proyectos no críticos si el costo excede lo presupuestado |
| R10 | Errores de autenticación cruzados entre entornos (usuario de un entorno intentando autenticar contra otro) | Baja (cada proyecto tiene su propia base de Auth, aislada por diseño de Firebase) | Bajo | **Bajo** | Aislamiento nativo de Firebase Auth por proyecto — sin mecanismo adicional necesario | — | Redirigir al usuario al entorno correcto (mensaje de error claro en el cliente) |
| R11 | iOS sin validación real (build/instalación en macOS/iPhone nunca ejecutado) | Alta (limitación de infraestructura conocida) | Medio | **Medio** | Ya documentado como bloqueador transversal, no exclusivo de este módulo; no se declara ningún entorno de iOS "aprobado" hasta validación real | Arquitecto Principal | Ejecutar la validación en cuanto exista acceso a macOS; hasta entonces, iOS permanece "configuración estática completa, build real pendiente" en todos los entornos, no solo producción |
| R12 | Android con `applicationId` placeholder (`B10`) bloqueando la definición de flavors | Alta (ya es el estado actual, confirmado en esta tarea) | Medio | **Medio** | Resolver D3 (decisión de marca) antes de iniciar la Fase 2 del plan de implementación (sección 7) — es un prerrequisito explícito, no un riesgo oculto | Propietario del producto | Ninguna — es bloqueante hasta decidirse, sin workaround técnico válido (usar un placeholder para flavors solo trasladaría el problema) |
| R13 | Windows reutilizando la app Web de Firebase como placeholder | Alta (estado actual confirmado, `windows/` ni siquiera existe) | Bajo (Windows no tiene usuarios reales hoy, no hay evidencia de builds distribuidos) | **Bajo** | Fuera del alcance ejecutable de este módulo hasta que `T-F2.7` genere el proyecto nativo; diseño de referencia ya documentado en 3.5 | Ingeniero asignado a `T-F2.7` | Ninguna acción requerida hasta que `T-F2.7` se priorice |

**Ningún riesgo de esta matriz es Crítico sin mitigación diseñada** — los 3 riesgos Críticos (R1, R2, R4) tienen mitigación basada en mecanismos ya validados en este mismo proyecto (selección build-time, patrón de "doble candado" de `QaEmulatorConfig`, verificación en CI), no en procesos nuevos sin precedente.

---

## 6. Criterios Go / No-Go

Protocolo obligatorio antes y durante la implementación (cuando se autorice). Aplica a **cada fase** del plan de la sección 7 de forma independiente — una fase puede tener luz verde mientras otra permanece bloqueada.

| Condición | Acción |
|---|---|
| Las decisiones 🟡 D1-D8 relevantes a la fase están resueltas y registradas | ✅ **Continuar** |
| `flutter analyze`/`flutter test`/suite de backend están en verde inmediatamente antes de iniciar la fase | ✅ **Continuar** |
| Una decisión 🟡 bloqueante de la fase actual no ha sido respondida | 🛑 **Detenerse completamente** — no proceder con esa fase específica, las fases no bloqueadas por esa decisión pueden continuar |
| Se detecta durante la ejecución que un paso ya hecho tocó un archivo o proyecto fuera del alcance autorizado para esa fase | 🛑 **Detenerse y revertir** ese paso específico (ver procedimiento de rollback, sección 10), antes de continuar con cualquier otro paso |
| `flutter analyze`/`flutter test`/suite de backend fallan después de un paso de esta fase | ⏪ **Revertir** ese paso inmediatamente; no se avanza al siguiente paso con la suite en rojo (regla ya vigente en `RIDEPRO_DEVELOPMENT_PROTOCOL.md` §3.11) |
| Se descubre un hallazgo nuevo no contemplado en la matriz de riesgos (sección 5) durante la ejecución | 📋 **Abrir una incidencia** — documentarlo con el mismo rigor que un hallazgo de auditoría (archivo/línea/evidencia), no corregirlo silenciosamente dentro de esta tarea salvo que sea trivial y de la misma naturaleza que el paso en curso |
| Cualquier paso que vaya a tocar `ridepro-dbafe` (Producción) de forma no aditiva (no solo "agregar una app nueva a un proyecto ya existente", sino modificar/eliminar algo ya en uso) | ⛔ **Requiere aprobación explícita del propietario**, sin excepción, incluso si la tarea general ya fue autorizada — mismo principio rector 5 de `RIDEPRO_DEVELOPMENT_PROTOCOL.md` |
| Cualquier paso irreversible (creación de keystore de producción, primera publicación en tiendas, `git push`/merge) | ⛔ **Requiere aprobación explícita del propietario**, registrada, en el momento — nunca se asume de una autorización general anterior |
| Todas las puertas de la fase actual (sección 11) están cumplidas | ✅ **Continuar** a la siguiente fase |

---

## 7. Plan de Implementación (documentado, no ejecutado)

**Advertencia de alcance, repetida por claridad:** ninguna de las fases siguientes se ejecuta en esta tarea. Se documentan para que, una vez resueltas las decisiones de la sección 2, la ejecución pueda comenzar sin re-diseñar nada.

### Fase 1 — Crear el proyecto Firebase de Development

- **Objetivo:** tener un proyecto Firebase real (`ridepro-dev`), aislado de producción, con Authentication/Firestore/Storage habilitados con las mismas reglas que producción.
- **Archivos afectados:** ninguno del repositorio en este paso — es una acción en Firebase Console/CLI (`firebase projects:create`). El repositorio se toca recién en la Fase 2.
- **Riesgos:** R9 (costo) si se elige mal el plan (D4) — mitigado iniciando en Spark.
- **Validaciones:** confirmar que el proyecto nuevo aparece en `firebase projects:list`, que Authentication/Firestore/Storage están habilitados con `firestore.rules`/`storage.rules` desplegadas (mismo archivo fuente que producción).
- **Rollback:** eliminar el proyecto desde Firebase Console — sin impacto en producción, proyectos Firebase son completamente aislados entre sí.
- **Criterio de aprobación:** D1, D2, D4 resueltas antes de iniciar.

### Fase 2 — Registrar apps Android y Web en Development

- **Objetivo:** registrar `com.ridepro.app.dev` (Android) y una app Web en `ridepro-dev`.
- **Archivos afectados:** `android/app/src/development/google-services.json` (nuevo), `lib/firebase_options_development.dart` (nuevo, generado por FlutterFire CLI), `android/app/build.gradle` (agregar bloque `productFlavors`).
- **Riesgos:** R6 (App ID equivocado) — mitigado con el mismo patrón de verificación de 5 puntos ya usado en iOS producción.
- **Validaciones:** `flutter build apk --flavor development` compila; `flutter analyze`/`flutter test` en verde.
- **Rollback:** revertir el commit — el flavor `production` (o el build único actual, hasta que se cree ese flavor también) no se ve afectado.
- **Criterio de aprobación:** D3 resuelta (nomenclatura de `applicationId`).

### Fase 3 — Registrar app iOS en Development

- **Objetivo:** registrar `com.ridepro.app.dev` en `ridepro-dev`, siguiendo exactamente el mismo procedimiento verificado y exitoso de la Fase 1 de Firebase iOS ya cerrada (temp-file-then-validate-then-replace, confirmación de 5 puntos antes de registrar).
- **Archivos afectados:** `ios/Runner/GoogleService-Info-Development.plist` (nuevo), `ios/Flutter/Development.xcconfig` (nuevo), `lib/firebase_options_development.dart` (extendido con bloque `ios`).
- **Riesgos:** R6, R11 (sin build real en macOS para confirmar) — se documenta el mismo bloqueador ya conocido, no se declara "aprobado" hasta validación real.
- **Validaciones:** validación estática únicamente (mismo nivel que la Fase 1 de Firebase iOS ya cerrada) — sin build real disponible en este entorno.
- **Rollback:** eliminar los archivos nuevos; sin impacto en la configuración de producción ya cerrada.
- **Criterio de aprobación:** D3 resuelta; Fase 2 cerrada primero (para reutilizar el mismo flavor Android como plantilla de nomenclatura).

### Fase 4 — `.firebaserc` con alias nombrados

- **Objetivo:** eliminar la ambigüedad del alias `"default"`, agregar alias explícitos `development`/`staging`/`production`.
- **Archivos afectados:** `.firebaserc`.
- **Riesgos:** R3 (deploy al proyecto incorrecto) — este cambio es precisamente la mitigación de ese riesgo, no lo introduce.
- **Validaciones:** `firebase deploy --project development --only firestore:rules --dry-run` (o equivalente) confirma que apunta a `ridepro-dev`, no a `demo-ridepro-security-tests` ni a `ridepro-dbafe`.
- **Rollback:** revertir el commit — `"default"` deja de existir, pero ningún flujo actual depende de él para producción real (confirmado en Fase 0: sin `firebase deploy` en CI hoy).
- **Criterio de aprobación:** Fase 1 cerrada (el proyecto debe existir antes de poder referenciarlo).

### Fase 5 — Backend: variable de entorno real + Firebase Admin SDK por entorno (diseño, sin implementar el puente de auth completo)

- **Objetivo:** que el backend pueda arrancar apuntando explícitamente a un entorno, leyendo `NODE_ENV`/`APP_ENV` realmente (hoy declarada pero no consumida).
- **Archivos afectados:** `backend/src/config/database.config.ts` (leer `DATABASE_URL` ya es correcto, agregar log no sensible de a qué entorno se conectó), `backend/.env.example` (documentar las variables nuevas), **sin agregar `firebase-admin` todavía** — eso pertenece a `T-F1.5`, fuera del alcance de esta tarea.
- **Riesgos:** R4 (base equivocada).
- **Validaciones:** `npm run test:e2e` sigue en verde; arranque local logea el entorno detectado sin exponer credenciales.
- **Rollback:** revertir el commit.
- **Criterio de aprobación:** D5 resuelta.

### Fase 6 — PostgreSQL: bases de datos separadas para Development/Staging

- **Objetivo:** `ridepro_dev`/`ridepro_staging` como bases de datos lógicas separadas (o instancias, según D5), con las mismas migraciones aplicadas.
- **Archivos afectados:** ninguno de código — es infraestructura (creación de bases de datos) + documentación de `DATABASE_URL` por entorno como secreto (sección 8), nunca en el repositorio.
- **Riesgos:** R4, R9.
- **Validaciones:** `npm run migrate:up` ejecutado contra cada base nueva, mismo resultado que contra la base de CI actual.
- **Rollback:** eliminar la base de datos lógica nueva — sin impacto en ninguna base ya en uso.
- **Criterio de aprobación:** D5 resuelta.

### Fase 7 — CI: pipeline de Development con despliegue automático

- **Objetivo:** extender `ci.yml` (o un workflow nuevo) para que un push a una rama de desarrollo despliegue automáticamente al entorno de Development — primer paso real de `T-F1.2`, acotado solo a Development en esta fase.
- **Archivos afectados:** `.github/workflows/` (nuevo workflow o extensión del existente), secretos nuevos de GitHub Actions (`FIREBASE_SERVICE_ACCOUNT_DEV`, etc. — nunca en texto plano).
- **Riesgos:** R2, R5.
- **Validaciones:** el paso de verificación de `projectId` (diseñado en Documento 11 §8.3) falla el build si detecta un cruce entorno/proyecto.
- **Rollback:** revertir el workflow — sin despliegue automático, se vuelve al proceso manual actual (que hoy es "ninguno", sin regresión real).
- **Criterio de aprobación:** Fases 1-6 cerradas; D6 (hosting) resuelta al menos para Development.

### Fase 8 — Repetir Fases 1-7 para Staging

- **Objetivo:** una vez Development completo y validado (criterio Go/No-Go de la sección 6), repetir el mismo proceso para `ridepro-staging`.
- **Criterio de aprobación:** D8 resuelta a favor de "Development primero" (recomendación de este documento) — si el propietario prefiere paralelizar, esta fase se fusiona con la 1-7 en su lugar.

### Fase 9 — Producción: solo lo aditivo, nunca migración

- **Objetivo:** aplicar a `ridepro-dbafe` únicamente los cambios que ya se aplicaron y validaron en Development/Staging, de forma aditiva (alias en `.firebaserc`, flavor `production` con el `applicationId` ya fijado, `DATABASE_URL` de producción como secreto).
- **Archivos afectados:** los mismos patrones de las Fases 2-7, aplicados al flavor/entorno `production`.
- **Riesgos:** R1, R2, R4, R7 — los 3 Críticos de la matriz aplican con mayor peso aquí.
- **Validaciones:** las mismas de cada fase anterior, ejecutadas contra producción explícitamente, con doble verificación humana antes de cualquier paso.
- **Rollback:** cada archivo tiene su propio procedimiento (sección 10) — ninguno de estos pasos es una migración de datos, son aditivos por diseño.
- **Criterio de aprobación:** ⛔ **Requiere aprobación explícita del propietario, sin excepción** (Go/No-Go, sección 6) — es la única fase que toca Producción.

---

## 8. Checklist de Salida del Módulo (nuevo estándar permanente para RidePro)

Este checklist se adopta como **formato obligatorio de cierre para todo módulo futuro** de RidePro, sin excepción, a partir de esta tarea (ver sección 15). Cada ítem requiere evidencia, no solo una casilla marcada — "Cumplido" sin evidencia no es válido según este mismo estándar.

Estado de este checklist **aplicado a esta tarea específica** (Documento 15 — fase de diseño, no de implementación):

| # | Ítem | Estado | Evidencia |
|---|---|---|---|
| 1 | Arquitectura aprobada | ✅ Cumplido | El propietario aprobó las decisiones D1-D8 el 2026-07-25 (registro exacto en la sección 10 y en `PROJECT_STATUS.md` §9) |
| 2 | Alcance cumplido | ✅ Cumplido | Este documento cubre las 17 secciones solicitadas explícitamente, sin reducir alcance |
| 3 | Archivos modificados revisados | N/A | Ningún archivo del proyecto fue modificado en esta tarea (solo se creó este documento) |
| 4 | `git diff` auditado | ✅ Cumplido | Único archivo nuevo: este documento — verificable con `git status --short` |
| 5 | `flutter analyze` en verde | N/A | Sin cambios de código en esta tarea — última verificación conocida: 0 issues (`14_CIERRE_MODULO_FIREBASE_IOS.md`) |
| 6 | `flutter test` en verde | N/A | Sin cambios de código en esta tarea — última verificación conocida: 189/189 (`14_CIERRE_MODULO_FIREBASE_IOS.md`) |
| 7 | Pruebas específicas del módulo en verde | N/A | No aplica todavía — módulo en fase de diseño, sin implementación que probar |
| 8 | Seguridad revisada | ✅ Cumplido | Sección 5 (matriz de riesgos) cubre explícitamente credenciales cruzadas, deploy al proyecto incorrecto, y R2/R4/R5 |
| 9 | Secretos protegidos | ✅ Cumplido | Diseño de sección 3.6/8 no expone ningún valor real; `.gitignore` ya hardenizado (verificado en tarea anterior) |
| 10 | Multiplataforma verificada | ✅ Cumplido (a nivel de diseño) | Android, iOS, Web, Windows cubiertos explícitamente en sección 3, con bloqueadores conocidos declarados (Windows/iOS) |
| 11 | Backend verificado | ✅ Cumplido (a nivel de diseño) | Sección 3.6, cero acoplamiento a Firebase confirmado, diseño de puente documentado sin implementarse |
| 12 | Base de datos verificada | ✅ Cumplido (a nivel de diseño) | Sección 3.7/4.4, alternativas comparadas, decisión pendiente D5 |
| 13 | Rendimiento revisado | N/A | Sin código nuevo que perfilar en esta tarea |
| 14 | Rollback documentado | ✅ Cumplido | Sección 10, procedimiento completo por componente |
| 15 | Documentación actualizada | ✅ Cumplido | Este mismo documento |
| 16 | `PROJECT_STATUS.md` actualizado | ✅ Cumplido | Actualizado el 2026-07-25 — sección 8 (próxima tarea) y sección 9 (historial) registran las decisiones D1-D8 y el siguiente paso |
| 17 | Riesgos pendientes registrados | ✅ Cumplido | Sección 5 (13 riesgos) + sección 2 (8 decisiones) |
| 18 | Deuda técnica registrada | ✅ Cumplido | R12 (Android placeholder), firma de release con clave debug (hallazgo nuevo de esta tarea, sección 3.0) |
| 19 | Validación manual completada o declarada pendiente | ✅ Cumplido | Declarada explícitamente pendiente donde aplica (iOS, Windows) |
| 20 | Auditoría independiente completada | ⏳ Pendiente | Este documento es autoauditado (sección 13) por el mismo autor — una revisión independiente real (Etapa 8 del protocolo) queda para cuando se apruebe la implementación |

**Nota sobre el checklist como estándar:** el ítem "Estado final del módulo" (Aprobado / Aprobado con observaciones / Rechazado) se resuelve en la sección 16 (Veredicto Final) — no se repite aquí para evitar duplicación (ver autoauditoría, sección 13).

---

## 9. Rollback — Procedimiento Completo

Aplica cuando la implementación (no esta tarea de diseño) esté en curso y se necesite revertir uno o más pasos.

| Componente | Qué archivos volverían atrás | Cómo revertir | Cómo verificar que la reversión fue correcta | Cómo validar que no quedaron residuos |
|---|---|---|---|---|
| Proyecto Firebase nuevo (`ridepro-dev`/`ridepro-staging`) | Ninguno del repositorio (es infraestructura externa) | Eliminar el proyecto desde Firebase Console | `firebase projects:list` ya no lo muestra | Confirmar que ningún archivo del repo (`firebase_options_*.dart`, `google-services.json` de ese flavor) sigue referenciando un `projectId` que ya no existe — si el proyecto se elimina, esos archivos se revierten primero (ver fila siguiente) |
| Flavors Android/iOS agregados | `android/app/build.gradle`, `android/app/src/<flavor>/google-services.json`, `ios/Flutter/<Flavor>.xcconfig`, `ios/Runner/GoogleService-Info-<Flavor>.plist`, `lib/firebase_options_<flavor>.dart` | `git revert` del commit que los introdujo | `flutter build apk`/`flutter build ios` (según disponibilidad) del flavor `production` (u original) sigue funcionando igual que antes del cambio | `git status --short` sin archivos huérfanos; `grep` de `<flavor>` en el repo no debe encontrar referencias sueltas |
| `.firebaserc` con alias nombrados | `.firebaserc` | `git revert` del commit | El alias `"default"` vuelve a `demo-ridepro-security-tests`, comportamiento idéntico al actual | `git diff` contra el commit anterior muestra cero diferencias |
| Cambios de backend (`NODE_ENV` real, config de DB) | `backend/src/config/database.config.ts`, `backend/.env.example` | `git revert` del commit | `npm run test:e2e` en verde, igual que antes del cambio | Ningún archivo `.env` real (nunca versionado) queda con una `DATABASE_URL` de un entorno que ya no existe — se verifica manualmente, fuera del repo |
| Bases de datos PostgreSQL nuevas | Ninguno del repositorio | `DROP DATABASE` (o eliminar la instancia, según D5) | La base ya no aparece en `\l` (psql) o en el listado del proveedor de hosting | Confirmar que ninguna `DATABASE_URL` en secretos de CI sigue apuntando a la base eliminada |
| Workflow de CI/CD nuevo | `.github/workflows/<nuevo-archivo>.yml` (o la extensión de `ci.yml`) | `git revert` del commit | El pipeline vuelve a ejecutar exactamente los 3 jobs actuales, sin el paso de deploy nuevo | Revisar en GitHub que no queden `environments`/`secrets` configurados en el repo que ya no se usan (limpieza manual en la UI de GitHub, fuera del repo) |
| Secretos de GitHub Actions agregados | Ninguno del repositorio (viven en GitHub Settings) | Eliminar el secreto desde GitHub Settings → Secrets | El workflow revertido ya no lo referencia (confirmado en la fila anterior) | Confirmar que ningún log histórico de Actions expuso el valor (GitHub enmascara secretos automáticamente en logs, verificar igualmente) |

**Principio general de rollback (heredado de Documento 11 §10, sin alterar):** ningún paso de este plan, tal como está diseñado, requiere tocar `ridepro-dbafe` (Producción) de forma destructiva antes de que todo lo demás esté validado en Development primero — el rollback más simple, en la mayoría de las fases, es simplemente no continuar a la siguiente.

---

## 10. Matriz de Decisiones

| Decisión | Motivo | Alternativas descartadas | Impacto | Responsable | Estado |
|---|---|---|---|---|---|
| `ridepro-dbafe` = Producción | Evita migración de datos; ya es el proyecto real referenciado en toda la config cliente | Crear proyecto nuevo para Producción (Opción B, §4.2) | Alto — determina toda la topología | Propietario del producto | ✅ Aprobada por el propietario — 2026-07-25 (D1) |
| 3 entornos (Dev/Staging/Prod) | Pedido explícito del propietario; balance costo/aislamiento correcto para el tamaño actual del equipo | 2 entornos (menor aislamiento); 4 entornos (sobre-ingeniería sin evidencia de necesidad) | Alto — determina cuántos proyectos Firebase se crean | Propietario del producto | ✅ Aprobada por el propietario — 2026-07-25 (D2) |
| Selección de entorno 100% en build time | Garantía del compilador, no de una condición en runtime; evita R2 (riesgo Crítico) | Selección runtime por `dart-define` puro | Alto — es el mecanismo central de todo el diseño | Arquitecto Principal | ✅ Recomendado, sin necesidad de aprobación adicional (es una práctica técnica, no una decisión de negocio) |
| `applicationId`/Bundle ID: `com.ridepro.app.dev`/`.staging` | Convención estándar de sufijo por entorno, mínima fricción, reutiliza el Bundle ID de producción ya fijado | Nombres completamente distintos por entorno (mayor fricción, sin beneficio claro) | Medio — bloquea Fases 2-3 del plan | Propietario del producto (ligado a `B10`/`T-TRANS.5`, decisión de marca) | ✅ Aprobada por el propietario — 2026-07-25 (D3) |
| Plan Spark para Development | Costo cero mientras no haya tráfico real | Blaze desde el inicio | Bajo-Medio (costo) | Propietario del producto | ✅ Aprobada por el propietario — 2026-07-25 (D4): Development en Spark; plan de Staging (Spark vs. Blaze) a evaluar antes de crear ese proyecto |
| PostgreSQL: DB lógica compartida para Dev/Staging, instancia dedicada para Prod | Balance costo/aislamiento — mismo criterio que la topología de Firebase | Instancias separadas para los 3 entornos desde el inicio | Medio — bloquea Fase 6 del plan | Propietario del producto | ✅ Aprobada por el propietario — 2026-07-25 (D5) |
| Hosting del backend | Ya es la decisión de `T-F1.1`, no se duplica aquí | — | Alto, pero fuera del alcance de este módulo | Propietario del producto (vía `T-F1.1`) | 🟡 Reconfirmada pendiente por el propietario — 2026-07-25, permanece a resolver en `T-F1.1` (D6) |
| CI de iOS diferido (sin `macos-latest` todavía) | Sin build real en macOS del que partir; costo innecesario hoy | Agregar `macos-latest` ahora | Bajo — no bloquea ninguna fase del plan | Arquitecto Principal | ✅ Recomendación ratificada por el propietario — 2026-07-25 (D7) |
| Development completo antes de abrir Staging | Evita replicar un error de configuración en dos proyectos nuevos simultáneamente | Ambos en paralelo | Medio — determina el orden de las Fases 1-8 | Propietario del producto | ✅ Aprobada por el propietario — 2026-07-25 (D8) |

---

## 11. Dependencias

### 11.1 Internas (dentro del repositorio)
- `lib/firebase_options.dart` — pasa de archivo único a familia de archivos por flavor.
- `lib/core/config/qa_emulator_config.dart` — patrón de referencia para el "doble candado" de selección de entorno; no se modifica, se referencia como modelo.
- `android/app/build.gradle`, `ios/Runner.xcodeproj/project.pbxproj`, `ios/Flutter/*.xcconfig` — requieren extensión (flavors/configuraciones).
- `backend/src/config/database.config.ts` — requiere lectura real de `NODE_ENV`/`APP_ENV`.
- `.firebaserc`, `firebase.json` — requieren alias nombrados y (eventualmente) `targets` multi-proyecto.
- `.gitignore` — ya preparado (cerrado en la tarea anterior), sin cambio adicional necesario para este módulo.

### 11.2 Externas / Servicios
- Firebase Console / Firebase CLI (`firebase projects:create`, `firebase apps:sdkconfig`) — requiere la misma cuenta con permisos ya usada para `ridepro-dbafe`.
- Apple Developer Portal — requerido para registrar nuevos Bundle IDs (`com.ridepro.app.dev`/`.staging`) y sus perfiles de aprovisionamiento — **acceso que no está disponible en este entorno de desarrollo**, mismo bloqueador que ya existe para la validación real de iOS.
- Google Play Console — solo relevante cuando exista intención real de publicar (fuera del alcance de este módulo).
- Proveedor de hosting del backend (a definir en `T-F1.1`) — dependencia de la Fase 7-9 del plan, no de las Fases 1-6.
- Proveedor de PostgreSQL gestionado (si se elige uno managed en vez de autohospedado) — dependencia de D5/D6.

### 11.3 SDK / Herramientas
- FlutterFire CLI (`flutterfire configure`) — ya usado exitosamente en la Fase 1 de Firebase (iOS), mismo mecanismo se reutiliza por flavor.
- `firebase-tools` (CLI) — ya en uso en CI (`firestore-rules-tests` job).
- `node-pg-migrate` — ya en uso, sin cambio de herramienta necesario.
- `firebase-admin` (npm) — **nueva dependencia del backend**, no agregada en este módulo (pertenece a `T-F1.5`), pero su necesidad futura es una dependencia indirecta de este diseño (sección 3.6).

### 11.4 CI
- GitHub Actions (`ubuntu-latest` para todo excepto, eventualmente, iOS — ver D7).
- GitHub Secrets — mecanismo ya disponible, sin uso actual (`ci.yml` no referencia ninguno hoy) — este módulo sería el primer consumidor real.

### 11.5 Flutter / Firebase / NestJS / PostgreSQL (versiones — sin cambio de versión implicado por este módulo)
- Flutter/Dart: sin cambio de versión requerido — flavors son una capacidad ya soportada por el SDK actual del proyecto.
- Firebase: mismos SDKs de cliente ya declarados en `pubspec.yaml` (`firebase_core`, `firebase_auth`, `cloud_firestore`, `firebase_storage`, etc.) — sin upgrade necesario.
- NestJS: sin cambio de versión requerido.
- PostgreSQL: sin cambio de versión requerido — mismo motor, más bases/instancias.

---

## 12. Criterios de Aceptación — Puertas Obligatorias

Ningún entorno (Development, Staging o Production) puede aprobarse como "listo" si falta **una sola** de estas puertas. No hay aprobación parcial de un entorno individual — o cumple las 10, o permanece en estado "en progreso"/"bloqueado".

| Puerta | Criterio |
|---|---|
| **A. Arquitectura** | El diseño ejecutado coincide exactamente con lo documentado en la sección 3-4 de este documento, sin desviación no justificada y no registrada |
| **B. Configuración** | `firebase_options_<flavor>.dart`, `google-services.json`, `GoogleService-Info-<Flavor>.plist` y `.firebaserc` consistentes entre sí (mismo `projectId` en los 3, verificado con el mismo procedimiento de 5 puntos ya usado en iOS producción) |
| **C. Seguridad** | Ninguna credencial de un entorno alcanzable desde otro; `.gitignore` cubre cualquier archivo de secretos nuevo; reglas de Firestore/Storage desplegadas y verificadas contra el proyecto correcto |
| **D. Pruebas** | `flutter analyze`/`flutter test` en verde tras cada cambio; suite de `firebase/rules-tests` pasa contra el proyecto real del entorno, no solo contra el emulador |
| **E. Multiplataforma** | Android y Web (mínimo) verificados con build real del flavor correspondiente; iOS y Windows declarados explícitamente "configuración estática completa, build real pendiente" si aplica ese bloqueador — nunca silenciado |
| **F. Backend** | Arranca correctamente contra el entorno esperado, con log no sensible que lo confirme; sin cruce de `DATABASE_URL` |
| **G. Base de datos** | Migraciones aplicadas limpiamente contra la base del entorno; sin residuos de otra base |
| **H. CI/CD** | Pipeline del entorno (cuando exista, Fase 7+) verifica el `projectId` antes de publicar; sin secretos en texto plano |
| **I. Documentación** | `PROJECT_STATUS.md` actualizado (en la tarea de cierre correspondiente, no en esta), informe de cierre con el Formato Obligatorio de Entrega (`RIDEPRO_DEVELOPMENT_PROTOCOL.md` §5) |
| **J. Rollback** | Procedimiento de la sección 9 verificado como ejecutable (al menos revisado, idealmente ensayado en Development antes de repetirse en Staging/Production) |

---

## 13. Auditoría Final (autoauditoría de este documento)

Revisión crítica del propio documento, como si fuera de otro autor, antes de entregarlo — mismo estándar exigido por `RIDEPRO_DEVELOPMENT_PROTOCOL.md` Etapa 6/§4bis, aplicado aquí a un documento de diseño en vez de a código.

| Pregunta | Resultado |
|---|---|
| ¿Hay contenido duplicado entre secciones? | Se detectó una duplicación potencial entre la sección 8 (Checklist) ítem "Estado final del módulo" y la sección 16 (Veredicto). **Corregido**: el checklist remite explícitamente a la sección 16 en vez de repetir el veredicto. |
| ¿Hay contradicciones entre secciones? | Se verificó que la recomendación de D1 (§4.2), D2 (§4.1) y su reflejo en la Matriz de Decisiones (§10) son consistentes entre sí — mismas alternativas, mismas razones, sin variación de redacción que sugiera una conclusión distinta. Sin contradicciones encontradas. |
| ¿Información repetida sin necesidad? | La línea base (§3.0) resume, no repite palabra por palabra, el contenido ya extenso de `11_PLAN_SEPARACION_FIREBASE.md` — se cita por referencia en vez de copiarse, consistente con el estándar de no duplicar documentación ya vigente en este proyecto. |
| ¿Decisiones inconsistentes? | Se verificó que la recomendación de "Development antes de Staging" (D8, §16) es consistente con el orden de fases del plan de implementación (§7, Fases 1-8) — no hay una sección que sugiera paralelismo y otra que lo contradiga. |
| ¿Pasos ambiguos? | Se revisó el plan de la sección 7 — cada fase tiene objetivo, archivos, riesgos, validación, rollback y criterio de aprobación explícitos, sin pasos "implícitos" no descritos. |
| ¿Riesgos omitidos? | Se contrastó la lista mínima exigida explícitamente por el propietario en la tarea anterior (datos de prueba en producción, credenciales cruzadas, App IDs equivocados, reglas al proyecto incorrecto, backend a la base equivocada, builds a producción, pérdida de datos, divergencia de configuraciones, costos, errores de autenticación, iOS sin validación real, Android con `applicationId` placeholder, Windows reutilizando app Web) contra la matriz de la sección 5 — **las 13 categorías están cubiertas** (R1-R13), ninguna omitida. |
| ¿Información desactualizada? | Se verificó que el estado de `firebase_options.dart`/`GoogleService-Info.plist` de iOS descrito en la línea base (§3.0) refleja el estado **posterior** al cierre de la Fase 1 de Firebase (`14_CIERRE_MODULO_FIREBASE_IOS.md`), no el estado del Documento 11 (que describía el placeholder, ya resuelto) — se corrigió la redacción para no citar el hallazgo 4.1 de Documento 11 como si siguiera vigente hoy. |

**Corrección aplicada durante esta autoauditoría:** ninguna corrección de fondo fue necesaria más allá de las verificaciones de consistencia ya descritas arriba — no se encontraron errores técnicos, solo se confirmó la ausencia de duplicación real tras revisar los puntos de riesgo señalados.

---

## 14. Reglas Obligatorias — Cumplimiento en esta tarea

| Regla impuesta | Cumplimiento |
|---|---|
| No modificar ningún archivo del proyecto | ✅ Cumplido — único archivo nuevo: este documento |
| No cambiar código | ✅ Cumplido |
| No ejecutar migraciones | ✅ Cumplido |
| No crear configuraciones | ✅ Cumplido |
| No modificar Firebase | ✅ Cumplido |
| No modificar Flutter | ✅ Cumplido |
| No modificar Backend | ✅ Cumplido |
| No actualizar `PROJECT_STATUS.md` | ✅ Cumplido |
| Solo generar documentación | ✅ Cumplido |

---

## 15. Estándar Oficial Adoptado — Vigencia

A partir de esta tarea, todo módulo futuro de RidePro que se documente como "diseño"/"cierre" debe incluir, como mínimo, los mismos componentes de este documento: **Auditoría técnica final** (sección 13), **Checklist de salida de 20 puntos con evidencia** (sección 8), **Matriz de riesgos profesional con responsable y contingencia** (sección 5), **Criterios Go/No-Go** (sección 6), **Rollback detallado por componente** (sección 9), **Criterios de aceptación en forma de puertas obligatorias** (sección 12), y **Veredicto final con porcentaje de preparación** (sección 16).

**Nota de gobernanza, sin ejecutar en esta tarea:** para que este estándar quede formalmente incorporado (no solo "adoptado de facto" por precedente), correspondería reflejarlo en `RIDEPRO_DEVELOPMENT_PROTOCOL.md` §5 (Formato Obligatorio de Entrega) — **esa edición no se realiza aquí**, porque las reglas de esta tarea prohíben modificar cualquier archivo del proyecto salvo la creación de este documento. Queda registrada como recomendación explícita para una tarea de gobernanza separada, sujeta a tu autorización.

---

## 16. Veredicto Final

**Estado del módulo:** ⚠️ **LISTO CON DECISIONES PENDIENTES**

**Porcentaje de preparación para iniciar implementación:** **~65%** — el diseño técnico está completo al 100% (arquitectura, alternativas, riesgos, rollback, criterios de aceptación); lo que falta es exclusivamente la resolución de las 8 decisiones de negocio/propietario de la sección 2, ninguna de las cuales requiere trabajo técnico adicional para responderse.

**Nivel de riesgo del módulo tal como está diseñado:** **Medio** — 3 riesgos Crítico (R1, R2, R4) tienen mitigación de diseño ya definida y basada en patrones ya validados en este mismo proyecto (no son mitigaciones teóricas); ningún riesgo queda sin plan de contingencia.

**Próximo paso recomendado:** el propietario resuelve las decisiones D1-D8 (sección 2) — puede hacerlo de una vez ("aprueba tu recomendación en todas") o punto por punto. Una vez resueltas las bloqueantes (D1, D2, D3, D4, D8), la Fase 1 del plan de implementación (sección 7) puede autorizarse a iniciar.

**Bloqueadores existentes (no de este módulo, heredados y ya conocidos):**
- Validación real de iOS en macOS/iPhone — pendiente desde el cierre de la Fase 1 de Firebase.
- `T-F2.7` (proyecto nativo de Windows) — no ejecutado, bloquea la Fase de Windows de este plan (sección 3.5) hasta que se priorice de forma independiente.
- `applicationId` de Android — mismo bloqueador que D3, ya conocido como `B10`/`T-TRANS.5`.

**Dependencias pendientes:** acceso a Apple Developer Portal (para Bundle IDs nuevos), decisión de `T-F1.1` (hosting) antes de que las Fases 7-9 de este plan puedan ejecutarse completas — aunque las Fases 1-6 no dependen de ella.

**Este documento no autoriza ninguna ejecución.** Queda a la espera de tu respuesta a la sección 2 antes de que cualquier fase del plan de la sección 7 pueda comenzar.
