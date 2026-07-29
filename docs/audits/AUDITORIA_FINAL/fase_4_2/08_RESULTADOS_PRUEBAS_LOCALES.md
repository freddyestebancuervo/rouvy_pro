# 8. Resultados de pruebas locales — Fase 4.2 Parte 2

Entorno: Postgres 16 efímero en Docker local (`ridepro-postgres`,
recreado desde cero, 5 migraciones aplicadas en orden), `DATABASE_POOL_MAX`
en su default (`10`, sin tocar), `FirebaseTokenVerifierService` mockeado
(mismo criterio que toda la suite e2e existente). Ninguna prueba de esta
sección tocó Cloud SQL, Cloud Run ni ningún recurso de GCP.

## 8.1 Build / lint / unit / e2e

| Verificación | Resultado |
|---|---|
| `npm run build` | **Limpio**, sin errores (verificado 3 veces tras cada tanda de cambios) |
| `npm run lint` | **Limpio**, sin errores ni warnings nuevos |
| `npm test` (unitarias) | **122/122 pasaron** (11 suites) — incluye los tests reescritos de `users.repository.spec.ts` (7→11, ver 8.2) y los nuevos de `pg-error.util.spec.ts`, `api-exception.filter.spec.ts` (nuevo archivo) y `auth.service.spec.ts` (+5 tests de rate limit) |
| `npm run test:e2e` (Postgres efímero real) | **84/86 pasaron** (12/14 suites) — ver 8.3 para los 2 fallos, ambos preexistentes y no relacionados con esta fase |

## 8.2 Tests unitarios reescritos/nuevos (detalle)

`users.repository.spec.ts` se reescribió por completo (no se debilitó
ningún caso, se ganaron 4 nuevos) porque la consulta combinada
(`findIdentityCandidates`) cambia la forma observable de las llamadas a
`pool.query` (antes 2 consultas secuenciales distintas, ahora 1) — los
mocks de la Fase 4.1 asumían la forma vieja. Casos cubiertos ahora (11
tests, antes 7):

- Encontrado por `firebase_uid` → `UPDATE`, sin transacción.
- Encontrado por `firebase_uid` + email de OTRA cuenta → conflicto, sin `UPDATE` ni transacción (caso nuevo, cierra el bug latente descrito en [06](06_DISENO_OPTIMIZACION_EXCHANGE.md)).
- No encontrado por `firebase_uid`, email de cuenta con UID distinto → conflicto.
- No encontrado por `firebase_uid`, email de cuenta legacy (UID `NULL`) → conflicto.
- Usuario nuevo (ni uid ni email) → transacción completa, `isNew:true`.
- Colisión `23505` en las 3 constraints conocidas → recuperación idéntica a Fase 4.1.
- `23505` en constraint ajena a `users` → se propaga sin capturar.
- Error no-`23505` → se propaga sin capturar.
- Timeout de adquisición del pool al pedir la conexión de la transacción → se propaga tal cual (no se traduce acá, eso es responsabilidad del filtro global).

`pg-error.util.spec.ts`: +4 tests para `isPoolConnectionTimeout` (mensaje
exacto sin `.code` → `true`; mensaje similar pero no idéntico → `false`;
mismo mensaje pero CON `.code` real de Postgres → `false`; valores no-`Error` → `false`).

`api-exception.filter.spec.ts` (archivo nuevo, no existía): 6 tests —
traducción a 503 con `Retry-After`, error real de Postgres con el mismo
texto de mensaje pero con `.code` NO se traduce (cae al 500 genérico), error
de programación cualquiera sigue devolviendo 500 sin stack trace crudo,
`ApiException.retryAfterSeconds` agrega/omite el header `Retry-After`
correctamente, `HttpException` nativa (p. ej. `ThrottlerException`) se
mapea sin exponer su mensaje interno.

`auth.service.spec.ts`: +5 tests de rate limit híbrido — Capa 2 bloqueada
(429 + `retryAfterSeconds` exacto, sin tocar la base), clave de Capa 2
nunca contiene el UID en texto plano, Capa 3 bloqueada cuando Capa 2 no lo
está, camino feliz sin cambios, dos identidades distintas usan claves de
Capa 2 independientes (una bloqueada no afecta a la otra).

`auth-firebase-exchange-rate-limit.e2e-spec.ts`: el test existente de "20
requests, mismo `firebase_uid` → bloquea en el 21" se mantiene (ahora
documentado como ejercitando Capa 2, no Capa 1 — el límite de 20 coincide
por diseño con `FIREBASE_EXCHANGE_UID_LIMIT`), y se agregó un test nuevo
("30 identidades nuevas seguidas desde la misma IP, ninguna bloqueada") que
ejercita directamente el escenario de gimnasio a nivel e2e.

## 8.3 Los 2 fallos de `test:e2e` — causa raíz real (corregido, ver Fase 4.2.1)

