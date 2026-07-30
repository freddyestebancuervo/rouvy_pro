# 10. Fase 4.2.1 — Estabilización de las E2E de concurrencia

Objetivo del encargo: identificar y corregir la inestabilidad de
`auth-firebase-exchange-concurrency-new-user.e2e-spec.ts` y
`auth-firebase-exchange-concurrency-two-users.e2e-spec.ts`. La
investigación encontró que **no era inestabilidad de entorno E2E — era un
bug real de producción**, y el encargo se re-encuadró (con autorización
explícita del usuario) para corregirlo.

## 10.1 Causa raíz

`UsersRepository.upsertByFirebaseUid` (`users.repository.ts`), rama de
recuperación tras colisión `23505` en la transacción de "usuario nuevo":

```ts
const client = await this.pool.connect();      // retiene 1 conexión del pool
try {
  ...
} catch (error) {
  await client.query('ROLLBACK');
  ...
  if (isExpectedUsersConstraint) {
    const winner = await this.findByFirebaseUid(params.firebaseUid);
    //             ^ internamente: this.pool.query(...) — pide OTRA
    //               conexión del MISMO pool, mientras `client` sigue
    //               retenido (recién se libera en el `finally`, más abajo)
    ...
  }
} finally {
  client.release();
}
```

Bajo ráfagas con suficientes colisiones concurrentes sobre el mismo
`firebase_uid` para agotar `DATABASE_POOL_MAX` (10), **cada "perdedor" de
la carrera queda reteniendo su conexión mientras pide una segunda del mismo
pool ya agotado** — nadie puede liberar hasta obtener lo que
estructuralmente no puede estar disponible. Es un **self-deadlock por
auto-referencia**, no una cuestión de latencia ni de capacidad de
Postgres. Se resuelve solo (mal) cuando `connectionTimeoutMillis` (5000ms)
expira en la llamada interna de `findByFirebaseUid`, lo cual dispara
exactamente el mismo error de `pg-pool` (`isPoolConnectionTimeout`) que
Fase 4.2 Parte 2 ya sabía traducir a `503` — de ahí que el síntoma
observado fuera "muchos `503` a los ~5000ms", nunca `500` puro.

Presente desde Fase 4.1 (el patrón `finally { client.release() }` con un
re-query vía `this.pool` dentro del `catch` es anterior a Fase 4.2 Parte 2)
— confirmado con `git stash` de `users.repository.ts`: el bug reproduce
idéntico con el código de Fase 4.1.

## 10.2 Evidencia

Instrumentación temporal (copias `_diag-*.e2e-spec.ts`, no commiteadas,
borradas tras recolectar evidencia) con:
- Polling de `pool.totalCount`/`idleCount`/`waitingCount` cada 25-100ms durante la ráfaga.
- Una foto de `pg_stat_activity` a t≈1000ms tomada por una conexión `pg.Client` **independiente**, fuera del pool de la app (para no alterar lo que se mide).

### `auth-firebase-exchange-concurrency-new-user.e2e-spec.ts` (20 concurrentes, mismo `firebase_uid`)

```
pool: total=10 idle=0 waiting=20   — CONGELADO sin cambio desde t≈35ms hasta t≈5080ms
pg_stat_activity @t≈1000ms (10 conexiones, TODAS iguales):
  state=idle  wait_event_type=Client  wait_event=ClientRead  query_prefix="ROLLBACK"
```

### `auth-firebase-exchange-concurrency-two-users.e2e-spec.ts` (8+8 concurrentes, 2 `firebase_uid` distintos)

```
pool: total=10 idle=0 waiting=16   — CONGELADO sin cambio desde t≈103ms hasta t≈5000ms
pg_stat_activity @t≈1000ms: mismo patrón exacto, 10/10 conexiones idle+ClientRead+ROLLBACK
```

**Lectura de la evidencia**: Postgres ya terminó el `ROLLBACK` y está
esperando al cliente (`ClientRead` = Postgres esperando que el cliente
envíe el próximo comando) — el bloqueo NO es de Postgres, es 100% del lado
del pool de Node, que tiene esas 10 conexiones marcadas como "ocupadas"
(`idleCount=0`) porque el código que las retiene está a su vez esperando
una conexión adicional del mismo pool ya sin cupo. Esto refuta directamente
la hipótesis previa (Fase 4.2 Parte 2, documento 08) de "latencia del
entorno local" — el estado está congelado, no lento.

