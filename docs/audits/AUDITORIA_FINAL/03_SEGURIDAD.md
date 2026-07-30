# RidePro — Documento Maestro de Arquitectura
## Documento 3 de 9: Seguridad

- **Fecha:** 2026-07-24 · **Rama/HEAD:** `feature/d2` / `d3d01d8`
- **Método:** inspección directa de código de seguridad (JWT, CORS, Firestore rules, validación, rate limiting, manejo de secretos, CI) — no un pentest activo ni un escaneo de dependencias con herramienta automatizada (ver sección 9, no verificado). Se apoya en `docs/SECURITY_AUDIT.md` (auditoría previa que corrigió una vulnerabilidad crítica en Firestore rules el 2026-07-21) sin duplicarla.
- **No se modifica código en este documento.**

---

## 1. Autenticación

| Sistema | Mecanismo | Evidencia | Estado |
|---|---|---|---|
| Firebase Auth (app principal) | SDK oficial, JWT firmado por Google, RS256, renovación automática | Estándar de la industria, gestionado por Google | ✅ |
| NestJS (backend propio) | JWT RS256 propio, claves desde archivo (`JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH`), nunca hardcodeadas | `backend/src/jwt/token.service.ts:29-36` — **falla explícito al arrancar** (`throw new Error(...)`) si las rutas de clave no están definidas, no falla en silencio ni usa un default inseguro | ✅ |
| Puente entre ambos | **No existe** | `lib/core/config/dev_backend_test_user.dart` | 🔴 Ver Documento 1/7, hallazgo H1 |

**TTL y claims:** access token con TTL configurable (`JWT_ACCESS_TOKEN_TTL_SECONDS`, default 3600s), `iss`/`aud` verificados (`https://api.ridepro.app` / `ridepro-mobile` por defecto, sobreescribibles por entorno) — evita que un token emitido para otro propósito/audiencia sea aceptado.

## 2. Tokens y Refresh Tokens

- **Refresh tokens opacos** (no JWT), persistidos en Postgres, con **rotación obligatoria y detección de reuso**: si un refresh token ya rotado se reutiliza, se revocan todos los tokens activos del usuario — defensa estándar contra robo de token vía replay, ya implementada (`backend/src/modules/refresh-tokens/refresh-tokens.repository.ts:86`, comentario explícito "revoca TODOS los tokens activos del usuario, forzando").
- **Almacenamiento en el cliente:** `flutter_secure_storage` (Keychain/Keystore/DPAPI según plataforma) — nunca `shared_preferences` para tokens, verificado por el nombre y uso de `BackendSessionStore`.
- **Transporte:** `Authorization: Bearer <token>` (`lib/core/network/backend_dio_client.dart:35,57`) — **no se usan cookies para sesión**, lo que descarta CSRF como vector aplicable a este backend (ver sección 5).
- **Rate limit dedicado a `/auth/refresh`:** 20 req/15min **por token**, no por IP (`refresh-throttle.guard.ts`) — correcto, porque el refresh token es la credencial: limitar solo por IP dejaría sin protección a un token robado usado desde una IP distinta a la del límite.

## 3. Permisos y Roles

| Aspecto | Estado | Evidencia |
|---|---|---|
| Autorización por ownership (backend) | ✅ | `assertOwned()` — patrón "404, no 403" (no confirma la existencia de un recurso ajeno), reutilizado por `equipment`/`workouts` |
| Roles declarados | 🟡 Existen, sin consumo real todavía | `roles`/`user_roles` (Postgres), `role` (Firestore) — ningún endpoint/regla condiciona comportamiento por rol más allá de `premium` como enum simple |
| Principio de menor privilegio (CI) | 🟡 Mejorable | `.github/workflows/ci.yml` no declara un bloque `permissions:` explícito — usa el default del repositorio/organización en vez de acotar explícitamente a `contents: read`. Impacto real bajo hoy (el workflow no publica ni escribe nada), pero es una corrección de una línea con beneficio de defensa en profundidad |

## 4. Firestore Rules

Leídas completas (`firestore.rules`, 106 líneas). **Deny-by-default correcto:**

- Regla catch-all al final (`match /{document=**} { allow read, write: if false; }`) — cualquier colección nueva que alguien olvide proteger queda cerrada por defecto, no abierta.
- `users/{uid}`: lectura/escritura solo por el propio dueño (`isOwner(uid)`); **campos protegidos** (`role`, `permissions`, `subscription`, `isAdmin`, `customClaims`, `premium`) no pueden fijarse a un valor no seguro en `create` (`_hasSafeDefaultsOnCreate`) ni modificarse en absoluto en `update` (`_protectedFieldsUnchanged`, comparando `resource.data` contra `request.resource.data`) — cierra exactamente el vector de "un cliente se autoasigna `role: admin`".
- `ride_sessions`: append-only real a nivel de reglas (`allow update: if false; allow delete: if false;`), no solo por convención de la app.
- Sin `allow delete` directo en `users/{uid}` — el borrado de cuenta requiere Cloud Function con Admin SDK (fuera del alcance de este documento verificar si esa función existe; ver sección 9).
- **28/28 tests de reglas en verde** (`firebase/rules-tests`), citado en Documento 1 — no re-ejecutado en esta pasada, se toma como válido por no haber cambios de código.

