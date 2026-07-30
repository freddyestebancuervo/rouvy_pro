# 2. Análisis del pool de PostgreSQL

## 2.1 Perfil exacto de `POST /v1/auth/firebase/exchange`

Trazado leyendo `auth.controller.ts` → `auth.service.ts` →
`users.repository.ts` → `token.service.ts` / `refresh-tokens.repository.ts` /
`audit-log.repository.ts`. Dos caminos posibles, según si el `firebase_uid`
ya existe:

### Camino A — usuario ya existente (el común, después del primer login)

```
Paso 1 → ThrottlerGuard (in-memory, sin DB)              → conexión: no → consultas: 0 → transacción: no
Paso 2 → FirebaseTokenVerifierService.verify()           → conexión: no → consultas: 0 → transacción: no
         (llamada de red a Firebase, NO a Postgres)
Paso 3 → UsersRepository.findByFirebaseUid()             → conexión: sí → consultas: 1 → transacción: no
Paso 4 → UsersRepository UPDATE users (camino existente)  → conexión: sí → consultas: 1 → transacción: no
Paso 5 → UsersRepository.findRoleNames()                 → conexión: sí → consultas: 1 → transacción: no
Paso 6 → AuditLogRepository.record() (INSERT audit_log)   → conexión: sí → consultas: 1 → transacción: no
Paso 7 → TokenService.signAccessToken()                   → conexión: no → consultas: 0 (JWT local, sin DB)
Paso 8 → TokenService.issueRefreshToken()                 → conexión: no → consultas: 0 (crypto local, sin DB)
Paso 9 → RefreshTokensRepository.create() (INSERT)        → conexión: sí → consultas: 1 → transacción: no
```
**Total: 5 adquisiciones de conexión, todas vía `pool.query()` (adquiere y
libera de inmediato) — 0 conexiones retenidas más de un round-trip, 0 transacciones.**

### Camino B — usuario nuevo (primera vez que ese `firebase_uid` existe)

```
Paso 1 → ThrottlerGuard                                   → conexión: no
Paso 2 → FirebaseTokenVerifierService.verify()             → conexión: no
Paso 3 → UsersRepository.findByFirebaseUid() (no existe)   → conexión: sí → consultas: 1
Paso 4 → UsersRepository.findByEmail() (no existe)         → conexión: sí → consultas: 1
Paso 5 → Transacción: BEGIN + INSERT users + INSERT        → conexión: sí (RETENIDA) → consultas: 3-4
         user_roles + COMMIT (o ROLLBACK + re-consulta                              → transacción: SÍ
         por firebase_uid si hay colisión — ver Fase 4.1)
Paso 6 → UsersRepository.findRoleNames()                   → conexión: sí → consultas: 1
Paso 7 → AuditLogRepository.record()                        → conexión: sí → consultas: 1
Paso 8 → TokenService.signAccessToken() / issueRefreshToken()→ conexión: no
Paso 9 → RefreshTokensRepository.create()                   → conexión: sí → consultas: 1
```
**Total: 6 adquisiciones de conexión — 1 de ellas (Paso 5) retiene la MISMA
conexión durante toda la transacción (3-4 sentencias secuenciales:
BEGIN/INSERT/INSERT/COMMIT), las otras 5 son de un solo round-trip.**

### Redundancias identificadas (no corregidas todavía — solo diagnóstico)

- **Pasos 3+4 podrían combinarse en una sola consulta** (p. ej.
  `SELECT * FROM users WHERE firebase_uid = $1 OR LOWER(email) = LOWER($2)`),
  reduciendo de 2 a 1 el número de adquisiciones de conexión del camino
  rápido — esto es exactamente la mitad de las adquisiciones de conexión de
  un usuario nuevo, sin tocar la lógica de la corrección de Fase 4.1.
- El Paso 6 (`AuditLogRepository.record`) **no es necesario para responder
  al cliente** — hoy es síncrono y bloquea la respuesta hasta que el INSERT
  termina. Podría diferirse (fire-and-forget con manejo de error propio) sin
  cambiar el contrato de la API, a costa de que una falla de auditoría ya
  no aborte el login (haría falta decidir si eso es aceptable).
