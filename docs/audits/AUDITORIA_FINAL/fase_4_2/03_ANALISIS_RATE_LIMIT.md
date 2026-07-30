# 3. Auditoría del rate limit actual y alternativas de diseño

## 3.1 Arquitectura actual (leída de `node_modules/@nestjs/throttler` y del código propio)

| Aspecto | Valor real |
|---|---|
| Librería | `@nestjs/throttler` v6 |
| Almacenamiento | **En memoria, por proceso** (`ThrottlerStorageService`, un `Map` de Node con `setTimeout` por entrada) — **no hay Redis ni ningún backend compartido configurado** |
| Clave usada | `sha256(`${Clase}-${Handler}-${nombreDelBucket}-${tracker}`)` — confirmado en `throttler.guard.js:148` |
| Tracker (identidad) | `req.ip` por defecto (`throttler.guard.js:141-143`) |
| Tratamiento de `X-Forwarded-For` | Depende de `app.set('trust proxy', 1)` en `main.ts`, activado únicamente si `TRUST_PROXY=true` — **confirmado que SÍ está seteado a `'true'` en el Cloud Run real** (`gcloud run services describe`), por lo tanto `req.ip` resuelve a la IP real del cliente, no a la del proxy de Cloud Run |
| Ventana / máximo de `firebase/exchange` | `20` solicitudes / `15 min` (`FIREBASE_EXCHANGE_THROTTLE` en `auth.controller.ts`) |
| Alcance | **Por endpoint** — la clave incluye clase+handler, así que cada ruta tiene su propio contador independiente (`register`/`login`: 5/15min: `refresh`: 20/15min por token, no por IP, vía `RefreshThrottleGuard`; bucket global de respaldo: 100/60s por IP, aplicado a TODAS las rutas además de su límite específico) |
| Respuesta | `429`, cuerpo `{"error":{"code":"RATE_LIMITED","message":"Demasiadas solicitudes, intentá de nuevo más tarde.","details":null}}` (confirmado en pruebas reales de Fase 4.1) |
| Encabezado `Retry-After` | Sí, seteado por el propio guard (`res.header('Retry-After', ...)`, `throttler.guard.js:121`) — confirmado con valor real (`732`) en pruebas de Fase 4.1 |
| Comportamiento con múltiples instancias | **Cada instancia de Cloud Run tiene su propio `Map` en memoria, completamente independiente** — con `maxScale=2`, un atacante o un grupo de usuarios legítimos podría, en el peor caso, obtener hasta ~40 solicitudes/15min repartidas entre 2 instancias en vez de 20, según a cuál lo enrute el balanceador |
| Comportamiento detrás de NAT | Todos los clientes con la misma IP pública (ej. mismo gimnasio/oficina/NAT de operador) comparten el mismo contador — confirmado por diseño (tracker = `req.ip` único) |
| Comportamiento después de un redeploy | **El contador se pierde por completo** — un nuevo proceso arranca con un `Map` vacío, cualquier bloqueo activo se resetea instantáneamente |

**Confirmado: el límite real y actual es exactamente "20 solicitudes / 15
minutos / IP"**, tal como está documentado, con las salvedades de arriba
(por instancia, no global; se resetea en cada redeploy).

## 3.2 Escenario de gimnasio (confirmado con evidencia, no simulado)

```
20 usuarios en el gimnasio, mismo Wi-Fi
   → mismo NAT / misma IP pública de salida
   → mismo req.ip (TRUST_PROXY=true ya extrae la IP real del cliente,
     no la del balanceador de Cloud Run — el escenario aplica tal cual)
   → los 20 comparten el MISMO contador sha256(...-req.ip)
   → el usuario 21 (o el 1º si ya hubo tráfico previo de esa IP en la
     ventana) recibe 429, sin importar que sea una persona real
     autenticándose por primera vez ese día
```

## 3.3 Evaluación de riesgos

| Riesgo | Evaluación |
|---|---|
| Bloqueo de usuarios legítimos (gimnasios, oficinas, NAT de operador móvil) | **Real y ya reproducido** — es exactamente el escenario que motivó esta fase |
| Evasión al escalar Cloud Run | Real — más instancias = más contadores independientes = límite efectivo más alto de lo documentado, en sentido contrario al deseado (un atacante se beneficia, no un usuario legítimo) |
| Contadores distintos entre instancias | Confirmado (sección 3.1) |
| Pérdida del contador al reiniciar/redeploy | Confirmado — cualquier bloqueo activo se resetea, lo cual además **invalida cualquier prueba de rate limiting que dependa de un despliegue previo** (hallazgo operativo real de Fase 4.1: hubo que esperar el reset natural de 15 min, no un redeploy, precisamente para no alterar el estado bajo prueba) |
| Ataques con múltiples IPs (rotación de IP) | El límite por IP no ofrece ninguna protección — cada IP nueva empieza con cupo completo |
| Ataques con tokens Firebase inválidos | El rate limit actúa ANTES de la verificación del token (el `@Throttle` decora la ruta completa, se evalúa en el guard global antes de que el controller llame a `AuthService`) — así que un atacante con tokens inválidos consume cupo igual que uno legítimo, pero **no le cuesta nada verificar contra Firebase** (esa verificación ocurre después, dentro de `exchangeFirebaseToken`, y si el rate limit ya cortó, ni siquiera llega ahí) |
| Costo de verificar Firebase antes/después del rate limit | Confirmado: el orden actual (rate limit primero, verificación de Firebase después) es correcto desde el punto de vista de costo — nunca se paga el costo de una llamada a Firebase para una solicitud que de todos modos iba a ser rechazada por cuota |

