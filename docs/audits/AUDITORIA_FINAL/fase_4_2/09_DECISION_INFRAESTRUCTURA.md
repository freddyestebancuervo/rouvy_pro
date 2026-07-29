# 9. Decisión de infraestructura — presentada, NO ejecutada

Ninguna de las 3 opciones de esta sección fue aplicada. Ningún recurso de
Cloud Run/Cloud SQL fue modificado en esta fase. Cifras base (Fase 4.2
Parte 1, medidas, no re-derivadas):

```
max_connections (Cloud SQL, db-f1-micro) = 25
superuser_reserved_connections           = 3
Conexiones usables reales                = 22   (25 − 3)
DATABASE_POOL_MAX actual (por instancia) = 10
maxScale actual (Cloud Run)               = 2
Potencial actual de la app                = 20   (10 × 2)
Margen actual                             = 2    (22 − 20)
```

Fórmula usada en las 3 opciones: `pool_por_instancia × maxScale + margen_reservado = conexiones_usables_reales (22)`.

## Opción 1 — Mantener la configuración actual, con las optimizaciones de esta fase

```
10 × 2 + 2 = 22   (sin cambio en la fórmula — el margen sigue siendo 2)
```

Lo que SÍ cambia con esta fase (sin tocar la fórmula): el camino de
"usuario nuevo" necesita 1 adquisición de conexión menos ([06](06_DISENO_OPTIMIZACION_EXCHANGE.md)),
la saturación se clasifica como `503`/`429` en vez de `500` genérico (el
cliente puede reintentar de forma informada), y el rate limit híbrido
reduce la probabilidad de que un pico de tráfico sea causado por un solo
grupo compartiendo IP en vez de tráfico real distribuido.

| | |
|---|---|
| Costo | Ninguno adicional |
| Riesgo | El margen de 2 sigue siendo el mismo que causó el incidente de Fase 4.1 — una ráfaga suficientemente grande de usuarios NUEVOS simultáneos (no de identidades ya existentes) puede seguir saturando, ahora con `503` en vez de `500` |
| Cuándo alcanza | Si el volumen real de altas nuevas simultáneas se mantiene similar al validado (Parte G: hasta 10 concurrentes de un mismo alta nueva sin degradación) |

## Opción 2 — Reducir `maxScale` de 2 a 1

```
10 × 1 + 12 = 22   (margen sube de 2 a 12)
```

| | |
|---|---|
| Costo | Ninguno (mismo tier de Cloud Run, menos instancias posibles) |
| Riesgo | Elimina la redundancia horizontal — una única instancia sirviendo todo el tráfico; cualquier problema de esa instancia (crash, deploy, cold start) afecta el 100% del tráfico, no el 50%; también baja el techo de throughput general de TODOS los endpoints, no solo `exchange` |
| Cuándo alcanza | Si la prioridad es margen de conexiones sobre disponibilidad/redundancia, y el volumen total de tráfico (todos los endpoints) cabe cómodamente en 1 instancia |
| Reversibilidad | Alta — un solo valor de Cloud Run, sin migración ni downtime de Cloud SQL |

## Opción 3 — Subir el tier de Cloud SQL (más `max_connections`)

```
Con un tier superior a db-f1-micro, max_connections sube (típicamente a
varios cientos, según el tier) — la fórmula pool × maxScale + margen
seguiría siendo válida, pero con mucho más margen disponible para el mismo
pool_por_instancia=10 × maxScale=2, o permitiendo subir DATABASE_POOL_MAX
y/o maxScale sin recalcular al límite.
```

| | |
|---|---|
| Costo | **Pendiente de consulta — no se debe inventar ninguna cifra.** Requiere cotización real contra la consola de GCP/calculadora de precios para el tier objetivo antes de decidir |
| Riesgo | Cambio de infraestructura de producción (Cloud SQL) — requiere el mismo nivel de disciplina de despliegue que cualquier cambio de tier (ventana de mantenimiento, posible breve interrupción según el método de cambio, validación posterior) |
| Cuándo alcanza | Si el volumen de altas nuevas simultáneas esperado supera lo que Opciones 1/2 pueden sostener de forma sostenida, no solo en picos aislados |
| Reversibilidad | Media — bajar de tier después es posible pero también es un cambio de infraestructura con su propia ventana |

## Recomendación (sin ejecutar)

Ninguna opción se ejecuta en esta fase. Con la evidencia de Parte G
(Escenario B — identidades distintas compartiendo IP — sostiene 20
concurrentes sin ninguna degradación con la configuración ACTUAL), el
escenario que realmente motivó Fase 4.2 (gimnasio/NAT compartido) ya queda
resuelto por el rate limit híbrido + la optimización de consultas, sin
necesitar ninguna de las 3 opciones de infraestructura. El riesgo real
remanente es específicamente "ráfaga grande de ALTAS NUEVAS simultáneas
para identidades distintas cada una" (no cubierto por Parte G tal como se
diseñó — cada nivel de Parte G Escenario B ya usa un `firebase_uid` nuevo
por request, y ESE escenario no mostró degradación; el que sí satura es
Escenario A, muchas solicitudes para la MISMA identidad nueva a la vez, un
patrón menos representativo de tráfico real de producción salvo un bug de
cliente que reintente agresivamente el mismo login). Dado esto, **Opción 1
(mantener, con las mejoras ya implementadas) parece suficiente para el
volumen actual**, con Opción 2 como palanca de emergencia de bajo costo si
se observa lo contrario en producción, y Opción 3 como decisión a mediano
plazo si el crecimiento de usuarios lo justifica — pero la decisión final
corresponde al usuario, no a este documento.
