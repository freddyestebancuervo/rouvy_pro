# ADR-0001: Monolito modular vs. microservicios (backend)

- **Fecha:** 2026-07-24
- **Estado:** Aceptado

## Contexto

El backend NestJS tiene hoy 5 módulos (`auth`, `users`, `equipment`, `workouts`, `refresh-tokens`), una sola base de datos PostgreSQL, sin ORM (`pg.Pool` directo), y un pipeline de CI que corre migraciones + e2e contra una instancia de Postgres real por cada ejecución. El roadmap del proyecto (`docs/TECHNICAL_SPECIFICATION_M0_M1.md`, sección 6.2) ya identifica un único escenario con necesidad real de infraestructura adicional (WebSocket + Redis para multijugador, M6), explícitamente diferido. La sección 3 de `docs/architecture/01_SYSTEM_ARCHITECTURE.md` define 19 módulos de dominio potenciales a futuro (Eventos, Clubes, Estadísticas, Marketplace, etc.), la mayoría todavía sin implementar.

La pregunta a resolver: ¿el backend debe seguir como un monolito modular, o hay una necesidad real hoy de separar alguno de estos dominios en un servicio independiente?

## Decisión

**Continuar como monolito modular.** Un único proceso NestJS, una única base de datos PostgreSQL, con separación estricta por módulo de dominio (carpeta + `module.ts`/`controller.ts`/`service.ts`/`repository.ts`/`dto/`) como única frontera. Ningún módulo nuevo se extrae a un servicio separado sin evidencia de una necesidad real (no teórica) de escalado, despliegue o equipo independiente.

## Alternativas descartadas

1. **Microservicios por dominio desde ahora** (un servicio por módulo de la sección 3 del documento de arquitectura). Descartada: con 5 módulos y endpoints de bajo volumen, el costo de coordinación (versionado de contratos entre servicios, observabilidad distribuida, transacciones cross-servicio, N pipelines de CI en vez de uno) supera cualquier beneficio medible hoy. No hay evidencia de que ningún módulo necesite escalar o desplegarse de forma independiente de los demás.
2. **Microservicio único para "lo nuevo" (Bloque D) separado de "lo viejo" (Bloque C: auth/users)**. Descartada: ambos comparten la misma base de datos y el mismo modelo de autenticación/autorización (`JwtAuthGuard`, `assertOwned`) — separarlos obligaría a resolver autenticación distribuida (verificación de JWT en dos procesos) sin ningún beneficio de aislamiento real, ya que `equipment`/`workouts` ya son módulos Nest independientes entre sí dentro del mismo proceso.
3. **BaaS/Serverless (funciones individuales por endpoint)**. Descartada: el proyecto ya invirtió en un modelo relacional con integridad referencial real (FKs, constraints `CHECK`, índices únicos parciales) que un modelo de funciones sin estado compartido complicaría sin necesidad — no hay ningún endpoint con un perfil de carga (ráfagas extremas, cero tráfico el resto del tiempo) que justifique serverless sobre un proceso siempre activo.

## Consecuencias

- Cualquier módulo nuevo de la sección 3 del documento de arquitectura se construye como un módulo Nest más, reutilizando `DatabaseModule`, `JwtModule`, `common/auth`, `common/ownership`, `common/filters` ya existentes — sin infraestructura nueva por módulo.
- El "camino de escape" queda abierto por diseño: como cada módulo ya tiene su propio `repository.ts` (sin joins directos a tablas de otro módulo desde fuera de su propio código), extraer un módulo a un servicio separado el día que haga falta de verdad es mover una carpeta y definir un contrato HTTP/evento, no reescribir límites de datos que nunca se definieron.
- CI se mantiene simple: un solo job de backend, una sola instancia de Postgres efímera.

## Riesgos

- Si un módulo futuro (el candidato más probable, por volumen de escritura: Estadísticas o Eventos) crece mucho más rápido que el resto, compartir el mismo proceso/base de datos podría degradar el rendimiento de los demás módulos. Mitigación: PostgreSQL soporta escalar verticalmente y particionar por tabla mucho antes de necesitar un servicio separado; revisar esta decisión solo si aparece evidencia real de contención (no antes).
- Riesgo de acoplamiento accidental entre módulos si no se es disciplinado con "cada módulo solo accede a sus propias tablas vía su propio `repository.ts`" — mitigado hoy por la ausencia verificada de imports cruzados entre `equipment` y `workouts` (ver matriz de dependencias, sección 1.4 del documento de arquitectura); debe mantenerse como regla de revisión de código, no solo como estado actual.