## 3.4 Alternativas de diseño para rate limiting (ninguna implementada)

### Alternativa R1 — Rate limit por IP más tolerante

Subir el límite (p. ej. de 20 a un número mayor, a determinar con la matriz
de pruebas) manteniendo la misma arquitectura (IP, en memoria).

| | |
|---|---|
| Tokens válidos | Mejora directa — menos falsos positivos para grupos legítimos grandes |
| Tokens inválidos | Sigue sin distinguir válidos de inválidos — un atacante con tokens basura también se beneficia del límite más alto |
| Usuarios detrás de NAT | Mejor, pero el problema de fondo (un contador compartido por IP) sigue existiendo, solo que con más margen |
| Ataques | Peor tolerancia a fuerza bruta pura por IP única (más intentos permitidos antes de bloquear) |
| Múltiples instancias | Mismo problema de contadores independientes que hoy |
| Costo operativo | Ninguno — cambio de un número |
| Complejidad | Mínima |
| Privacidad | Sin cambios (sigue usando solo IP) |
| Respuesta 429 / `Retry-After` | Sin cambios |
| Recomendación | Mitigación más simple y rápida, pero no resuelve la causa (mezcla usuarios legítimos compartiendo IP con atacantes de IP única) |

### Alternativa R2 — Rate limit combinado por IP y Firebase UID

Aplicar dos capas: un límite amplio por IP (para frenar abuso masivo desde
una sola fuente) y un límite más ajustado por identidad real (Firebase UID o
email), aplicado DESPUÉS de una verificación mínima del token — requiere
mover la verificación de Firebase antes del throttle específico de esta
ruta (mientras el bucket global de 100/60s por IP se mantiene como primera
defensa, igual que hoy). Ya existe un precedente directo en este mismo
código: `RefreshThrottleGuard` (`backend/src/modules/auth/refresh-throttle.guard.ts`)
ya implementa exactamente este patrón — clave custom vía
`storage.increment(key, ...)`, hoy por refresh token, trivialmente adaptable
a "por Firebase UID" tras verificar el ID token.

| | |
|---|---|
| Tokens válidos | Cada identidad real tiene su propio cupo, independiente de cuántas otras personas compartan su IP |
| Tokens inválidos | Siguen cayendo bajo el límite por IP (más amplio, no por identidad, porque un token inválido no tiene UID verificable) — protección de costo preservada |
| Usuarios detrás de NAT | Resuelto — 20 usuarios reales del gimnasio, 20 cupos independientes |
| Ataques | Un atacante con UN token válido reusado muchas veces sigue limitado por identidad; un atacante con tokens inválidos sigue limitado por IP |
| Múltiples instancias | Mismo problema de estado en memoria que hoy, a menos que se combine con R3 |
| Costo operativo | Ninguno adicional (mismo `ThrottlerStorage`, solo una clave distinta) |
| Complejidad | Media — requiere verificar el token ANTES de aplicar el límite por identidad, cambiando el orden actual de guard→verificación |
| Privacidad | El UID de Firebase ya se procesa en el request; no se expone en logs (mismo criterio que Fase 3, nunca en `audit_log.metadata`) |
| Respuesta 429 / `Retry-After` | Sin cambios en el contrato |
| Recomendación | **La que mejor resuelve el escenario de gimnasio sin abrir la puerta a abuso ilimitado** — requiere diseño cuidadoso del reordenamiento guard/verificación |

### Alternativa R3 — Almacenamiento compartido (Redis o equivalente)

Reemplazar `ThrottlerStorageService` (en memoria) por un backend compartido
entre instancias (Redis, Memorystore, o el propio Cloud SQL como último
recurso).

| | |
|---|---|
| Tokens válidos / inválidos | Ortogonal a esta alternativa — resuelve "instancias", no "IP vs. identidad" (se puede combinar con R1 o R2) |
| Usuarios detrás de NAT | No resuelve el problema de fondo por sí sola (sigue siendo por IP si no se combina con R2) |
| Ataques | Cierra la evasión por escalado horizontal (sección 3.3) — un atacante ya no puede "repartir" su cuota entre instancias |
| Múltiples instancias | **Resuelto** — es exactamente el problema que ataca |
| Costo operativo | Alto relativo a las otras dos — nueva pieza de infraestructura (Memorystore/Redis administrado, o un servicio ya existente reutilizado), con su propio costo mensual y superficie de fallo |
| Complejidad | Alta — nueva dependencia, nueva conexión a gestionar, nuevo punto de fallo (¿qué pasa si Redis no responde? ¿se abre o se cierra el rate limit?) |
| Privacidad | Sin cambios directos, pero introduce otro sistema que también procesa IPs/identidades |
| Respuesta 429 / `Retry-After` | Sin cambios en el contrato de la API |
| Recomendación | Correcta a largo plazo si `maxScale` crece de forma sostenida, pero **desproporcionada para el volumen actual** (`maxScale=2`) — evaluar solo si R1/R2 resultan insuficientes en la práctica |

**Recomendación combinada** (sin implementar, ver
[05](05_PLAN_DE_IMPLEMENTACION.md)): R2 como solución principal del
escenario de gimnasio, R1 como ajuste fino del límite base mientras tanto,
R3 diferida hasta que el crecimiento de instancias lo justifique.
