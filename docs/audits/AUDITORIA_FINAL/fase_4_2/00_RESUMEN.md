# Fase 4.2 — Capacidad de PostgreSQL y rediseño del rate limit (Parte 1: diagnóstico y diseño)

**Estado: solo diagnóstico y diseño. Ningún cambio de código, configuración,
infraestructura ni despliegue en esta fase.** Working tree y `HEAD` idénticos
al baseline confirmado (`211c6de`, rama `feature/d2`) — verificado al cierre
de este documento.

Continúa los dos riesgos documentados al cierre de Fase 4.1
(`docs/audits/AUDITORIA_FINAL/fase_4_1/05_LIMPIEZA_Y_RIESGOS.md`):

1. Agotamiento del pool de PostgreSQL con 20 exchanges Firebase concurrentes.
2. Rate limit de 20 req/15min por IP, inadecuado para redes compartidas
   (gimnasios, oficinas, NAT de operador móvil).

## Índice

1. [Inventario de configuración (BD, Cloud SQL, Cloud Run)](01_INVENTARIO_CONFIGURACION.md)
2. [Análisis del pool de PostgreSQL — flujo de exchange, causa raíz, alternativas P1–P3](02_ANALISIS_POOL_POSTGRESQL.md)
3. [Análisis del rate limit — arquitectura actual, riesgos, alternativas R1–R3](03_ANALISIS_RATE_LIMIT.md)
4. [Matriz de capacidad propuesta (pruebas escalonadas 1→50)](04_MATRIZ_DE_CAPACIDAD_PROPUESTA.md)
5. [Plan de implementación — puertas de calidad, riesgos, recomendación](05_PLAN_DE_IMPLEMENTACION.md)

## Hallazgos clave (resumen ejecutivo)

| Hallazgo | Dato real medido | Fuente |
|---|---|---|
| `max_connections` real de Cloud SQL | **25** | `SHOW max_connections` (solo lectura, vía Cloud SQL Auth Proxy) |
| `superuser_reserved_connections` | **3** → quedan **22 usables** | `SHOW superuser_reserved_connections` |
| Conexiones ya en uso en reposo (agente de Cloud SQL + margen) | 9 en el momento de la medición (2 `cloudsqlagent` + resto de herramientas de esta misma sesión) | `pg_stat_activity` |
| `DATABASE_POOL_MAX` real en Cloud Run | `10` (nunca configurado, usa el default de código) | `gcloud run services describe` |
| `maxScale` de Cloud Run | `2` instancias | `gcloud run services describe` |
| Conexiones potenciales máximas de la app | `10 × 2 = 20` | cálculo, ver [01](01_INVENTARIO_CONFIGURACION.md) |
| Margen real disponible tras la app | `22 − 20 = 2` conexiones para migraciones/administración/monitoreo | cálculo |
| Causa exacta de los 13/20 errores 500 (Caso A, Fase 4.1) | 100% `timeout exceeded when trying to connect` del pool — **0** relación con `23505`/identidad/Firebase | evidencia sanitizada ya guardada, `fase_4_1/03_PRUEBAS_CONCURRENCIA_REAL.md` |
| Almacenamiento del rate limiter | En memoria, por proceso (`ThrottlerStorageService`, `Map` de Node) — **no compartido entre instancias, se pierde en cada redeploy/scale-down** | lectura de `node_modules/@nestjs/throttler` |
| Clave del rate limiter | `sha256(Clase-Handler-Bucket-IP)` — confirmado por endpoint, no global | lectura de `throttler.guard.js` |
| `TRUST_PROXY` en Cloud Run real | `'true'` (confirmado) | `gcloud run services describe` |

## Conclusión de esta primera parte

El margen real entre lo que la app puede pedir (20 conexiones en el peor caso,
con `maxScale=2`) y lo que Cloud SQL permite (22 usables) es de solo **2
conexiones** — sin contar migraciones, acceso administrativo puntual (como el
usado para este mismo diagnóstico) ni herramientas de monitoreo. Esto confirma
que el problema de Fase 4.1 no fue una falla puntual: es un límite
estructural real, medido, no estimado. El rate limit, por su parte, es
funcionalmente correcto para su propósito (frenar abuso) pero su
implementación actual (en memoria, por instancia, por IP cruda) no sobrevive
un redeploy ni escala correctamente con múltiples instancias, y penaliza
igual a 20 usuarios legítimos detrás de la misma IP que a un solo atacante.

Ninguna alternativa fue implementada. Ver [05](05_PLAN_DE_IMPLEMENTACION.md)
para la recomendación técnica y el plan mínimo, pendientes de tu autorización
para una Fase 4.2 Parte 2.
