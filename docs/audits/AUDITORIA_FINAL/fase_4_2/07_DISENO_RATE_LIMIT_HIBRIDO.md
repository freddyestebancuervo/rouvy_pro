# 7. Diseño e implementación — rate limit híbrido de `firebase/exchange`

Continúa [03_ANALISIS_RATE_LIMIT.md](03_ANALISIS_RATE_LIMIT.md) (Parte 1,
diagnóstico). Implementa la alternativa **R2** (IP + identidad real),
dejando **R3** (almacenamiento compartido/Redis) explícitamente fuera de
alcance de esta fase — sigue siendo una limitación conocida y documentada,
no resuelta.

## 7.1 Arquitectura de 3 capas

```
Request → Capa 1 (IP, controller/@Throttle) → Capa 2 (UID hash) → Capa 3 (IP verificada) → upsert
             ANTES de verificar el token          DESPUÉS de verificar el token
```

| Capa | Dónde vive | Clave | Límite | Cubre |
|---|---|---|---|---|
| 1 | `AuthController` (`@Throttle`, `FIREBASE_EXCHANGE_THROTTLE`) | `sha256(Clase-Handler-Bucket-req.ip)` (el propio `ThrottlerGuard`) | **60 / 15 min / IP** (antes: 20) | Tokens inválidos/no verificables — el único costo pagado es el guard en memoria, nunca una llamada a Firebase |
| 2 | `AuthService.exchangeFirebaseToken`, tras `firebaseTokenVerifier.verify()` | `firebase-exchange-uid:${sha256(verified.uid)}` | **20 / 15 min / identidad real** | La protección real por identidad — ni compartir IP ni rotar de red la elude |
| 3 | `AuthService.exchangeFirebaseToken`, mismo lugar, después de Capa 2 | `firebase-exchange-ip-verified:${ip}` | **100 / 15 min / IP** | Respaldo contra "muchas identidades reales desde una sola IP" (abuso con muchas cuentas), sin penalizar redes compartidas legítimas (gimnasio, oficina, NAT) |

Orden de evaluación: Capa 2 antes que Capa 3 — un token inválido para una
identidad ya bloqueada nunca llega a gastar cupo de Capa 3 innecesariamente,
y ambas requieren el token ya verificado (no pueden evaluarse antes,
`verified.uid` no existe todavía).

## 7.2 Por qué resuelve el escenario de gimnasio (sección 3.2)

20 usuarios reales en el mismo Wi-Fi, mismo `req.ip`:

- Capa 1: 20 requests válidas, muy por debajo del nuevo límite de 60 — nunca se activa.
- Capa 2: cada usuario tiene su propio `firebase_uid` → su propia clave hasheada → su propio cupo de 20/15min, independiente de los otros 19.
- Capa 3: 20 requests verificadas desde la misma IP, muy por debajo de 100 — nunca se activa.

Ningún usuario legítimo del grupo ve un `429` causado por los otros 19 —
verificado con evidencia real en [08](08_RESULTADOS_PRUEBAS_LOCALES.md)
(30 identidades distintas concurrentes desde la misma IP, cero bloqueos).

## 7.3 Privacidad — el `firebase_uid` nunca se guarda ni loguea en claro

`hashForRateLimitKey` (`auth.service.ts`) aplica `sha256` al UID antes de
usarlo como clave de `ThrottlerStorage` — mismo criterio ya usado por
`AuditLogRepository` (nunca el UID completo en `metadata`). Verificado con
test explícito (`auth.service.spec.ts`, "la clave usada nunca contiene el
firebase_uid en texto plano").

## 7.4 Reutilización de `RefreshThrottleGuard` — qué se copió y qué no

Se reutilizó el patrón de invocar `ThrottlerStorage.increment(key, ttl,
limit, blockDuration, throttlerName)` directamente (mismo backend en
memoria, intercambiable por Redis sin tocar este código si R3 se
implementara a futuro). **No** se copió `RefreshThrottleGuard` como guard —
las Capas 2/3 viven en `AuthService`, no en un `CanActivate`, porque
necesitan el UID **ya verificado**, que no existe todavía a nivel de guard
(a diferencia de `refresh`, donde el token identificador ya viene en el
body sin verificación previa).

## 7.5 Limitaciones conocidas, sin resolver en esta fase (documentadas, no ocultas)

| Limitación | Alcance |
|---|---|
| Estado en memoria, por proceso | Un redeploy/reinicio limpia todos los contadores de las 3 capas — mismo comportamiento ya documentado en Fase 4.2 Parte 1 para el rate limit existente |
| Instancias separadas (`maxScale=2`) mantienen contadores independientes | Con 2 instancias, el límite efectivo de cada capa puede duplicarse en el peor caso (un atacante/grupo repartido entre ambas) — idéntico a la limitación ya documentada en [03](03_ANALISIS_RATE_LIMIT.md) sección 3.1, ahora también aplica a Capas 2 y 3 |
| Resolución (R3, Redis/almacenamiento compartido) | Explícitamente diferida — evaluar solo si el crecimiento de `maxScale` lo justifica (mismo criterio ya escrito en Parte 1) |

## 7.6 Cambios en el contrato — qué ve el cliente

- `POST /v1/auth/firebase/exchange` puede devolver `429 RATE_LIMITED` por
  3 motivos distintos ahora (antes 1) — el cuerpo de la respuesta es
  **idéntico** en los 3 casos (`{"error":{"code":"RATE_LIMITED",...}}`), el
  cliente no necesita ni puede distinguir qué capa lo frenó, solo que debe
  esperar `Retry-After` segundos.
- `retryAfterSeconds` para Capas 2/3 viene de
  `ThrottlerStorageRecord.timeToBlockExpire` (ya en segundos, `Math.ceil`),
  nunca estimado — mismo criterio que ya usaba el guard para Capa 1.