- Ninguna consulta es estrictamente redundante (cada una lee o escribe algo
  distinto) — el problema no es "hacer trabajo de más", es "abrir demasiadas
  conexiones cortas en paralelo bajo ráfaga".

## 2.2 Diagnóstico del error de 20 concurrentes (Caso A, Fase 4.1 — evidencia ya sanitizada)

| Métrica | Valor exacto |
|---|---|
| Respuestas 200 | **7** |
| Respuestas 500 | **13** |
| Mensaje de error (100% de los 13) | `Error: timeout exceeded when trying to connect` (`pg-pool`) |
| Tiempo de espera antes del fallo | `connectionTimeoutMillis` = **5000ms** (configurado, no observado — es un timeout duro, no una medición de latencia real) |
| Errores `23505` | **0** |
| Errores de Firebase (token inválido/expirado/revocado) | **0** |
| Influencia del rate limiter en estos 13 errores | **Ninguna** — las 20 solicitudes originales entraron dentro de la cuota (20/20 permitidas por el throttler); el `429` solo apareció en un reintento posterior, ya fuera de este incidente |
| `userId`/`sub` distintos entre las 7 respuestas 200 | 1 (sin duplicados de identidad) |
| Instancias de Cloud Run sirviendo la ráfaga | **No determinado con la evidencia sanitizada guardada** — el saneo aplicado en Fase 4.1 no conservó el campo `labels.instanceId` (fuera de la lista explícita de campos permitidos). Dado que la instancia ya estaba caliente por tráfico previo de la misma sesión de pruebas, lo más probable es una sola instancia, pero no está confirmado — **queda como pendiente de medición explícita en la Parte 2 de Fase 4.2** |
| Duración de las solicitudes exitosas | No medida individualmente en esa prueba (solo se registró éxito/fallo agregado) — **pendiente de instrumentación en la matriz de pruebas** ([04](04_MATRIZ_DE_CAPACIDAD_PROPUESTA.md)) |

### Clasificación del error

| Tipo | ¿Ocurrió? |
|---|---|
| Error funcional (lógica de negocio incorrecta) | No |
| Error de identidad (duplicados, vinculación indebida — el bug de Fase 4.1) | No — 0 evidencia, el fix ya corregido funciona |
| **Error de capacidad (agotamiento del pool)** | **Sí — 13/13 de los 500 tienen esta causa exacta** |
| Error de rate limit | No en este incidente puntual (ver arriba) |
| Error de infraestructura (Cloud Run, red, Firebase) | No |

### Por qué el margen de 2 conexiones (sección 1.4) explica el resultado

Con `DATABASE_POOL_MAX=10` y 20 solicitudes genuinamente concurrentes contra
una única instancia (probable, no confirmado), cada solicitud del Camino B
necesita hasta 6 adquisiciones de conexión distintas (aunque cortas). Con 20
solicitudes compitiendo por 10 slots del pool, y cada adquisición tardando
lo que tarda un round-trip real a Cloud SQL (proxy + red + Postgres), es
esperable que varias solicitudes agoten los 5000ms de
`connectionTimeoutMillis` esperando un slot libre — exactamente lo observado.
Esto es **coherente con la capacidad medida de Cloud SQL** (sección 1.4): aun
si el pool local fuera más grande, el límite real de Cloud SQL (22 usables)
sigue siendo el techo estructural verdadero.

## 2.3 Alternativas de diseño para PostgreSQL (ninguna implementada)

### Alternativa P1 — Mantener pool en 10, reducir concurrencia por instancia

Bajar `containerConcurrency` de Cloud Run (hoy 80) a un valor que garantice
que nunca haya más de ~10 requests con una consulta a Postgres en vuelo al
mismo tiempo por instancia.