**Veredicto: sólido.** Es, junto con el manejo de JWT, el área de mejor calidad de seguridad del proyecto.

## 5. Vectores web clásicos

| Vector | Aplicabilidad | Estado |
|---|---|---|
| **SQL Injection** | Backend usa `pg.Pool` directo | ✅ **Sin riesgo encontrado** — verificado que ninguna consulta interpola variables directamente en un template literal SQL (`grep` de `query(\`...${`); todas las consultas revisadas usan parámetros posicionales (`$1`, `$2`, ...) |
| **XSS** | Flutter no renderiza HTML/JS de terceros; sin `webview_flutter` ni paquete equivalente en `pubspec.yaml` | ✅ Superficie mínima — no hay vector de XSS clásico sin un WebView que no existe |
| **CSRF** | Requiere autenticación por cookie para ser explotable | ✅ **No aplicable** — autenticación 100% por header `Authorization: Bearer`, nunca por cookie (sección 2) |
| **Mass assignment** | Backend NestJS | ✅ `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` global (`backend/src/main.ts:61-63`) — cualquier campo no declarado en el DTO se descarta y la request se rechaza si llega uno extra, no se ignora en silencio |
| **Escalación de privilegios vía Firestore** | Cliente podría intentar fijar `role`/`premium` directamente | ✅ Cerrado por reglas (sección 4) |
| **Headers de seguridad HTTP** | Backend NestJS | ✅ `helmet` instalado y aplicado (`backend/src/main.ts:27`, `helmet({...})`) |

## 6. Rate Limiting

- **Global (respaldo):** 100 req/60s por IP (`ThrottlerModule.forRoot`), aplicado como `APP_GUARD` — protege por defecto cualquier endpoint que no declare un límite propio, incluso los que sí lo declaran (defensa en profundidad, documentado explícitamente en `app.module.ts`).
- **Específico:** `/auth/refresh` 20/15min por token (sección 2); otros endpoints de auth usan `@Throttle()` por ruta (mencionado en el comentario de `app.module.ts`, no verificado línea por línea el valor exacto de cada uno en esta pasada).
- **🟡 Hallazgo de escalabilidad con implicación de seguridad:** el `ThrottlerStorage` es **en memoria** (comentario propio del código: "mismo backend en memoria hoy, intercambiable por Redis en producción"). Con más de una instancia del backend corriendo detrás de un balanceador de carga, cada instancia lleva su propio contador — un atacante distribuido entre instancias puede superar el límite efectivo real (p. ej., con 3 instancias, el límite real practicable es ~3x el nominal). **No es un problema hoy** (no hay evidencia de despliegue con más de una instancia — de hecho no hay despliegue en absoluto, ver Documento 1 sección 6), pero es una limitación a resolver **antes** de escalar horizontalmente el backend. Ver Documento 5 (Escalabilidad).

## 7. Logs

- **Sin hallazgos de datos sensibles en logs**: búsqueda dirigida de `console.log`/`console.error`/`console.warn` con `password`/`token`/`secret` en el cuerpo del mensaje, en `backend/src` y `lib` → sin resultados.
- **Sin logging estructurado adoptado** (`logger` package declarado, cero uso — ver Documento 2 sección 2.6) — esto es una deuda de observabilidad, no una vulnerabilidad activa: significa que hoy, si algo sale mal en producción, no hay una fuente centralizada de logs con niveles/contexto más allá de lo que Crashlytics capture del lado cliente y la salida estándar de Nest del lado servidor.

## 8. Secretos, API Keys y variables de entorno

| Fuente | Mecanismo | Estado |
|---|---|---|
| Backend (`DATABASE_URL`, claves JWT, credenciales QA) | `backend/.env` (gitignored) + `.env.example` versionado | ✅ |
| Cliente Flutter (credenciales QA, flags) | `dart_define.local.json` (gitignored) + `.example` versionado | ✅ |
| Claves JWT | Archivos `.pem` fuera del repo, rutas via variable de entorno | ✅ |
| Config pública de Firebase (`apiKey`, `projectId`) | `firebase_options.dart`, `google-services.json`, versionados | ✅ Correcto — no es secreto por diseño de Firebase (protegido por Security Rules, no por ocultamiento); confirmado que `.gitignore` línea 108-110 cubre `*.env`/`.env.*` con excepción explícita de `*.env.example` |
| **Historial de git** | Contraseñas QA hardcodeadas en commits **anteriores** a la sesión del 2026-07-23 que las corrigió | 🟠 **Pendiente, requiere autorización explícita del propietario para reescribir historial** — ya documentado en auditorías previas, reconfirmado acá: no se ejecuta sin decisión explícita (reescribir historial es una operación irreversible/de alto impacto sobre cualquier clon existente del repo) |

