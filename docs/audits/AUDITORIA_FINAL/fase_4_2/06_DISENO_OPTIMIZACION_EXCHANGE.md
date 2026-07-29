# 6. Diseño e implementación — optimización de `POST /v1/auth/firebase/exchange`

Continúa [02_ANALISIS_POOL_POSTGRESQL.md](02_ANALISIS_POOL_POSTGRESQL.md) (Parte 1,
diagnóstico) y [05_PLAN_DE_IMPLEMENTACION.md](05_PLAN_DE_IMPLEMENTACION.md).
Implementa la alternativa **P3** (reducir adquisiciones de conexión antes de
tocar infraestructura), sin implementar P1/P2 (eso es materia de la decisión
de infraestructura, ver [09](09_DECISION_INFRAESTRUCTURA.md)).

## 6.1 Cambio 1 — consulta combinada en `UsersRepository.upsertByFirebaseUid`

**Antes** (Fase 4.1): dos consultas secuenciales independientes antes de la
transacción — `findByFirebaseUid(uid)`, y si no había fila, `findByEmail(email)`.

**Ahora**: una única consulta parametrizada, ejecutada siempre una sola vez:

```sql
SELECT * FROM users
WHERE deleted_at IS NULL
  AND (firebase_uid = $1 OR LOWER(email) = LOWER($2))
```

El resultado (0, 1 o 2 filas) se clasifica en JS en `byUid`/`byEmail` — la
fila nunca se asume por su contenido, se compara explícitamente contra
`params.firebaseUid`/`params.email` (`findIdentityCandidates`,
`users.repository.ts`).

### Casos cubiertos (antes inexistentes o cubiertos de forma distinta)

| Caso | Resultado |
|---|---|
| Encontrado por `firebase_uid`, mismo email o cambiado a uno libre | `UPDATE`, `isNew:false` |
| Encontrado por `firebase_uid`, pero el nuevo email ya pertenece a OTRA fila | `FirebaseEmailConflictError` **(antes: bug latente — el `UPDATE` habría reventado con un `23505` crudo sin traducir; cerrado como efecto colateral del rediseño)** |
| No encontrado por `firebase_uid`, pero el email pertenece a una fila con `firebase_uid` DISTINTO | `FirebaseEmailConflictError` |
| No encontrado por `firebase_uid`, pero el email pertenece a una fila con `firebase_uid` NULL (cuenta legacy) | `FirebaseEmailConflictError` |
| Ni `firebase_uid` ni email encontrados | Abre transacción, `INSERT`, `isNew:true` |

La rama de Fase 4.1 que comparaba `existingByEmail.firebaseUid === params.firebaseUid`
tras un segundo round-trip quedó **estructuralmente imposible** con una sola
consulta en un único snapshot (si esa condición fuera cierta, esa misma fila
ya habría aparecido como `byUid`) — se eliminó por no representar ningún
camino alcanzable, no por relajar ninguna garantía.

### Camino de colisión `23505` en la transacción (sin cambios)

El bloque `BEGIN`/`INSERT users`/`INSERT user_roles`/`COMMIT`, y el `catch`
que re-consulta por `firebase_uid` tras una violación de una de las 3
constraints conocidas (`users_firebase_uid_unique`, `users_email_unique`,
`users_email_lower_unique`), es **idéntico al de Fase 4.1** — sigue siendo la
única red de seguridad real contra una carrera entre conexiones distintas
(la consulta combinada solo elimina la ventana *entre* dos round-trips de un
mismo request, nunca reemplaza la protección transaccional).

### Adquisiciones de conexión — antes/después

| Camino | Antes (Fase 4.1) | Ahora (Fase 4.2 Parte 2) |
|---|---|---|
| Usuario ya existente (`byUid` en la primera consulta) | 2 (`findByFirebaseUid` + `UPDATE`) | 2 (`findIdentityCandidates` + `UPDATE`) — sin cambio |
| Usuario nuevo (ni uid ni email existen) | 3 (`findByFirebaseUid` + `findByEmail` + transacción) | **2** (`findIdentityCandidates` + transacción) — **1 adquisición menos** |
| Total del exchange completo, usuario nuevo (incluye `findRoleNames`/auditoría/refresh) | 6 | **5** |
| Total del exchange completo, usuario existente | 5 | 5 — sin cambio |

El ahorro se concentra exactamente en el camino de "usuario nuevo" — el
mismo camino que produjo el incidente de 13/20 `500` en Fase 4.1 (ráfaga
concurrente de un `firebase_uid` nuevo). No es una reducción dramática (~17%
menos adquisiciones en el peor caso), pero reduce la causa raíz para
cualquier escala futura, no solo mitiga el síntoma a un volumen fijo.

## 6.2 Cambio 2 — clasificación de saturación del pool como `503`, no `500`

`pg-pool` genera, del lado del cliente (antes de tocar Postgres), un
`Error('timeout exceeded when trying to connect')` **sin `.code`** cuando
`connectionTimeoutMillis` se cumple esperando un slot libre
(`node_modules/pg-pool/index.js:224`) — estructuralmente distinto de
cualquier error real de Postgres (que siempre trae un SQLSTATE en `.code`).

`isPoolConnectionTimeout` (`src/common/database/pg-error.util.ts`) detecta
esta forma exacta (mensaje exacto + ausencia total de `.code`), y
`ApiExceptionFilter` la traduce a:

```json
{
  "error": {
    "code": "DATABASE_TEMPORARILY_UNAVAILABLE",
    "message": "El servicio está temporalmente saturado. Probá de nuevo en unos segundos.",
    "requestId": "...",
    "details": null
  }
}
```

con `HTTP 503` y header `Retry-After: 2`. Cualquier otro error (incluida
una violación de integridad, un error de programación, o incluso un error
de Postgres real con el mismo texto de mensaje pero con `.code` presente)
sigue cayendo en el `500` genérico existente, sin cambios — verificado con
tests explícitos (`api-exception.filter.spec.ts`, ver [08](08_RESULTADOS_PRUEBAS_LOCALES.md)).

## 6.3 Alcance explícitamente NO tocado en este cambio

- `DATABASE_POOL_MAX` — sin cambios (sigue en el default de `database.config.ts`, `10`).
- El bloque transaccional de Fase 4.1 (`BEGIN`/`INSERT`/`COMMIT`/`catch 23505`) — sin cambios de lógica.
- `AuditLogRepository.record` — sigue síncrono, bloqueando la respuesta (identificado como redundancia diferible en [02](02_ANALISIS_POOL_POSTGRESQL.md), no implementado en esta fase — fuera del alcance autorizado).