> **Corrección de registro**: la hipótesis original de esta sección
> ("latencia del Postgres local, Docker Desktop/Windows") quedó **refutada**
> por evidencia directa en Fase 4.2.1 (ver
> [10_FASE_4_2_1_ESTABILIZACION_E2E.md](10_FASE_4_2_1_ESTABILIZACION_E2E.md)).
> La causa real era un **self-deadlock en `UsersRepository.upsertByFirebaseUid`**
> (código de producción, presente desde Fase 4.1), ya corregido. Se deja el
> texto original de este apartado tachado conceptualmente pero sin borrar,
> para que el registro de cómo se investigó quede íntegro — el documento 10
> tiene el detalle completo y es la referencia autoritativa.

`auth-firebase-exchange-concurrency-new-user.e2e-spec.ts` y
`auth-firebase-exchange-concurrency-two-users.e2e-spec.ts` (ambos de Fase
4.1, sin tocar en esta fase) fallaban en este entorno local con varios `503`
(antes de esta fase habrían sido `500` genéricos, ya que
`isPoolConnectionTimeout` no existía) al disparar 20/16 requests
concurrentes reales contra el Postgres efímero local
(`DATABASE_POOL_MAX=10`).

Verificación explícita de que no era una regresión de Fase 4.2 Parte 2: se
revirtió temporalmente `users.repository.ts` a la versión de Fase 4.1
(`git stash`) y se re-ejecutaron los mismos 2 archivos — fallaban
exactamente igual. Esto ya indicaba (correctamente) que el problema era
anterior a Parte 2, pero la hipótesis sobre CUÁL era la causa (latencia del
entorno) resultó ser incorrecta — la causa real es un bug estructural de
concurrencia independiente del entorno, ver documento 10.

## 8.4 Parte G — prueba local escalonada (1, 5, 8, 10, 15, 20 concurrentes)

Ejecutada con un script temporal (no commiteado, borrado tras recolectar
esta evidencia), contra el mismo Postgres efímero, `DATABASE_POOL_MAX=10`
sin tocar. Verificación por nivel: cero `500` genéricos, cero filas
duplicadas (`SELECT` por `firebase_uid` tras cada nivel), limpieza exacta
por UUID al final de cada escenario.

### Escenario A — usuario nuevo (misma identidad concurrente, UID distinto por nivel)

| Nivel | 200 | 503 | p50 | p95 | p99 | pico conexiones esperando | pico conexiones totales | Filas creadas |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 0 | 67ms | 67ms | 67ms | 0 | 1 | 1 |
| 5 | 5 | 0 | 38ms | 39ms | 39ms | 0 | 5 | 1 |
| 8 | 8 | 0 | 41ms | 54ms | 54ms | 1 | 10 | 1 |
| 10 | 10 | 0 | 40ms | 42ms | 42ms | 8 | 10 | 1 |
| 15 | 5 | 10 | 5029ms | 5060ms | 5060ms | 15 | 10 | 1 |
| 20 | 5 | 15 | 5046ms | 5077ms | 5078ms | 20 | 10 | 1 |

Cero duplicados en los 6 niveles (siempre 1 fila por `firebase_uid`, sin
importar cuántas de las N solicitudes concurrentes compitieran). Cero `500`
genéricos en ningún nivel. La saturación aparece exactamente donde se
espera (justo por encima de la capacidad del pool, `DATABASE_POOL_MAX=10`)
y se clasifica correctamente como `503`, nunca como error genérico.

### Escenario B — usuarios distintos compartiendo IP (un `firebase_uid` nuevo por request)

| Nivel | 200 | 503 | p50 | p95 | p99 | pico conexiones esperando | pico conexiones totales | Filas creadas |
|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 0 | 85ms | 85ms | 85ms | 0 | 1 | 1 |
| 5 | 5 | 0 | 84ms | 87ms | 87ms | 0 | 5 | 5 |
| 8 | 8 | 0 | 56ms | 74ms | 74ms | 0 | 8 | 8 |
| 10 | 10 | 0 | 35ms | 53ms | 53ms | 0 | 10 | 10 |
| 15 | 15 | 0 | 57ms | 59ms | 59ms | 5 | 10 | 15 |
| 20 | 20 | 0 | 66ms | 68ms | 69ms | 10 | 10 | 20 |

**Cero `503` en los 6 niveles, incluso a 20 concurrentes** — a diferencia
del Escenario A, identidades distintas nunca compiten por el mismo bloqueo
de índice único, así que aunque el pool llegue a su capacidad máxima
(pico total = 10 en el nivel 20), nunca se agota el `connectionTimeoutMillis`.
Cero duplicados (61 filas creadas en total across niveles, cada una con un
`firebase_uid` distinto, verificado sin colisiones). Limpieza confirmada:
las 61 filas (`users` + `user_roles`) se eliminaron por UUID exacto al
finalizar.

**Lectura combinada de A y B**: el cuello de botella real no es "20
requests concurrentes" en general — es específicamente la contención de
Postgres sobre la MISMA fila/clave única cuando muchas solicitudes
compiten por crear la misma identidad nueva simultáneamente (Escenario A).
El escenario de gimnasio real (Escenario B, identidades distintas
compartiendo IP) no sufre ninguna degradación, ni siquiera a 20
concurrentes, con la capacidad actual del pool.
