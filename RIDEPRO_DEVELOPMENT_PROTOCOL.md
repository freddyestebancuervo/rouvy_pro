# Protocolo Oficial de Desarrollo de RidePro

- **Versión:** 1.0
- **Vigencia:** desde 2026-07-24, carácter permanente, hasta modificación expresa del Product Owner o del Arquitecto Principal.
- **Fuente de verdad exclusiva:** `docs/audits/AUDITORIA_FINAL/` (Auditoría Arquitectónica Oficial v1.1, `MASTER_EXECUTION_PLAN.md`, `BACKLOG_MAESTRO.md`). Este protocolo no crea prioridades, no cambia dependencias y no reinterpreta ninguna decisión ya aprobada en esos documentos — define **cómo** se ejecuta lo que esos documentos ya decidieron **qué** hacer y **en qué orden**.
- **Alcance:** aplica a toda tarea de desarrollo de RidePro (código, configuración, infraestructura, documentación técnica) a partir de esta fecha, sin excepción salvo autorización expresa.
- **Audiencia:** cualquier ingeniero, humano o agente, que trabaje en este repositorio.

---

## 0. Principios rectores

Estos 5 principios están detrás de cada regla de este documento. Cuando una situación no esté cubierta explícitamente, se resuelve volviendo a estos principios, no improvisando:

1. **Trazabilidad total.** Toda tarea, commit, decisión y hallazgo debe poder rastrearse hasta su origen (un ID de `BACKLOG_MAESTRO.md`, un hallazgo de la auditoría, o una autorización explícita registrada). Nada se hace "porque sí" ni "porque parecía buena idea" — la auditoría ya demostró el costo de citas imprecisas (ver `REVISION_FINAL_AUDITORIA_v1.1.md`); este protocolo existe en parte para que ese tipo de error no se repita en el código de producción.
2. **Sin sobre-ingeniería.** Mismo criterio ya validado en toda la auditoría (ADR-0001, ADR-0005): no se introduce infraestructura, abstracción, dependencia o patrón nuevo sin necesidad comprobada. La pregunta por defecto es "¿existe una solución más simple?", no "¿cuál es la solución más robusta imaginable?".
3. **Ninguna etapa se salta, ninguna puerta se fuerza.** Un ingeniero bajo presión de tiempo reduce alcance o pide una excepción explícita — nunca omite una etapa del ciclo de vida ni marca una puerta de calidad como superada sin cumplirla.
4. **El código habla, la documentación explica el porqué.** Nombres e implementación explican el qué; comentarios y documentación explican decisiones no obvias, restricciones ocultas y motivos de diseño — mismo estándar ya demostrado en el código existente de RidePro (`ble_datasource.dart`, `cors.config.ts` son las referencias de calidad a imitar).
5. **Nada irreversible sin autorización explícita.** `git push`, merge a rama protegida, migraciones destructivas, reescritura de historial, despliegue a producción: nunca se ejecutan sin confirmación explícita y registrada del Product Owner o del Arquitecto Principal, sin importar cuán seguro parezca el cambio.

---

## 1. Ciclo de vida de cada tarea

Toda tarea de `BACKLOG_MAESTRO.md` (o cualquier trabajo nuevo que se agregue siguiendo la sección 8) pasa por estas 10 etapas, en este orden, sin omitir ninguna. Una tarea que se detiene por falta de tiempo permanece en la etapa donde quedó — no se declara cerrada por adelantado.