| | |
|---|---|
| Ventajas | Cero cambio de código; cero cambio de Cloud SQL; revertible con un solo flag |
| Riesgos | Baja el throughput general de la instancia para TODOS los endpoints, no solo `exchange`; con `maxScale=2` el límite efectivo de usuarios simultáneos reales baja bastante |
| Costo | Ninguno (mismo tier de Cloud Run) |
| Escalabilidad | Mala — para escalar más usuarios reales, la única palanca sería subir `maxScale`, lo que vuelve a acercarse al límite de 22 conexiones de Cloud SQL |
| Impacto en Cloud SQL | Ninguno directo |
| Impacto con varias instancias | `containerConcurrency` es por instancia — con `maxScale=2` el límite global efectivo sigue siendo bajo |
| Dificultad | Baja |
| Recomendación | Mitigación rápida y segura de muy corto plazo, no una solución — no resuelve el techo real de Cloud SQL |

### Alternativa P2 — Aumentar el pool por instancia con un límite calculado

Subir `DATABASE_POOL_MAX` a un valor tal que `DATABASE_POOL_MAX × maxScale`
quede claramente por debajo de las 22 conexiones usables, dejando margen
explícito para migraciones/administración (p. ej. `max=8` × `maxScale=2` =
16, dejando 6 de margen — número ilustrativo, a validar con la matriz de
pruebas, no un valor final).

| | |
|---|---|
| Ventajas | Cambio de una sola variable de entorno, sin tocar código; margen explícito y calculado, no accidental |
| Riesgos | Sigue atado al tier `db-f1-micro` (25 conexiones totales) — un futuro aumento de `maxScale` sin recalcular este número reintroduce el mismo problema |
| Costo | Ninguno adicional si el nuevo `max` sigue dentro de las 22 conexiones usables actuales |
| Escalabilidad | Media — requiere disciplina de recalcular el producto cada vez que cambie `maxScale` o el tier de Cloud SQL |
| Impacto en Cloud SQL | Ninguno si se respeta el margen calculado; alto si no (mismo incidente de Fase 4.1, a otra escala) |
| Impacto con varias instancias | Directo — es exactamente la variable que hay que recalcular quando `maxScale` cambie |
| Dificultad | Baja (una env var), pero requiere disciplina de proceso (documentar la fórmula, no solo el número) |
| Recomendación | Mitigación de corto/mediano plazo, más robusta que P1, pero requiere fijar un proceso para no repetir el error si cambia `maxScale` o el tier |

### Alternativa P3 — Reducir tiempo de retención y número de consultas antes de aumentar capacidad

Aplicar las reducciones de la sección 2.1 (combinar Pasos 3+4 en una sola
consulta, evaluar diferir la auditoría) para que cada exchange necesite
menos adquisiciones de conexión, antes o en paralelo a tocar cualquier
número de pool/instancias.

| | |
|---|---|
| Ventajas | Reduce la causa raíz (demasiadas adquisiciones cortas compitiendo), no solo el síntoma; beneficia a TODAS las escalas futuras, no solo a 20 concurrentes |
| Riesgos | Toca código de producción ya probado (Fase 4.1) — requiere la misma disciplina de tests que esa fase (unit + e2e + concurrencia real) antes de desplegar |
| Costo | Ninguno de infraestructura, solo de ingeniería/testing |
| Escalabilidad | Alta — es la única alternativa que mejora el techo real en vez de administrar mejor un techo fijo |
| Impacto en Cloud SQL | Positivo indirecto (menos conexiones simultáneas por el mismo volumen de requests) |
| Impacto con varias instancias | Positivo — el ahorro se multiplica por cada instancia activa |
| Dificultad | Media — cambio de lógica de negocio, no solo de configuración |
| Recomendación | **La más sólida a mediano plazo**, pero no reemplaza P2 — son complementarias, no excluyentes |

**Recomendación combinada** (sin implementar todavía, ver
[05](05_PLAN_DE_IMPLEMENTACION.md)): P2 como mitigación inmediata y medida
con la matriz de pruebas, P3 como mejora estructural en paralelo, P1 como
palanca de emergencia si hiciera falta un freno rápido sin tocar código.
