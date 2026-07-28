# 4. Verificación PostgreSQL y auditoría de logs

## PostgreSQL (Cloud SQL real, `ridepro-backend-dev-pg`, vía Cloud SQL Auth Proxy)

Nota técnica real encontrada durante la verificación: la primera consulta
de verificación usó `WHERE email = $1` (comparación exacta) y no encontró
ninguna fila — 0 resultados para los 3 usuarios de los Casos A/B/C, pese a
que las pruebas HTTP habían devuelto 200 consistentemente. Diagnóstico con
hashes SHA-256 normalizados (`trim().toLowerCase()`, sin exponer ningún
valor) confirmó que las filas SÍ existían, con el mismo largo exacto, pero
en un case distinto al de los archivos locales. Causa: la comparación
correcta es case-insensitive — `UsersRepository.findByEmail` ya usa
`WHERE LOWER(email) = LOWER($1)` (política deliberada del esquema, ver
migración `0002_users_email_case_insensitive_unique.sql`); mi primera
consulta de verificación no replicaba esa misma política. Corregido y
re-verificado — no fue un problema del sistema bajo prueba, sino de la
consulta de verificación.

| Identidad | Filas en `users` | `user_roles` | Duplicados por `role_id` |
|---|---|---|---|
| Usuario A (Casos A+B) | 1 | 1 | ninguno (`role_id=1, n=1`) |
| Usuario C1 (Caso C) | 1 | 1 | ninguno |
| Usuario C2 (Caso C) | 1 | 1 | ninguno |
| Filas sintéticas Caso D (×2) | sin cambios tras el intento de exchange | 0 | — |

- `user_roles` huérfanos (JOIN contra `users`, sin coincidencia): **0**.
- Ninguna identidad fue sobrescrita: los `firebase_uid` de las filas
  sintéticas del Caso D permanecieron exactamente iguales a como se
  insertaron, tras los 2 intentos reales de exchange contra ellas.
- Total de usuarios en la tabla en el pico de la prueba: 9 (4 originales +
  A + C1 + C2 + 2 sintéticas de D) — coherente con lo esperado, sin filas
  fantasma.

## Auditoría de logs (Cloud Run, revisión `ridepro-backend-dev-00007-llf`, ventana exacta de la prueba)

Evidencia cruda saneada (misma lista explícita de campos permitidos ya
aprobada en Fase 4 — `timestamp`, `severity`, `status`, `method`, `route`,
`revision`, `errorName`, `errorCode`, `message` con redacción de
JWT/Bearer/refresh-token/email/UUID/connection-string/IDs largos):
[`evidencia/revision_00007_logs_safe.json`](evidencia/revision_00007_logs_safe.json).

Reconciliación status HTTP de `/v1/auth/firebase/exchange` en toda la
ventana vs. lo observado del lado cliente — coincide exactamente:

| Status | Conteo en logs | Origen |
|---|---|---|
| 200 | 23 | Caso A preservado (7) + Caso B (1 sondeo + 7) + Caso C (8) |
| 401 | 2 | sondeos con token expirado durante la espera del rate limit |
| 409 | 2 | Caso D (D1 + D2) |
| 429 | 9 | 1 sondeo + 8 del reintento fallido, antes de esperar el reset |
| 500 | 13 | Caso A preservado, 100% agotamiento de pool |

Confirmaciones explícitas:
- **`23505` expuesto como error HTTP inesperado: 0** — búsqueda directa de
  `23505`/`duplicate key` en las 241 entradas saneadas de la ventana → cero
  coincidencias.
- **Tokens/contraseñas/secretos: 0** — el sanitizador (que redacta JWT,
  `Bearer `, `rt_`, emails, UUIDs, connection strings e IDs largos antes de
  truncar a 300 caracteres) no tuvo que redactar nada en ninguna entrada de
  esta ventana — ninguna entrada contenía esos patrones para empezar.
- **Stack traces inesperados: 0** — las únicas 13 entradas `ERROR` de la
  ventana son, todas, el mismo mensaje de `pg-pool`
  (`timeout exceeded when trying to connect`), ya explicado como hallazgo
  de capacidad, no como fuga de información ni error no controlado.