| # | Etapa | Objetivo | Entregable de la etapa | Responsable |
|---|---|---|---|---|
| 1 | **Análisis** | Entender el problema real, su alcance y su necesidad, antes de diseñar nada | Respuestas completas al cuestionario de la sección 2 | Ingeniero asignado |
| 2 | **Diseño** | Definir la solución técnica concreta (archivos, contratos, migraciones, interfaces) | Diseño escrito, coherente con los Estándares (sección 3) y la Arquitectura Aprobada | Ingeniero asignado |
| 3 | **Evaluación de riesgos** | Identificar qué puede salir mal y cómo mitigarlo, antes de escribir código | Lista de riesgos introducidos por la tarea (no los ya existentes en el backlog) + plan de mitigación | Ingeniero asignado |
| 4 | **Implementación** | Ejecutar el diseño aprobado | Código/configuración, en commits pequeños y atómicos (Conventional Commits) | Ingeniero asignado |
| 5 | **Pruebas** | Verificar que la implementación cumple el diseño y no rompe nada existente | Suite de pruebas relevante en verde (ver sección 4, Puerta de calidad "Pruebas superadas") | Ingeniero asignado |
| 6 | **Autoauditoría** | Revisión crítica de la propia tarea, como si fuera de otro autor — buscar lo que la Fase 5 de pruebas no puede detectar (duplicación, acoplamiento nuevo, deuda no documentada) | Checklist de autoauditoría (sección 4bis) completado | Ingeniero asignado |
| 7 | **Documentación** | Dejar constancia de qué se hizo, por qué, y qué queda pendiente | Informe con el Formato Obligatorio de Entrega (sección 5) | Ingeniero asignado |
| 8 | **Revisión independiente** | Un segundo par de ojos (no el autor) valida diseño, riesgos y evidencia | Hallazgos de la revisión, con el mismo rigor de evidencia que la Auditoría Oficial (archivo/línea, comando, o test — nunca una opinión sin sustento) | Revisor independiente (otro ingeniero, u otro agente en modo revisor si no hay humano disponible) |
| 9 | **Aprobación** | Confirmar que las 7 puertas de calidad (sección 4) están cumplidas | Registro explícito de aprobación, con fecha y quién aprueba | Arquitecto Principal / Product Owner (o el Revisor independiente si la tarea es de bajo riesgo y no requiere autorización del propietario, ver `BACKLOG_MAESTRO.md`) |
| 10 | **Cierre** | Actualizar el estado del proyecto y dejar la tarea trazada como completada | Entrada nueva en `PROJECT_STATUS.md` (historial de cambios + estado del módulo/riesgo actualizado) | Ingeniero asignado |

**Regla de bloqueo:** si una etapa no puede completarse (falta información, una dependencia no está lista, se requiere autorización que no ha llegado), la tarea se marca **bloqueada**, no se salta la etapa ni se avanza a la siguiente. El bloqueo se registra en `PROJECT_STATUS.md` con la causa exacta.

---

## 2. Análisis previo obligatorio (Etapa 1)

Antes de escribir una sola línea de código, toda tarea debe responder por escrito, sin dejar ninguna sin contestar (una respuesta válida puede ser "no aplica", pero nunca el silencio):

1. **¿Qué problema resuelve?** — Cita el ID de origen (`BACKLOG_MAESTRO.md` o el riesgo/hallazgo de la Auditoría) o, si es trabajo nuevo fuera del backlog aprobado, ver sección 8.
2. **¿Por qué es necesario resolverlo ahora?** — Referencia el orden de ejecución ya definido en `MASTER_EXECUTION_PLAN.md` §7 y `BACKLOG_MAESTRO.md`. No se reordena el backlog para justificar una tarea fuera de turno sin autorización.
3. **¿Qué módulos afecta?** — Lista explícita de features/módulos (usar la nomenclatura ya establecida en Documento 1/2: `features/<nombre>`, `backend/src/modules/<dominio>`, `core/<área>`).
4. **¿Qué dependencias tiene?** — Cita las dependencias ya documentadas en `BACKLOG_MAESTRO.md` para esa tarea; si hay una dependencia técnica nueva no capturada ahí, se documenta y se notifica antes de proceder.
5. **¿Qué riesgos introduce?** — Riesgos nuevos que la tarea en sí podría generar (no los que resuelve). Se listan aunque sean de severidad Baja.
6. **¿Existe una solución más simple?** — Obligatorio comparar contra al menos una alternativa más simple antes de elegir el diseño. Si se descarta la más simple, se justifica por qué (mismo criterio que ADR-0001/ADR-0005: no se rechaza lo simple sin evidencia de que no alcanza).
7. **¿Cómo impacta Android?**
8. **¿Cómo impacta iOS?**
9. **¿Cómo impacta Web?** — Recordatorio permanente: la auditoría encontró un crash real en Web por no responder esta pregunta a tiempo (`A2`/`PLAT-1`). Ninguna tarea que toque `core/` o un `datasource` se cierra sin responder esto explícitamente.
10. **¿Cómo impacta Windows?**
11. **¿Cómo impacta Firebase?**
12. **¿Cómo impacta NestJS?**
13. **¿Cómo impacta PostgreSQL?** — Incluye si requiere migración, y si esa migración es reversible.
14. **¿Cómo afecta el rendimiento?** — Como mínimo: ¿agrega una consulta nueva? ¿está indexada? ¿agrega un rebuild de widget? ¿agrega un stream sin `dispose()` correspondiente?
15. **¿Cómo afecta la seguridad?** — Como mínimo: ¿toca autenticación/autorización? ¿expone un dato nuevo? ¿agrega un secreto? ¿necesita rate limiting?
16. **¿Cómo afecta la escalabilidad?** — Como mínimo: ¿el endpoint nuevo pagina? ¿el estado nuevo vive en memoria de una sola instancia (mismo problema ya identificado en `M6`)?
17. **¿Genera deuda técnica?** — Si la respuesta es sí, la deuda se documenta en `PROJECT_STATUS.md` en el mismo cierre de la tarea que la genera — nunca queda implícita ni se descubre en una auditoría futura.

