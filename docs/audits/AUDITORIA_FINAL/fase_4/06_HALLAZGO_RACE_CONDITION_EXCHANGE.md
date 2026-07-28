# 6. Hallazgo real: race condition en `POST /auth/firebase/exchange`

Encontrado durante la prueba de rendimiento (punto 5), no buscado a propósito
— documentado con evidencia real, sin parchear (fuera del alcance de "no
nuevas funcionalidades" de esta fase; es una corrección de código de
producción que requiere autorización propia).

Evidencia cruda saneada (solo `timestamp`, `severity`, `status`, `method`,
`route`, `revision`, `errorName`, `errorCode`, `message` con redacción de
JWT/emails/UUIDs/connection strings — nunca el log crudo):
[`evidencia/race_condition_evidence_safe.json`](evidencia/race_condition_evidence_safe.json).

## Qué se observó

10 llamadas concurrentes a `POST /v1/auth/firebase/exchange` con el mismo ID
token de Firebase (mismo usuario, primera vez que existe en Postgres):
**7 respondieron 200, 3 respondieron 500**.

## Causa raíz (confirmada, no especulada)

El log de aplicación (saneado) muestra exactamente:

```
[ApiExceptionFilter] error: duplicate key value violates unique constraint "users_email_unique"
    at ... pg/lib/client.js:652:17
    at UsersRepository.upsertByFirebaseUid (dist/modules/users/users.repository.js:126:32)
    at AuthService.exchangeFirebaseToken (dist/modules/auth/auth.service.js:137:28)
```

`UsersRepository.upsertByFirebaseUid` (`backend/src/modules/users/users.repository.ts:236-285`)
hace `findByFirebaseUid` → si no existe, `findByEmail` → si no existe, recién
ahí `INSERT`. Bajo concurrencia real, varias llamadas simultáneas para el
**mismo usuario nuevo** pueden pasar ambos chequeos antes de que cualquiera
haya insertado, y competir en el `INSERT` — quien realmente lo impide es el
índice único de la base (`users_email_unique`, o `users_firebase_uid_unique`
según cuál gane la carrera), que responde con Postgres `23505`.

Esto **ya estaba documentado como riesgo conocido** en el propio código
(docblock de `upsertByFirebaseUid`, líneas 225-234): *"dos llamadas
concurrentes para el mismo firebase_uid o el mismo email nuevo pueden pasar
ambas el chequeo y competir en el INSERT [...] Traducir ese 23505 a una
respuesta HTTP queda para la capa de servicio de la Fase 3 — este repositorio
no lo atrapa."*

`AuthService.exchangeFirebaseToken` (`backend/src/modules/auth/auth.service.ts:203-261`)
sí atrapa `FirebaseEmailConflictError` (conflicto real, email ya usado por
otra cuenta legacy) pero **nunca implementó la traducción del `23505` de
carrera** que el propio comentario pedía — a diferencia de `register()`
(`auth.service.ts:96-126`), que sí traduce ese mismo tipo de error
(`isPgUniqueViolation`) a una respuesta de negocio limpia.

## Impacto real

- Solo afecta el **primer** exchange de un usuario que todavía no existe en
  Postgres, y solo bajo llamadas verdaderamente concurrentes (mismo usuario,
  múltiples requests en la misma ventana de milisegundos) — el escenario
  típico es un doble-tap en el cliente o un retry automático de red que
  dispare dos exchanges casi simultáneos para el mismo login.
- Una vez que la fila ya existe, `findByFirebaseUid` la encuentra y el flujo
  usa `UPDATE`, que no tiene esta carrera (no hay unicidad que violar en un
  `UPDATE ... WHERE firebase_uid = $1`).
- No es un problema de seguridad (no expone datos ni permite bypass de
  autenticación) ni de integridad (la constraint de base sigue garantizando
  que nunca hay dos filas con el mismo email/firebase_uid) — es un 500 en
  vez de una respuesta de negocio ordenada para el/los perdedores de la
  carrera.

## Mitigación sugerida (no aplicada en esta fase)

Espejar exactamente el patrón ya usado en `register()`: envolver el `INSERT`
de `upsertByFirebaseUid` en un `catch`, detectar `isPgUniqueViolation`, y
re-consultar (`findByFirebaseUid` otra vez) para devolver la fila que sí ganó
la carrera en vez de propagar el error crudo — mismo resultado final para el
cliente (200 con la sesión del usuario ya creado), sin 500. Es un cambio
acotado a `users.repository.ts` (o a `auth.service.ts`, replicando el
`try/catch` de `register()`), con cobertura de test adicional (llamadas
concurrentes reales en el e2e, no solo mocks). Requiere autorización explícita
por tratarse de una corrección de código de producción, fuera del alcance
"sin nuevas funcionalidades" de esta fase de cierre técnico.
