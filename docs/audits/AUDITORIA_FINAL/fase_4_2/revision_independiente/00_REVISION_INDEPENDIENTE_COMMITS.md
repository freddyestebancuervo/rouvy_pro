# Revisión independiente — commits 789d925, 91c97a1, b02f065

**Método**: estrictamente de solo lectura (`git show`, `git diff`, `git log`,
lectura de código y de `node_modules/@nestjs/throttler` fuente). Ningún
archivo de código o prueba fue modificado para producir esta revisión.
Ningún `git add`/`commit`/`push`/`merge`/`rebase`/`reset`/`stash`/`tag` se
ejecutó en esta revisión ni en la fase que audita.

**Alcance**: los 3 commits de Fase 4.2 Parte 2 / Fase 4.2.1, ya creados en
`feature/d2` local (sin push):

| Commit | Mensaje | Archivos |
|---|---|---|
| `789d925` | `fix(auth): prevent pool self-deadlock and handle temporary database saturation` | 7 (1 nuevo, 6 modificados) |
| `91c97a1` | `feat(auth): apply hybrid Firebase exchange rate limiting` | 5 (5 modificados) |
| `b02f065` | `docs(audits): document database capacity and hybrid rate limit validation` | 11 (11 nuevos) |

## Resumen del veredicto

Los 3 commits son **técnicamente sólidos y seguros para permanecer en
`feature/d2` local**. Se identificaron 2 gaps reales de severidad acotada
(H1, H2), registrados abajo como deuda técnica conocida, no bloqueante. Se
identificó además una consideración de proceso (H3, no un defecto de
código) sobre el alcance real de un futuro `push`/PR desde esta rama.

---

## H1 — `UPDATE` de usuario existente sin recuperación de `23505` (deuda técnica, no bloqueante)

**Severidad**: Media.

**Ubicación**: `backend/src/modules/users/users.repository.ts`, método
`upsertByFirebaseUid`, rama `if (byUid) { ... }` (líneas ~287-309 al momento
de esta revisión) — específicamente la sentencia `UPDATE users SET email =
...` ejecutada vía `this.pool.query(...)`.

**Impacto**: si Postgres rechaza el `UPDATE` con un `23505`
(`users_email_lower_unique`), el error crudo de `pg` (con `.code` presente)
se propaga sin capturar. No matchea `isPoolConnectionTimeout` (exige
ausencia de `.code`), no es una `ApiException`/`HttpException`, así que
`ApiExceptionFilter` lo clasifica como `500 INTERNAL_SERVER_ERROR` genérico
en vez del `409 FIREBASE_EMAIL_CONFLICT` que el resto del método ya
garantiza en los demás caminos de conflicto de email.

**Condición de ocurrencia**: requiere una carrera muy específica —
dos requests concurrentes, cada uno para una identidad Firebase **ya
existente** en la base (`byUid` verdadero en ambos), donde ambos cambian su
email al mismo valor exactamente en la ventana entre el `SELECT` de
`findIdentityCandidates` (línea 285) y este `UPDATE` (línea ~296). Distinto
del camino de "usuario nuevo" (`INSERT`), que sí tiene manejo explícito de
`23505` en su bloque `catch` (líneas ~340-383, sin cambios respecto a Fase
4.1). Preexistente desde Fase 4.1 — el `UPDATE` nunca tuvo este manejo; no
fue introducido ni corregido por el fix del self-deadlock de Fase 4.2.1
(que solo tocó la rama de colisión del `INSERT`). No cubierto por ningún
test unitario o e2e existente.

**Recomendación futura**: envolver el `UPDATE` en un `try/catch` que
detecte `23505` sobre `users_email_lower_unique`/`users_email_unique` (vía
`isPgUniqueViolation`/`pgConstraintName`, ya existentes en
`pg-error.util.ts`) y traduzca a `FirebaseEmailConflictError`, con el mismo
criterio ya usado en el camino de `INSERT`. Requeriría un test unitario
nuevo simulando el `23505` en esta rama específica. No implementado en
esta revisión — queda como trabajo futuro, sin autorización para tocarlo
todavía.

---

## H2 — Cardinalidad no acotada de la Capa 2 del rate limit (deuda técnica, no bloqueante)

**Severidad**: Baja-media.