**Plataformas no aplicables:** si una tarea es exclusivamente backend (p. ej., una migración SQL), las preguntas 7-10 se responden "No aplica — cambio exclusivo de backend, sin superficie de cliente" en vez de omitirse.

---

## 3. Estándares obligatorios de desarrollo

Todo estándar de esta sección **codifica lo que la Auditoría Oficial ya validó como correcto** (Documento 1 §2-§7, Documento 2 §2.5) — no introduce ninguna regla nueva de arquitectura.

### 3.1 Arquitectura
- Clean Architecture por feature en Flutter (`lib/features/<nombre>/{data,domain,presentation}`), sin excepciones — todo feature nuevo replica exactamente esta estructura.
- `domain/` nunca importa Flutter, SDKs externos, ni infraestructura concreta — solo `dartz`/`equatable` y contratos propios.
- Monolito modular en NestJS (`backend/src/modules/<dominio>/{module,controller,service,repository}.ts` + `dto/`), sin ORM, `pg.Pool` con consultas explícitas.
- Ningún módulo nuevo se microserviza sin la justificación exigida en ADR-0001 (evidencia de necesidad de escalar o desplegar por separado).

### 3.2 Organización del código
- Un feature, una carpeta. Un módulo NestJS, una carpeta. No se crean carpetas "utilidades" o "helpers" cajón de sastre — cada helper vive en el `core/<área>` o `common/<área>` que le corresponde por responsabilidad (mismo patrón que `common/ownership`, `common/auth`).
- Widgets privados de un solo uso se colocan en el mismo archivo que su página consumidora (patrón ya validado como correcto en Documento 2 §2.2/§7.1 — **no** se fuerza un archivo por widget).

### 3.3 Nomenclatura
- Dart: `lowerCamelCase` para miembros/variables, `UpperCamelCase` para clases/tipos, `snake_case` para archivos — estándar ya vigente, sin excepciones.
- TypeScript/NestJS: `kebab-case.type.ts` para archivos (`workouts.service.ts`), `UpperCamelCase` para clases, siguiendo el patrón exacto ya usado en los 5 módulos existentes.
- IDs de tareas/hallazgos: **nunca reutilizar un prefijo de identificador ya usado con otro significado en otro documento** — la auditoría corrigió una colisión real (`M1` en Documento 6 vs. Documento 7, resuelta como `PLAT-1`-`PLAT-4`). Todo ID nuevo se registra en `PROJECT_STATUS.md` antes de usarse.

### 3.4 Modularidad
- Acoplamiento cruzado entre features: solo `domain`→`domain`, o `presentation`→`presentation` limitado a `providers` (nunca widgets ni datasources) — regla exacta ya corregida y vigente en Documento 1 §4.2. Toda excepción nueva a esta regla requiere justificación escrita equivalente al hallazgo H2 original.
- Todo acceso a una capacidad específica de plataforma (BLE, salud, notificaciones, descargas) se implementa como Adapter (`domain` define la interfaz, `data`/`core` la implementa por plataforma) — patrón de referencia: `core/platform/web_bluetooth_support*.dart`. **Obligatorio** desde ahora incluir la rama de Web (`kIsWeb`) y, si aplica, Windows, en el mismo cambio que introduce la capacidad — no como tarea separada futura (lección directa del hallazgo `A2`/`PLAT-1`).