## 10.3 Diff aplicado (mínimo)

`src/modules/users/users.repository.ts`, rama de recuperación tras
`23505`: reemplaza `this.findByFirebaseUid(params.firebaseUid)` (vía
`this.pool`) por una consulta directa reusando el `client` ya retenido:

```diff
       if (isExpectedUsersConstraint) {
-        const winner = await this.findByFirebaseUid(params.firebaseUid);
+        const winnerResult = await client.query(
+          'SELECT * FROM users WHERE firebase_uid = $1 AND deleted_at IS NULL',
+          [params.firebaseUid],
+        );
+        const winner = winnerResult.rows[0] ? mapRow(winnerResult.rows[0]) : null;
         if (winner) {
           return { user: winner, isNew: false };
         }
         throw new FirebaseEmailConflictError(params.email);
       }
```

No cambia ninguna assertion de ningún test, no cambia `DATABASE_POOL_MAX`,
no cambia `connectionTimeoutMillis`, no cambia Cloud Run/Cloud SQL. La
consulta SQL es idéntica a la que ya ejecutaba `findByFirebaseUid` —
el único cambio real es de QUÉ conexión la ejecuta (`client`, ya en mano,
en vez de pedir una nueva al `pool`).

### Por qué no oculta un problema real

El fix no reduce concurrencia, no debilita ninguna aserción, no atrapa
errores para ignorarlos, no toca infraestructura. Ataca exactamente el
mecanismo demostrado por la evidencia (self-deadlock por doble adquisición
del mismo pool) — no un síntoma ni un timeout más generoso. Los 2 tests
pasan ahora ejecutando **la misma cantidad de requests concurrentes que
antes** (20 y 8+8, sin reducir), con las mismas aserciones originales
(`cero ≥500`, sin relajar a "500 o 503 aceptados").

## 10.4 Tests unitarios actualizados

`users.repository.spec.ts` — los 3 casos que ejercitan la recuperación
tras `23505` con un "ganador" encontrado ahora mockean la re-consulta
sobre `clientQuery` (no `poolQuery`), y verifican explícitamente que
`poolQuery` se llamó **solo 1 vez** (el pre-chequeo inicial) en las 5
variantes de colisión — antes se permitía una 2ª llamada a `poolQuery` para
la re-consulta, que ya no ocurre. Ningún caso se debilitó; se agregó la
aserción `poolQuery` a los 2 casos que no la tenían.

## 10.5 Resultados de validación

| Verificación | Resultado |
|---|---|
| `npm run lint` | Limpio |
| `npm run build` | Limpio |
| `npm test` (unitarias) | **122/122** |
| Los 2 e2e de concurrencia, aislados (`--runInBand`, mismos archivos, sin modificar) | **2/2 verde** |
| `npm run test:e2e`, corrida 1/2, container Postgres 16 nuevo desde cero | **86/86** (14/14 suites) |
| `npm run test:e2e`, corrida 2/2, container Postgres 16 nuevo desde cero | **86/86** (14/14 suites) |
| `dist/*.spec.js` | 0 |
| `dist/*.e2e-spec.*` | 0 |
| Contenedores Docker remanentes al finalizar | 0 (`ridepro-postgres` detenido y eliminado) |
| Procesos Node/Jest remanentes al finalizar | 0 |
| Datos de prueba remanentes | 0 (el contenedor efímero completo fue eliminado; los 2 diagnósticos temporales limpiaron sus propias filas antes de eso además) |

## 10.6 Archivos temporales usados y eliminados

`test/_diag-concurrency-new-user.e2e-spec.ts`,
`test/_diag-concurrency-two-users.e2e-spec.ts` — copias de diagnóstico con
instrumentación agregada (mismas requests/aserciones que los originales),
usadas solo para capturar la evidencia de 10.2, borradas inmediatamente
después. Nunca estuvieron en `git status` en ningún commit ni quedaron
como untracked al finalizar (verificado).