**Ubicación**: `ThrottlerStorageService` (`node_modules/@nestjs/throttler`,
sin modificar por este proyecto) combinado con las claves nuevas de Capa 2
(`firebase-exchange-uid:<sha256(uid)>`) introducidas en
`backend/src/modules/auth/auth.service.ts`.

**Impacto**: `ThrottlerStorageService` nunca hace `Map.delete(key)` sobre
su almacenamiento interno — solo decrementa contadores vía `setTimeout`.
Cada clave nueva vista permanece en el `Map` del proceso indefinidamente.
La Capa 1 preexistente (por IP) ya tenía esta característica, pero acotada
por la cantidad de IPs distintas que golpean la instancia. La Capa 2 nueva
usa una clave por **usuario verificado distinto** — en un proceso de vida
larga con una base de usuarios grande, el `Map` interno crece
proporcional al total acumulado de usuarios únicos que alguna vez llamaron
`exchange` en esa instancia, no a la cantidad de IPs. Es un crecimiento de
memoria lento, no una fuga aguda.

**Condición de ocurrencia**: se manifestaría solo en una instancia de
Cloud Run con vida inusualmente larga y un volumen alto de usuarios
distintos — mitigado en la práctica por el ciclo de vida normal de Cloud
Run (instancias no viven indefinidamente, `minScale=0` permite
scale-to-zero) y por el hecho ya documentado de que el estado se pierde en
cada redeploy/reinicio. No se observó en ninguna de las pruebas locales de
Fase 4.2 (volumen de prueba insuficiente para manifestarlo).

**Recomendación futura**: si el volumen de usuarios reales crece
significativamente y las instancias empiezan a vivir más tiempo del
esperado, reconsiderar R3 (almacenamiento compartido tipo Redis, ya
documentado como diferido en `07_DISENO_RATE_LIMIT_HIBRIDO.md` §7.5) no
solo por el problema de contadores por instancia ya conocido, sino también
por este ángulo de cardinalidad. Vale la pena agregar esta consideración
explícita a `07_DISENO_RATE_LIMIT_HIBRIDO.md` en una futura revisión de esa
documentación — no se modificó en esta revisión (fuera del alcance
autorizado: solo se autorizó escribir el informe nuevo, no editar los docs
06-10 ya comiteados).

---

## H3 — Alcance real de un futuro push/PR (decisión de proceso pendiente, NO un defecto de código)

**Estado explícito: no se autoriza todavía ningún `git push`, Pull Request,
`merge`, `rebase`, `cherry-pick` ni creación de rama nueva.** Esta sección
es informativa, para que la decisión se tome con datos reales cuando
corresponda — no implica ni recomienda ejecutar ninguna de esas acciones
ahora.

**Dato verificado** (`git log`/`git diff` de solo lectura,
`origin/main` y `origin/feature/d2` tal como estaban al momento de esta
revisión, sin hacer `git fetch` real):

```
git log --oneline origin/main..feature/d2   → 19 commits
git diff --stat  origin/main..feature/d2    → 144 archivos, +19184 / -318
git log --oneline origin/feature/d2..feature/d2 → 3 commits (789d925, 91c97a1, b02f065)
```

De los 144 archivos que un futuro PR `feature/d2` → `main` mostraría, solo
**~24 (≈17%)** pertenecen a Fase 4.2/Fase 4.2.1 (los 7+5+11+1 de esta
sesión). El **≈83% restante (~120 archivos)** corresponde a los otros 16
commits ya presentes en `feature/d2` — no relacionados con esta fase: el
feature Workouts completo (D2), fixes de CORS/seguridad, fixes de CI, el
puente de autenticación Firebase → NestJS → PostgreSQL, dockerización del
backend.

**Distinción importante**: un simple `git push` (sin PR) solo subiría los 3
commits nuevos a `origin/feature/d2` (que ya tiene los otros 16) — la
consideración de "alcance mezclado" aplica específicamente a un eventual
**Pull Request hacia `main`**, no al push en sí.

**Implicación, sin recomendación de acción**: si en el futuro se decide
abrir un PR desde `feature/d2` hacia `main` tal cual está, ese PR no sería
revisable como "el fix de Fase 4.2" — combinaría meses de trabajo no
relacionado en una sola revisión. Las alternativas (aislar Fase 4.2 en una
rama separada, PR incremental, o aceptar el bundling) son una decisión que
corresponde al usuario, no a esta auditoría.