**Ningún secreto real fue encontrado hardcodeado en el código inspeccionado en esta pasada** (más allá del hallazgo ya conocido y corregido de credenciales QA, y su remanente en el historial de git).

## 9. CI/CD, GitHub Actions, Docker

- **CI (`ci.yml`):** 3 jobs reales, corren contra Postgres real y emulador de Firestore. **Sin paso de escaneo de secretos** (`gitleaks`/`git-secrets`/`trufflehog`) — recomendado, no implementado (ya señalado en documentación previa del proyecto, fuera de esta serie). **Sin bloque `permissions:` explícito** (sección 3) — impacto bajo hoy, corrección barata.
- **Docker:** no existe ningún `Dockerfile`/`docker-compose.yml` en el repositorio — sin superficie de seguridad de contenedores que auditar (ni buena ni mala: simplemente no existe todavía). El uso de Postgres en CI es vía el servicio gestionado de GitHub Actions (`services: postgres:16`), no una imagen propia.
- **Sin pipeline de CD** — ningún despliegue automatizado a ningún entorno, por lo que no hay superficie de "credenciales de despliegue mal configuradas" que auditar todavía (consistente con que tampoco existe infraestructura de staging/producción real, Documento 1 sección 6).

## 10. Separación de entornos (el riesgo crítico ya identificado)

**Reconfirmado sin cambios desde la auditoría previa:** un único proyecto Firebase (`ridepro-dbafe`, `.firebaserc`) sirve como "desarrollo" y como lo que sería "producción" a la vez. No es una vulnerabilidad explotable por un tercero — es una ausencia de aislamiento que hace que cualquier dato de prueba conviva con datos reales, sin forma de purgar QA sin arriesgar datos de producción. **Severidad: Crítica, pero no de remediación de emergencia** (no hay explotación activa posible por un atacante externo hoy — es una decisión de infraestructura pendiente, con costo real, que requiere autorización del propietario). Ver Documento 7 para la clasificación final de riesgo consolidada.

## 11. Resumen de severidades — este documento

| # | Hallazgo | Severidad |
|---|---|---|
| S1 | Un único proyecto Firebase para todos los entornos | **Crítico** (requiere decisión/presupuesto del propietario) |
| S2 | Auth dual sin puente (H1, ya documentado) — impide operar Workouts de forma segura con usuarios reales | **Alto** |
| S3 | `ThrottlerStorage` en memoria — rate limit efectivo se diluye con más de una instancia del backend | **Medio** (hoy sin impacto real, sin despliegue multi-instancia) |
| S4 | Credenciales QA viejas en historial de git anterior a 2026-07-23 | **Medio** (requiere autorización para reescribir historial) |
| S5 | `audit_log` sin escritura real — sin trazabilidad forense de acciones críticas | **Medio** |
| S6 | Sin escaneo de secretos en CI | **Bajo** |
| S7 | Sin bloque `permissions:` explícito en GitHub Actions | **Bajo** |
| S8 | Sin logging estructurado (deuda de observabilidad, no vulnerabilidad activa) | **Bajo** |

**Ningún hallazgo de seguridad activo y explotable hoy por un tercero externo fue encontrado en esta pasada** — los de severidad Crítica/Alta son de infraestructura (aislamiento de entornos) y de alcance funcional (auth dual), no vulnerabilidades de código en el sentido clásico (inyección, XSS, auth bypass).

---

## 12. Criterios de aprobación de este documento

- [x] Cubre todos los ejes pedidos: JWT, tokens, refresh tokens, permisos, roles, Firestore rules, Postgres, SQL injection, XSS, CSRF, rate limit, logs, secrets, API keys, variables de entorno, CI/CD, GitHub Actions, Docker.
- [x] Cada hallazgo con evidencia de archivo/línea o comando.
- [x] Severidad asignada y justificada para cada hallazgo.
- [ ] **No cumplido — pendiente, declarado explícitamente:** sin escaneo automatizado de vulnerabilidades de dependencias (`npm audit`, `dart pub outdated --mode=null-safety` con CVEs, o equivalente) ejecutado en esta pasada — ver sección 13.

## 13. No verificado en este documento

1. **`npm audit` / escaneo de CVEs en dependencias** (backend Node y paquetes Flutter/pub.dev) — no ejecutado en esta pasada; recomendado antes de cualquier release público.
2. **Existencia real de la Cloud Function de borrado de cuenta** (soft delete de 30 días mencionado en el comentario de `firestore.rules:59-61`) — no se verificó si el código de esa función existe en el repo o es solo la intención de diseño.
3. **Valores exactos de `@Throttle()` por ruta** en `auth.controller.ts` más allá de `/refresh` — se citó el comentario de `app.module.ts` que los menciona, no se leyó cada decorador línea por línea.
4. **Pentest activo / fuzzing de endpoints** — este documento es una revisión de código estático, no una prueba de penetración dinámica.
5. **Rotación real de historial de git (S4)** — no ejecutada, requiere autorización explícita.

**Siguiente documento:** Documento 4 — Rendimiento.