### 3.5 Manejo de errores
- Flutter: `Either<Failure, T>` (`dartz`) en todo repositorio de dominio; excepciones de datasource nunca cruzan a `domain` sin traducirse a `Failure` tipado.
- NestJS: `ApiExceptionFilter` + traducción de errores de Postgres (`pg-error.util.ts`) — ningún error crudo de proveedor llega al cliente.
- Principio único en ambos lados: **nunca exponer el error crudo del proveedor subyacente al llamador final.**

### 3.6 Logging
- Backend: salida estándar de Nest hoy; si se adopta logging estructurado, debe reemplazar por completo el paquete `logger` de Flutter eliminado en `B4` (no reintroducir sin necesidad comprobada) o adoptarlo formalmente en ambos lados a la vez — nunca una solución a medias entre cliente y servidor.
- **Nunca** loguear contraseñas, tokens, ni secretos — verificado como cumplido hoy (Documento 3 §7); toda tarea nueva que agregue logging se autoaudita explícitamente contra esta regla en la Etapa 6.

### 3.7 Seguridad
- Autenticación/autorización: `JwtAuthGuard` + `assertOwned()` (patrón 404-no-403) para todo endpoint nuevo que exponga un recurso de un usuario.
- Validación de entrada: `class-validator` + `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` para todo DTO nuevo — sin excepción.
- Ningún secreto se hardcodea; toda credencial nueva va a variables de entorno (`.env`/`dart_define.local.json`), nunca al repositorio.
- Todo endpoint de escritura nuevo evalúa si necesita idempotencia (ver `M2`/`T-F2.1`) antes de considerarse terminado.
- Rate limiting: todo endpoint nuevo queda cubierto por el guard global por defecto; si necesita un límite específico, se implementa como `Throttle()` por ruta, documentado.

### 3.8 Rendimiento
- Toda lista potencialmente larga usa `ListView.builder`/`GridView.builder` — nunca `ListView`/`Column` con `.map().toList()` sin límite conocido de tamaño.
- Todo `StreamController` creado explícitamente tiene un `dispose()`/`close()` correspondiente, verificado en la Etapa 6 (lección directa de `B8`/`R1`).
- Toda consulta backend nueva se verifica contra el índice de Postgres que la soporta antes de cerrarse (mismo estándar ya cumplido en las migraciones existentes).
- Toda pantalla nueva del HUD de entrenamiento (alta frecuencia de actualización) se diseña asumiendo el riesgo de jank ya identificado en Documento 4 §8 — profiling real recomendado antes de cerrar, no solo análisis estático.

### 3.9 Escalabilidad
- Ningún estado de negocio nuevo vive en memoria de una sola instancia del backend sin una nota explícita de por qué eso es aceptable a la escala actual (mismo criterio que hizo detectable `M6`).
- Todo endpoint de listado nuevo pagina desde el diseño (lección directa de `M7` — no se repite el error de "el contrato ya lo contempla" sin verificarlo).
- No se introduce Redis, colas, o réplicas de lectura sin el mismo criterio de necesidad comprobada de ADR-0001 — la primera adopción legítima ya está planificada (`M6`/`F0.4`, rate limiter).

### 3.10 Documentación
- Comentarios en código explican el **porqué**, no el qué — estándar de referencia: `ble_datasource.dart`, `cors.config.ts`.
- Toda decisión de arquitectura nueva que no sea una extensión directa de un patrón ya aprobado se documenta como ADR nuevo (mismo formato que `docs/architecture/adr/0001`-`0007`).
- Toda tarea cerrada dispara una actualización de `PROJECT_STATUS.md` (Etapa 10) — nunca queda "hecho en el código, pendiente en el registro".

### 3.11 Pruebas
- Flutter: todo caso de uso/repositorio nuevo tiene test unitario; toda página nueva con lógica condicional (loading/error/vacío) tiene al menos un test de widget.
- Backend: todo endpoint nuevo tiene test e2e contra Postgres real (no mocks) — mismo estándar ya cumplido en los 5 módulos existentes.
- Todo cambio de DTO backend queda cubierto por un test de contrato una vez `T-F2.2` esté cerrada; hasta entonces, se documenta manualmente el DTO afectado en el informe de cierre (sección 5).
- Ninguna tarea se cierra con una suite de pruebas en rojo, ni con pruebas comentadas/deshabilitadas para "pasar" la puerta de calidad.

