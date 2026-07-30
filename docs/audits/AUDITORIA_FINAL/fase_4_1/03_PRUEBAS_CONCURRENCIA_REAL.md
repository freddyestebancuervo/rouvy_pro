# 3. Pruebas de concurrencia real (Casos A–D)

Todas las pruebas corrieron contra `https://ridepro-backend-dev-1020003121433.southamerica-east1.run.app/v1`
real, revisión `ridepro-backend-dev-00007-llf`, con usuarios Firebase
dedicados creados exclusivamente para esta validación (eliminados al final,
ver [05](05_LIMPIEZA_Y_RIESGOS.md)). Ningún token/email/UID completo se
imprimió ni se guardó en esta documentación.

## Restricción real descubierta durante la prueba: rate limit de 20/15min por IP

`POST /auth/firebase/exchange` tiene `@Throttle({ default: { limit: 20, ttl: 15*60*1000 } })`
— por IP, no por identidad de usuario. El primer intento de Caso A (20
requests) agotó la cuota completa; el reintento inmediato con menos
requests devolvió `429` en el 100% de los casos. Se esperó el reset exacto
(`Retry-After: 732` segundos, tomado de la respuesta real, no estimado) sin
tocar configuración de throttling. Cada caso posterior se validó con una
sola solicitud de sondeo antes de la ráfaga real, para no gastar cuota en
vano si la ventana no había reiniciado todavía.

## Caso A — 20 concurrentes, usuario nuevo (evidencia preservada del primer intento, no repetida)

| Métrica | Resultado |
|---|---|
| Total | 20 |
| Éxito (200) | 7 |
| Error 500 | 13 — **100% por agotamiento del pool de Postgres** (`timeout exceeded when trying to connect`), confirmado con logs saneados: 0 coincidencias de `23505`/`duplicate key` en toda la ventana |
| `userId` distintos entre las 7 respuestas 200 | **1** |
| `sub` distintos en los JWT de esas 7 respuestas | **1** |

Cero evidencia de la race condition de identidad — el fix se comporta
correctamente en el 100% de las solicitudes que sí lograron conectar a la
base. El hallazgo de capacidad del pool está documentado por separado (ver
[00_RESUMEN.md](00_RESUMEN.md) y [05](05_LIMPIEZA_Y_RIESGOS.md)) y no se
reintentó el mismo volumen (20) para no volver a chocar con el mismo límite
estructural sin autorización para tocar el pool de producción.

## Caso B — usuario ya existente, 8 concurrentes reales

(1 solicitud de sondeo, ya exitosa, + 7 concurrentes adicionales — mínimo
necesario dado que el usuario del Caso A ya existía tras el intento
preservado de arriba.)

| Métrica | Resultado |
|---|---|
| Total | 8 (1 + 7) |
| Éxito (200) | 8/8 |
| Error 500 | 0 |
| `userId`/`sub` distintos | 1 (el mismo del Caso A) |
| Filas nuevas o `user_roles` duplicados | 0 (verificado en Postgres, ver [04](04_VERIFICACION_POSTGRESQL_Y_LOGS.md)) |

## Caso C — dos usuarios Firebase distintos, en paralelo

4 solicitudes concurrentes por usuario (8 total), disparadas en un mismo
`Promise.all` interleaved.

| Métrica | Resultado |
|---|---|
| Total | 8 |
| Éxito (200) | 8/8 |
| Error 500 | 0 |
| Identidades distintas con respuesta 200 | 2 |
| `sub` distintos DENTRO de cada identidad | 1 por identidad (consistente) |
| `sub` distintos ENTRE ambas identidades | 2 (nunca se mezclan) |

## Caso D — conflicto real de correo (preparación controlada en Postgres)

Sin forzar un estado inconsistente en Firebase Auth (dos cuentas reales no
pueden compartir email por diseño de Identity Platform). En su lugar:
2 cuentas Firebase reales y verificadas (`D1`, `D2`, cada una con su propio
email único), más 2 filas **sintéticas** insertadas directamente en
Postgres Development (marcadas `display_name='FASE4.1-TEST-SINTETICA-BORRAR'`),
cada una con el mismo email que su cuenta Firebase real correspondiente
pero un `firebase_uid` distinto (fila 1: un UID ficticio nunca usado para
pedir un token real; fila 2: `firebase_uid = NULL`, simulando una cuenta
legacy de password).

**Preflight obligatorio antes de insertar**: verificado que ni los emails
de D1/D2 ni el UID sintético existían previamente — 0 coincidencias, se
procedió a insertar.

| Prueba | Resultado |
|---|---|
| Token real D1 (email coincide con fila sintética de `firebase_uid` distinto) | **409 `FIREBASE_EMAIL_CONFLICT`** |
| Token real D2 (email coincide con fila sintética de `firebase_uid = NULL`) | **409 `FIREBASE_EMAIL_CONFLICT`** |
| Éxito (200) en cualquiera de los dos | 0 |
| Error 500 en cualquiera de los dos | 0 |
| Filas sintéticas modificadas/vinculadas tras el intento | 0 — `firebase_uid` de ambas filas exactamente igual a como se insertaron |
| `user_roles` para las filas sintéticas | 0 (verificado, no asumido) |
| `audit_log` para las filas sintéticas | 0 (verificado, no asumido — coherente: el camino de conflicto lanza antes de llegar a la línea de auditoría) |

Confirma explícitamente: (a) dos identidades Firebase reales y distintas
que comparten email nunca se resuelven como éxito ni como 500; (b) una
cuenta con `firebase_uid = NULL` (legacy) nunca se vincula automáticamente
solo por coincidencia de email.

Limpieza de Caso D ejecutada y verificada inmediatamente después de la
prueba (antes de continuar con la verificación general) — ver
[05](05_LIMPIEZA_Y_RIESGOS.md).