---

## Verificado correcto (sin hallazgos)

- **Self-deadlock** (`users.repository.ts`, rama de recuperación de
  `23505` del `INSERT`): genuinamente resuelto. El re-query ahora usa
  `client.query(...)` (la conexión ya retenida por `pool.connect()`), no
  `this.findByFirebaseUid(...)` (que internamente pedía una conexión NUEVA
  del mismo pool). No queda ningún punto donde el código, reteniendo una
  conexión, necesite otra del mismo pool para progresar.
- **SQL**: 100% parametrizado (`$1`, `$2`, ...) en los 3 commits — cero
  concatenación dinámica de strings en ninguna sentencia nueva o
  modificada.
- **Manejo de `23505` en el camino de `INSERT`**: intacto respecto a Fase
  4.1 — solo 3 constraints exactas (`users_firebase_uid_unique`,
  `users_email_unique`, `users_email_lower_unique`) habilitan la
  recuperación; cualquier otro `23505` (constraint ajena) o cualquier otro
  código SQLSTATE se propaga sin capturar.
- **Clasificación `503`** (`isPoolConnectionTimeout`): exige coincidencia
  exacta del mensaje de `pg-pool` Y ausencia total de `.code` — no existe
  ningún error real de Postgres (que siempre trae `.code`) que pueda
  matchear por error. `Math.ceil(uidRecord.timeToBlockExpire)` es
  redundante (verificado en el código fuente de
  `node_modules/@nestjs/throttler/dist/throttler.service.js`:
  `getBlockExpirationTime` ya aplica `Math.ceil(.../1000)` antes de
  devolver el valor) pero inofensivo — no produce ningún valor incorrecto
  en el header `Retry-After`.
- **Inyección de `ThrottlerStorage` en `AuthService`**: resoluble en
  producción sin ningún cambio a `AuthModule` — `ThrottlerModule.forRoot()`
  se registra como módulo global en `AppModule`
  (`@nestjs/throttler`), mismo mecanismo que ya usaba
  `RefreshThrottleGuard` (preexistente) para el mismo tipo de inyección.
  Confirmado además empíricamente: las 86/86 pruebas e2e reales
  (`createTestApp`, que compila el `AppModule` real) pasan sin error de
  resolución de dependencias — si la inyección estuviera rota, el módulo
  no arrancaría.
- **`ThrottlerStorageService.increment`**: declarado `async` pero sin
  ningún punto de cesión real dentro (sin `await` de una operación
  asíncrona genuina) — confirmado por lectura directa del código fuente.
  No existe interleaving posible entre llamadas concurrentes a la misma
  clave; el conteo de hits y el chequeo de bloqueo son atómicos respecto
  al event loop de Node.
- **Privacidad del rate limit**: ningún `firebase_uid`, email o token en
  claro en ninguna clave de `ThrottlerStorage` ni en ningún log agregado
  por estos commits — Capa 2 usa `sha256(uid)`, Capa 3 usa la IP (dato no
  sensible en el mismo sentido, uso ya documentado como decisión
  explícita).
- **Pruebas**: cobertura sólida y honesta para todo el código que cambió;
  ningún test fue debilitado para forzar verde en ninguno de los 3
  commits (verificado por lectura completa de los diffs de test, no solo
  por confianza en el reporte previo).
- **Documentación** (`b02f065`): internamente consistente; corrige de
  forma transparente su propia hipótesis anterior incorrecta (ver
  `08_RESULTADOS_PRUEBAS_LOCALES.md` §8.3, marcada explícitamente como
  corrección de registro, no borrada ni reescrita en silencio). Sin
  secretos, tokens, connection strings, correos reales ni `firebase_uid`
  completos — confirmado por grep dirigido sobre los 11 archivos.

---

## Alcance de lo NO hecho en esta revisión

No se modificó ningún archivo de código de producción ni de pruebas. No se
ejecutó `git add`, `git commit`, `git push`, `git merge`, `git rebase`,
`git cherry-pick`, `git reset`, `git stash`, `git tag`, ni se creó ninguna
rama nueva. No se desplegó nada, no se tocó Cloud Run, Cloud SQL, Firebase
real ni IAM. Esta revisión es exclusivamente el archivo de documentación
que la contiene.