### 3.12 Gestión de dependencias
- Ninguna dependencia nueva se agrega sin responder la pregunta 6 del Análisis previo ("¿existe una solución más simple?").
- Toda dependencia agregada debe tener al menos un uso real en el mismo commit que la introduce — la auditoría encontró 9 dependencias declaradas sin uso (`B4`); esa clase de deuda no debe repetirse.
- Antes de adoptar cualquier dependencia de generación de código (`build_runner` y su familia), revisar `B4`/`T-F2.5` — el criterio del proyecto es manual por defecto, generado solo con necesidad comprobada.

---

## 4. Puertas de calidad (por tarea)

Ninguna tarea se marca **Cerrada** en `PROJECT_STATUS.md` hasta cumplir, sin excepción, las 7 puertas siguientes. Si una puerta falla, la tarea permanece **Abierta** o **Bloqueada** — nunca se marca cerrada "con observaciones" a nivel de tarea individual (las observaciones son aceptables a nivel de fase, ver `MASTER_EXECUTION_PLAN.md` §9, pero no sustituyen el cumplimiento de una puerta de tarea).

| Puerta | Criterio de cumplimiento | Cómo se verifica |
|---|---|---|
| **1. Arquitectura aprobada** | El diseño de la tarea es consistente con la sección 3 de este protocolo y con la Arquitectura Aprobada de `MASTER_EXECUTION_PLAN.md` §3 — sin desviación no justificada | Revisión independiente (Etapa 8) |
| **2. Compilación sin errores** | `flutter analyze --fatal-infos` sin issues (cliente) y/o `npx tsc --noEmit` sin errores (backend), según corresponda | Ejecución directa antes de la Etapa 9 |
| **3. Pruebas superadas** | `flutter test`, `npm test`, `npm run test:e2e` — 100% verde en las suites afectadas por la tarea (no solo las nuevas) | Ejecución directa antes de la Etapa 9 |
| **4. Auditoría independiente** | Revisión de un segundo ingeniero/agente (Etapa 8) completada, con hallazgos resueltos o explícitamente aceptados por el Arquitecto Principal | Registro en el informe de cierre (sección 5) |
| **5. Rendimiento aceptable** | Sin regresión conocida contra los estándares de la sección 3.8; si la tarea toca una ruta de alto riesgo (HUD, streams, listas), evidencia explícita de que no introduce jank/fugas nuevas | Autoauditoría (Etapa 6) + revisión independiente |
| **6. Seguridad revisada** | Cumple la sección 3.7; si la tarea toca auth, datos de usuario, o un endpoint nuevo, revisión explícita contra los vectores de Documento 3 §5 (SQLi, mass assignment, escalación de privilegios) | Autoauditoría (Etapa 6) + revisión independiente |
| **7. Documentación actualizada** | Informe de cierre (sección 5) completo y `PROJECT_STATUS.md` actualizado (Etapa 10) | Verificación final antes de Cierre |

**Puertas de fase (recordatorio, no reemplazan las de tarea):** `MASTER_EXECUTION_PLAN.md` §9 define `QG0`-`QG3` y `QG-Producto` a nivel de fase del backlog — se verifican al completar todas las tareas de una fase, además de que cada tarea individual haya cumplido sus 7 puertas.

### 4bis. Checklist de autoauditoría (Etapa 6)

Antes de pasar a Documentación, el propio ingeniero responde, actuando como revisor de su propio trabajo:

- [ ] ¿Duplico lógica que ya existe en otro lugar del proyecto?
- [ ] ¿Introduzco acoplamiento nuevo entre features que no sigue la regla de la sección 3.4?
- [ ] ¿Dejo algún `StreamController`, listener o suscripción sin cierre correspondiente?
- [ ] ¿Agrego una consulta sin índice de soporte?
- [ ] ¿Agrego un endpoint de listado sin paginación?
- [ ] ¿Agrego una dependencia nueva sin uso real inmediato?
- [ ] ¿Dejo un `TODO`/`FIXME` sin registrarlo como deuda técnica en `PROJECT_STATUS.md`?
- [ ] ¿Cité alguna sección de otro documento sin verificar que existe (mismo error que produjo `H-REV-1` en la auditoría)?
- [ ] ¿Respondí las 17 preguntas del Análisis previo con evidencia, no con suposición?

---

## 5. Formato obligatorio de entrega

