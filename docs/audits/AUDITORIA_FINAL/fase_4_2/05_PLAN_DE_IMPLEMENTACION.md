# 5. Puertas de calidad, riesgos y plan mínimo (propuesta, nada ejecutado)

## 5.1 Puertas de calidad propuestas

Ningún valor final se fija todavía — cada fila marca si es un criterio ya
verificable hoy o si depende de la medición de la Parte 2.

### PostgreSQL

| Criterio | Estado |
|---|---|
| Cero fugas de conexión | Ya verificado en esta fase (sección 1.3 del inventario) — mantener como regla de revisión de código permanente |
| Cero `500` por agotamiento de pool en el nivel aprobado | Pendiente de medición (matriz, sección 4) |
| Margen seguro de conexiones (app + administración + monitoreo) | Objetivo propuesto: mantener al menos 20-30% de las conexiones usables de Cloud SQL como margen — **número a validar, no final** |
| Configuración válida con el máximo de instancias vigente | Pendiente — depende de qué alternativa (P1/P2/P3) se autorice |
| Métricas y alertas de conexiones activas | No existen hoy — a diseñar en la Parte 2 |
| Rollback documentado | Cualquier cambio de `DATABASE_POOL_MAX`/`containerConcurrency` es una sola variable de entorno — rollback trivial (revertir el valor, redeploy), a documentar formalmente cuando se autorice el cambio |

### Rate limiting

| Criterio | Estado |
|---|---|
| Usuarios legítimos detrás de una IP compartida no bloqueados | Pendiente de medición tras implementar R1/R2 |
| Ataques básicos limitados | Ya cierto hoy (sección 3.3) para IP única; pendiente para multi-IP/multi-instancia hasta R3 |
| Comportamiento coherente entre instancias | No cumplido hoy (sección 3.1) — requiere R3 o aceptar el riesgo documentado |
| `429` con `Retry-After` | Ya cumplido hoy, mantener como regla de regresión |
| Tests automatizados | Ya existen para el comportamiento actual (`auth-firebase-exchange-rate-limit.e2e-spec.ts`) — habría que ampliarlos para la nueva clave (R2) o el nuevo backend (R3) cuando se implemente |
| Documentación | Este documento y los anteriores cubren el estado actual; falta la documentación de la alternativa elegida cuando se implemente |

### Rendimiento

| Criterio | Estado |
|---|---|
| p95 objetivo | No fijado — depende de la medición de la matriz (sección 4) |
| p99 objetivo | No fijado — ídem |
| Tasa de error objetivo | Propuesta: 0% de `500`; `429`/`503` aceptables solo por encima del nivel de concurrencia aprobado |
| Concurrencia mínima aprobada | Objetivo mínimo propuesto: **20 concurrentes sin `500`** (el nivel que falló en Fase 4.1) — **no es un valor final, es el piso que motivó esta fase** |
| Consumo de CPU/memoria | No medido todavía — pendiente de instrumentación (sección 4) |
| Conexiones máximas | Debe quedar siempre por debajo de las 22 usables de Cloud SQL (sección 1.4), con el margen que se defina |

## 5.2 Riesgos pendientes

1. **Tier `db-f1-micro`** es el techo real — cualquier alternativa que no
   toque el tier de Cloud SQL sigue limitada a 22 conexiones usables. Un
   crecimiento sostenido de tráfico eventualmente requerirá evaluar un tier
   mayor (fuera de alcance de esta fase, que no debe tocar Cloud SQL).
2. **`maxScale=2` es una variable compartida** entre este problema y la
   capacidad general del servicio — subirlo para dar más throughput general
   empeora el problema de conexiones si no se recalcula `DATABASE_POOL_MAX`
   en el mismo cambio.
3. **El rate limit en memoria nunca sobrevive un redeploy** — cualquier
   prueba de rate limiting debe planificarse sabiendo que un despliegue
   intermedio invalida el estado bajo prueba (ya observado como hallazgo
   operativo en Fase 4.1).
4. **R2 (rate limit por identidad) requiere reordenar cuándo se verifica el
   token de Firebase respecto al throttle** — un cambio de flujo, no solo de
   configuración, que necesita la misma disciplina de testing que la
   corrección de concurrencia de Fase 4.1 (unit + e2e + prueba real contra
   Cloud Run).
5. **Ninguna cifra de este documento es definitiva** — todas están marcadas
   explícitamente como "a medir" o "ilustrativa, no final", tal como se pidió.

## 5.3 Recomendación técnica

1. **PostgreSQL**: aplicar **P2** (recalcular `DATABASE_POOL_MAX` con margen
   explícito) como mitigación inmediata, en paralelo evaluar **P3**
   (reducir consultas del camino de `exchange`) como mejora estructural — no
   son excluyentes. **P1** queda documentada como palanca de emergencia, no
   como plan primario.
2. **Rate limiting**: implementar **R2** (combinado IP + Firebase UID) como
   solución principal del escenario de gimnasio, ajustando el límite base
   por IP (**R1**) mientras tanto. **R3** (Redis) se difiere hasta que
   `maxScale` crezca de forma sostenida más allá de 2.
3. Ninguna de las dos requiere tocar Cloud SQL, IAM, ni Producción.

## 5.4 Plan mínimo de implementación (para autorizar en una Fase 4.2 Parte 2 separada)

1. Instrumentar la matriz de pruebas (sección 4) contra el estado ACTUAL
   (sin cambios) para tener una línea base real de p50/p95/p99 y conexiones
   pico — hoy solo existe el dato agregado de Fase 4.1 (7×200/13×500 a 20
   concurrentes).
2. Con esa línea base, calcular y proponer el valor final de
   `DATABASE_POOL_MAX` (P2) — presentar el cálculo antes de aplicar el
   cambio, mismo criterio de "mostrar antes de tocar" de toda esta
   ingeniería.
3. Diseñar y proponer el diff exacto de R2 (probablemente en
   `auth.controller.ts`/un guard nuevo análogo a `RefreshThrottleGuard`) —
   presentar el diseño completo, con tests propuestos, antes de escribir
   código.
4. Re-ejecutar la matriz completa (1→50) con los cambios aplicados en un
   entorno de prueba, comparando contra la línea base del paso 1.
5. Documentar resultados, actualizar las puertas de calidad de este
   documento con valores reales (no "a medir"), y recién ahí evaluar
   despliegue a Development — cada paso con su propia autorización
   explícita, igual que Fase 4.1.

Nada de este plan se ejecuta en este documento — es la propuesta de
secuencia para la siguiente fase, pendiente de tu autorización.