Toda tarea cerrada se documenta con **exactamente** esta estructura, sin campos vacíos (usar "No aplica" con justificación breve donde corresponda — nunca omitir un campo):

```markdown
## Entrega: [ID de la tarea, p. ej. T-F0.1]

### Objetivo
[Qué se propuso lograr, en una o dos frases.]

### Alcance
[Qué se incluyó y qué se excluyó explícitamente.]

### Diseño
[Decisión técnica tomada, alternativas consideradas y por qué se descartaron.]

### Riesgos
[Riesgos introducidos por esta tarea específica — no los que resuelve — y su mitigación.]

### Archivos modificados
[Lista completa, con una frase de qué cambió en cada uno.]

### Archivos nuevos
[Lista completa, con una frase de qué responsabilidad tiene cada uno.]

### Pruebas ejecutadas
[Comando exacto + resultado (verde/rojo) de cada suite relevante.]

### Resultados
[Qué se verificó que funciona, con evidencia — no una afirmación sin sustento.]

### Pendientes
[Qué queda fuera de esta tarea, explícitamente, para no perderlo.]

### Recomendaciones
[Próximo paso sugerido, si aplica.]

### Estado final
[Cerrada / Abierta / Bloqueada — con motivo si no está Cerrada.]
```

Este formato es obligatorio para toda entrega desde la vigencia de este protocolo — reemplaza cualquier formato ad hoc usado en sesiones anteriores a esta fecha.

---

## 6. `PROJECT_STATUS.md` — registro permanente del proyecto

Ver el archivo `PROJECT_STATUS.md` (raíz del repositorio) para el documento vivo. Reglas de mantenimiento:

- Se actualiza en la Etapa 10 (Cierre) de **toda** tarea, sin excepción, el mismo día en que se cierra.
- Nunca se reescribe el historial de cambios — se agrega una entrada nueva al final, con fecha.
- El "porcentaje de avance" se calcula sobre el total de tareas de `BACKLOG_MAESTRO.md` (34 unidades) más cualquier tarea nueva agregada según la sección 8 de este protocolo — nunca se estima a ojo.
- Si un módulo pasa de "en desarrollo" a "bloqueado", se registra la causa exacta (qué dependencia falta, o qué autorización está pendiente) citando el ID correspondiente.

---

## 7. Excepciones y autorizaciones

- Ninguna etapa del ciclo de vida (sección 1) se omite sin autorización expresa y registrada del Arquitecto Principal o Product Owner, con el motivo documentado en `PROJECT_STATUS.md`.
- Toda tarea marcada en `BACKLOG_MAESTRO.md` como "Requiere autorización del propietario: Sí" no avanza de la Etapa 1 (Análisis) a la Etapa 2 (Diseño) sin esa autorización registrada.
- `git push`, merge a `main`/`master`, y cualquier operación irreversible (migraciones destructivas, reescritura de historial) requieren confirmación explícita en el momento, incluso si la tarea ya fue autorizada en general — autorizar el trabajo no autoriza automáticamente su publicación.

## 8. Trabajo nuevo fuera del Backlog Maestro

Este protocolo no impide agregar trabajo nuevo no contemplado en `BACKLOG_MAESTRO.md` (un bug encontrado en producción, una solicitud de un stakeholder). Ese trabajo:

1. Se somete al mismo ciclo de vida completo (sección 1) y al mismo Análisis previo (sección 2) que cualquier tarea del backlog.
2. Recibe un ID nuevo con el prefijo `T-NEW.<n>` (nunca reutiliza ni colisiona con `C`/`A`/`M`/`B`/`F`/`H`/`S`/`R`/`PLAT`, reservados a la Auditoría Oficial y al Backlog Maestro).
3. Se registra en `PROJECT_STATUS.md` con su origen (quién lo solicitó, por qué no estaba en el backlog original) — nunca se mezcla silenciosamente con el backlog aprobado.
4. No se prioriza por encima de una tarea Crítica o Alta ya abierta del backlog sin autorización explícita del Product Owner.

---

## 9. Vigencia y modificación

Este protocolo tiene carácter permanente desde su fecha de emisión. Solo el Product Owner o el Arquitecto Principal pueden modificarlo, y toda modificación se versiona (incrementar el número de versión en el encabezado) con fecha y motivo — nunca se edita en silencio un protocolo ya vigente.
