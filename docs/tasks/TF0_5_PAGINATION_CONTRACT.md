# T-F0.5 — Compatible Pagination Contract

> Tarea #13 — DISEÑO ÚNICAMENTE. Este documento no implementa paginación,
> no modifica backend, no modifica Flutter, no modifica base de datos, no
> crea índices. Es la especificación ejecutable que Task14 (backend),
> Task15 (evidencia de rendimiento / índices) y Task16 (Flutter) deben
> seguir.
>
> Auditado contra `origin/main` en
> `0189e132c796ced82e9f761a8365a04984b89970`.

---

## 1. Estado actual verificado

Verificado leyendo el código real (no supuestos) en `main`:

### 1.1 `GET /equipment`

- Controller: `backend/src/modules/equipment/equipment.controller.ts:40`
  → `list(...): Promise<EquipmentResponse[]>`.
- Service: `backend/src/modules/equipment/equipment.service.ts:115-124`.
- Repository: `backend/src/modules/equipment/equipment.repository.ts:129-146`.
- Query SQL real:
  ```sql
  SELECT * FROM equipment WHERE user_id = $1 [AND archived_at IS NULL] [AND category_code = $N]
  ORDER BY created_at DESC
  ```
  Sin `LIMIT`. Sin desempate por `id`.
- DTO real (`equipment-query.dto.ts`): `category?: string` (1-30
  caracteres), `includeArchived?: 'true' | 'false'`. No existen `limit`,
  `cursor`, `page`, `offset`.

```
EQUIPMENT_ENDPOINT            = GET /equipment
EQUIPMENT_CURRENT_RESPONSE_SHAPE = ARRAY (EquipmentResponse[])
EQUIPMENT_CURRENT_FILTERS     = category?, includeArchived?
EQUIPMENT_CURRENT_SORT        = created_at DESC (sin desempate)
EQUIPMENT_CURRENT_LIMIT       = ninguno (todas las filas)
```

### 1.2 `GET /workouts`

- Controller: `backend/src/modules/workouts/workouts.controller.ts:48-54`
  → `list(...): Promise<WorkoutListItemResponse[]>`.
- Service: `backend/src/modules/workouts/workouts.service.ts:91-96`.
- Repository: `backend/src/modules/workouts/workouts.repository.ts:183-192`.
- Query SQL real:
  ```sql
  SELECT * FROM workouts
  WHERE (owner_id = $1 [OR owner_id IS NULL OR is_public = TRUE]) AND archived_at IS NULL
  ORDER BY created_at DESC
  ```
  Sin `LIMIT`. Sin desempate por `id`.
- DTO real (`workout-query.dto.ts`): `mine?: 'true' | 'false'`. No existen
  `limit`, `cursor`, `page`, `offset`.

```
WORKOUTS_ENDPOINT             = GET /workouts
WORKOUTS_CURRENT_RESPONSE_SHAPE = ARRAY (WorkoutListItemResponse[])
WORKOUTS_CURRENT_FILTERS      = mine?
WORKOUTS_CURRENT_SORT         = created_at DESC (sin desempate)
WORKOUTS_CURRENT_LIMIT        = ninguno (todas las filas)
```

### 1.3 Confirmaciones generales

```
OFFSET_PAGINATION    = NO (no existe en ninguno de los dos endpoints)
CURSOR_PAGINATION    = NO
LIMIT_VALIDATION     = NO
STABLE_TIE_BREAKER   = NO (created_at DESC solo; dos filas con el mismo
                       timestamp no tienen orden determinista)
```

No se modificó ningún archivo de código para llegar a estas
confirmaciones — solo lectura (`Read`/`Grep`).

---

## 2. Criterio oficial T-F0.5

Fuente: `docs/audits/AUDITORIA_FINAL/BACKLOG_MAESTRO.md`, líneas 62-69.

> **T-F0.5 — Paginación real en `equipment`/`workouts`**
> IDs de origen: `M7`, `F0.5`.
> Descripción: `EquipmentQueryDto`/`WorkoutQueryDto` no tienen
> `limit`/`offset`/`page`; los endpoints devuelven todas las filas sin
> límite. Agregar paginación por cursor con límite máximo del lado
> servidor (p. ej. 50).
> Criterio de aceptación: `GET /equipment` y `GET /workouts` nunca
> devuelven más del límite configurado, con test que lo pruebe; no rompe
> clientes actuales.

Leído literalmente, sin reinterpretar:

```
BACKLOG_REQUIRES_CURSOR              = YES
BACKLOG_REQUIRES_SERVER_MAX_LIMIT    = YES
BACKLOG_REQUIRES_NO_CLIENT_BREAKAGE  = YES
```

El "p. ej. 50" es un ejemplo del backlog, no un valor fijo obligatorio —
se usa como base para la política de límites en la sección 9, pero
distinguido explícitamente de "máximo" (ver 9.2).

---

## 3. Consumidores actuales

Auditado con `Grep` sobre `lib/` completo (sin asumir, sin resultados
parciales ignorados).

### 3.1 Equipment

Búsqueda de `/equipment`, `EquipmentResponse`, y de cualquier directorio
`lib/features/equipment/*`: **cero resultados**. No existe ningún
feature de Equipment en Flutter todavía — ni datasource, ni repository,
ni provider, ni página, ni test.

```
EQUIPMENT_CONSUMER_COUNT = 0
FLUTTER_EQUIPMENT_EXPECTS_ARRAY = NOT_APPLICABLE (no hay consumidor)
CURRENT_CLIENT_REQUIRES_ALL_ROWS (equipment) = NOT_APPLICABLE
```

Esto es una asimetría real entre los dos endpoints del criterio y se
documenta explícitamente en la sección 16.

### 3.2 Workouts

Consumidor real, cadena completa verificada:

- `lib/features/workouts/data/datasources/workouts_remote_datasource.dart:30-38`
  — `fetchAll({required bool mineOnly})` hace
  `_dio.get('/workouts', queryParameters: {'mine': 'true'}?)` y castea
  la respuesta directamente:
  `(response.data as List<dynamic>).map(...).toList()`.
  **Este cast falla en runtime (`TypeError`) si el body deja de ser un
  array JSON.**
- `lib/features/workouts/data/repositories/workouts_repository_impl.dart:14-21`
  — envuelve `fetchAll` en `Either<Failure, List<Workout>>`, sin lógica
  de paginación.
- `lib/features/workouts/presentation/providers/workouts_providers.dart:16-20`
  — `workoutsListProvider` es un
  `FutureProvider.autoDispose.family<List<Workout>, bool>` que pide la
  lista **una sola vez** por combinación de `mineOnly` y la devuelve
  completa.
- `lib/features/workouts/presentation/pages/workouts_list_page.dart:22`
  — consume `ref.watch(workoutsListProvider(mineOnly))` y renderiza el
  `AsyncValue<List<Workout>>` completo. No hay `ListView.builder` con
  scroll listener, no hay botón "cargar más", no hay ningún mecanismo de
  paginación en la UI — solo `invalidate` en pull-to-refresh y en retry.
- Tests que fijan este contrato:
  `test/features/workouts/data/models/workout_model_test.dart`,
  `test/features/workouts/presentation/pages/workouts_list_page_test.dart`.

```
WORKOUTS_CONSUMER_COUNT = 4 archivos de producción (datasource,
  repository impl, provider, página) + 2 archivos de test que fijan el
  contrato de lista completa.
FLUTTER_WORKOUTS_EXPECTS_ARRAY = YES
CURRENT_CLIENT_PAGINATION_SUPPORT = NO
CURRENT_CLIENT_REQUIRES_ALL_ROWS (workouts) = YES
```

`CURRENT_CLIENT_REQUIRES_ALL_ROWS = YES` no es una suposición: se
deriva directamente de que la página renderiza `AsyncValue<List<Workout>>`
sin ningún camino de código para pedir una página siguiente. Si el
servidor empezara a truncar la respuesta hoy, sin ningún cambio de
Flutter, el usuario vería una lista incompleta sin ningún indicio de que
falta contenido — eso es la ruptura funcional silenciosa que la sección
5-6 evita.

---

## 4. Riesgo de compatibilidad

Dos riesgos distintos, ambos reales, deben resolverse por separado:

1. **Riesgo de shape (`ARRAY → OBJECT`).** Si `GET /workouts` empezara a
   devolver `{ "items": [...], "nextCursor": ... }`, el cast
   `response.data as List<dynamic>` en
   `workouts_remote_datasource.dart:35` lanza una excepción en el primer
   request — ruptura dura, inmediata, para el único consumidor real hoy.
   Para Equipment no aplica (no hay consumidor), pero el endpoint debe
   seguir siendo consistente con Workouts porque Task16 construirá su
   futuro consumidor sobre el mismo contrato (sección 16).

2. **Riesgo de truncamiento silencioso.** Aunque el shape se preserve
   como array, si el servidor empieza a aplicar un límite por defecto
   HOY sin que Flutter sepa pedir la página siguiente, el usuario ve una
   lista incompleta sin error visible — funcionalmente roto aunque no
   haya ninguna excepción. Esto es tan grave como el riesgo 1 y se trata
   con el mismo nivel de rigor en la sección 6.

`ARRAY → OBJECT` sobre los endpoints actuales **no se aprueba** en este
documento (ver decisión, sección 6).

---

## 5. Opciones evaluadas

### Opción A — mismo endpoint, array preservado, cursor en header

`GET /equipment?limit=50&cursor=...` → body `[...]`, header
`X-Next-Cursor: <opaque>`.

- Ventaja real: el shape del body nunca cambia, en ningún escenario —
  elimina el riesgo 1 por completo y para siempre, no solo durante la
  transición.
- Acceso a headers desde Flutter: `dio` expone `Response.headers`
  directamente (`response.headers.value('x-next-cursor')`); no requiere
  ninguna librería nueva ni cambio de arquitectura de red.
- Semántica sin `limit`: debe definirse explícitamente (ver Opción B —
  se combinan).
- Compatibilidad funcional: no rompe el cast existente porque el body
  sigue siendo `List<dynamic>`.
- OpenAPI/contrato: el shape del body no cambia; solo se documentan un
  query param y un response header nuevos, ambos opcionales.
- Caches/proxies: headers custom (`X-*`) no son cacheados/alterados por
  proxies HTTP estándar sin configuración explícita; no hay caché HTTP
  configurada en este backend (confirmado: no hay `Cache-Control` en los
  controllers auditados), así que no hay riesgo adicional.
- Tests: un header es trivialmente inspeccionable en tests e2e
  (`supertest` expone `.headers`).

### Opción B — mismo endpoint, modo paginado opt-in por query param

`GET /equipment` (sin params) → array legacy, sin límite (comportamiento
actual, intacto). `GET /equipment?limit=50` (o `?cursor=...`) → modo
paginado.

- Permite rollout seguro: el comportamiento actual es exactamente el
  default hasta que algo pida explícitamente lo nuevo.
- El endpoint legacy (sin params) seguiría siendo ilimitado
  indefinidamente **a menos que** una fase de Enforcement posterior lo
  cierre (ver 6.3) — es deuda documentada, no deuda oculta.
- Por sí sola no resuelve el shape (`?pagination=v1` como en el ejemplo
  del enunciado sí cambiaría a `OBJECT`) — por eso se combina con A, no
  se usa el ejemplo de envelope de la Opción B tal cual.

### Opción C — endpoint versionado (`/v2/equipment`, `/v2/workouts`)

- Evaluado y rechazado como estrategia primaria: duplica
  controller/service/repository/tests para dos endpoints que hacen
  90% lo mismo (mismo ownership, mismos filtros, misma tabla); duplica
  mantenimiento indefinidamente si `/v1` nunca se retira formalmente (no
  hay ningún plan de retiro de API pública versionada en este proyecto,
  ni app store con múltiples versiones de cliente en producción que lo
  justifique — es una app aún en Development, un solo cliente propio).
  Task16 tendría que migrar todas las llamadas a una ruta nueva sin
  ninguna ganancia de compatibilidad sobre la Opción A+B (que no rompe
  nada y no duplica código). Se descarta por sobre-ingeniería sin
  evidencia de necesidad real en este repo.

### Opción D — otra solución

No se identificó, con evidencia del repo, ninguna estrategia adicional
que resuelva mejor los 8 requisitos de la sección 6 que la combinación
A+B. No se propone Opción D.

---

## 6. Decisión de contrato

### 6.1 Estrategia elegida: **Opción A + Opción B combinadas**

- El **shape del body nunca cambia**: siempre `ARRAY` (Opción A). El
  cursor de continuación viaja en el header de respuesta
  `X-Next-Cursor`, nunca en el body.
- El **modo paginado es opt-in** (Opción B): el endpoint solo aplica
  `limit`/keyset cuando el caller envía `limit` y/o `cursor`. Sin
  ninguno de los dos, el comportamiento es **exactamente el actual**:
  array completo, sin límite, sin header nuevo.

```
RECOMMENDED_COMPATIBILITY_STRATEGY = OPTION_A_PLUS_B
  (array body preservado siempre; cursor por header; modo paginado
  opt-in vía query params; default legacy sin params intacto)

ARRAY_TO_OBJECT_BREAK_AVOIDED = YES (el body es ARRAY en el 100% de los
  casos, con o sin paginación — no solo durante una transición)

SILENT_TRUNCATION_AVOIDED = YES (mientras el default sin params exista,
  ningún caller que no pida explícitamente `limit`/`cursor` ve una
  respuesta más corta que hoy)
```

### 6.2 Por qué los clientes actuales no se rompen

- `WorkoutsRemoteDataSourceImpl.fetchAll` (línea 31-34) llama
  `GET /workouts` con a lo sumo `{mine: 'true'}` — nunca envía `limit`
  ni `cursor`. Bajo este contrato eso activa el camino **legacy**: mismo
  body, mismo shape, mismo número de filas que hoy. Cero cambios de
  comportamiento observables para el consumidor real existente.
- Equipment no tiene consumidor — no hay nada que romper hoy; el
  contrato queda definido de forma simétrica para cuando exista.

### 6.3 Transición en fases (no existe una única fase que cumpla los 8
requisitos de la sección "FASE F" simultáneamente — se documenta
explícitamente en vez de ocultarlo)

```
TRANSITION_PHASES:

FASE COMPAT   (Task14): backend implementa `limit`/`cursor` opt-in tal
              como se especifica en este documento. El default sin
              params sigue siendo ilimitado — el criterio de aceptación
              del backlog ("nunca devuelven más del límite configurado")
              queda satisfecho solo para las llamadas que sí paginan;
              no para el default legacy todavía. Esto se declara
              explícitamente, no se disfraza de cierre total de T-F0.5.

FASE CLIENT   (Task16): Flutter migra `WorkoutsRemoteDataSource.fetchAll`
              (y el futuro datasource de Equipment, si existe para
              entonces) a consumir siempre en modo paginado, siguiendo
              `X-Next-Cursor` hasta agotarlo (sección 16). A partir de
              este punto, el único consumidor real del proyecto ya no
              depende del default ilimitado.

FASE ENFORCEMENT (fuera de Task13-16, requiere autorización explícita
              separada — mismo criterio que otras tareas de este
              backlog que "requieren autorización del propietario"):
              el default sin `limit`/`cursor` deja de ser ilimitado y
              aplica `DEFAULT_LIMIT` igual que el modo paginado. Recién
              en este punto el criterio de aceptación del backlog queda
              satisfecho literalmente para el 100% de las llamadas,
              incluidas las que no pasan ningún parámetro.
```

```
LEGACY_CONTRACT_RETIREMENT = NOT_REQUIRED
  (el contrato legacy nunca se retira como shape — solo su límite pasa
  de "ilimitado" a "DEFAULT_LIMIT" en la fase Enforcement; el shape
  ARRAY se mantiene siempre, no hay endpoint a dar de baja)
```

Ninguna de estas fases se ejecuta en esta tarea. Fase Enforcement no
tiene número de tarea asignado todavía porque depende de que Task16
haya cerrado primero (ver sección 19).

---

## 7. Ordering y keyset semantics

```
PAGINATION_TYPE     = KEYSET
ORDER_PRIMARY       = created_at DESC
ORDER_TIE_BREAKER   = id DESC
STABLE_ORDER        = YES
```

`ORDER BY created_at DESC` por sí solo **no** es un orden total: la
columna `created_at` no tiene ninguna constraint de unicidad, y dos
filas insertadas en la misma transacción de test, en un
`INSERT ... SELECT` batched, o simplemente dentro del mismo tick de
reloj del sistema, pueden compartir el mismo valor de `created_at` hasta
la precisión de microsegundos de PostgreSQL. Sin un segundo criterio de
desempate, Postgres no garantiza ningún orden particular entre esas
filas entre dos ejecuciones del mismo `SELECT` — lo cual rompe keyset
pagination: la misma fila podría aparecer dos veces (si cambia de
posición relativa entre el request de la página N y N+1) o directamente
no aparecer nunca.

`id` (UUID, `PRIMARY KEY` en ambas tablas — ver `RETURNING *` sobre
`INSERT INTO equipment`/`INSERT INTO workouts` en los repositorios) es
único por definición, así que `created_at DESC, id DESC` sí es un orden
total y determinista: nunca hay dos filas con el mismo par
`(created_at, id)`.

---

## 8. Cursor v1

```
CURSOR_VERSION        = 1
CURSOR_ENCODING        = base64url (RFC 4648 §5, sin padding) de un
                          objeto JSON UTF-8
CURSOR_FIELDS           = { v, createdAt, id, f }
TIMESTAMP_PRECISION     = microsegundos de PostgreSQL, preservados
                          textualmente (ver 8.2)
UUID_FORMAT             = UUID canónico, 36 caracteres, minúsculas
                          (mismo formato que ya devuelve Postgres y que
                          ya valida `ParseUUIDPipe` en el resto de la
                          API)
MAX_CURSOR_LENGTH       = 512 caracteres base64url (JSON de estos 4
                          campos ocupa <200 bytes crudos; 512 deja
                          margen amplio sin permitir payloads abusivos)
CURSOR_OPAQUE_TO_CLIENT = YES
```

### 8.1 Estructura

```json
{
  "v": 1,
  "createdAt": "2026-08-16T21:07:33.123456Z",
  "id": "6f2c1e2a-....-....-....-............",
  "f": "a1b2c3d4e5f6"
}
```

- `v`: versión del formato del cursor (entero). Permite evolucionar el
  formato sin ambigüedad — un cursor `v:1` nunca se interpreta con
  reglas de una versión futura incompatible.
- `createdAt`: posición en el eje primario de orden.
- `id`: desempate (sección 7).
- `f`: fingerprint corto (primeros 12 hex de un SHA-256) del conjunto de
  filtros lógicos que produjeron este cursor — ver sección 12.

`encode(decode(cursor))` no cambia la posición lógica porque los 4
campos se serializan de forma determinista (JSON con orden de claves
fijo, sin espacios) y se decodifican/recodifican sin pérdida —
condición necesaria explícitamente pedida en la Fase H del enunciado.

### 8.2 Por qué no se puede usar el `Date` de JavaScript tal cual

El `pg` driver de Node, por defecto, parsea la columna `timestamptz`
(OID 1184) a un objeto `Date` de JavaScript — que solo tiene precisión
de **milisegundos**. PostgreSQL almacena `timestamptz` con precisión de
**microsegundos**. Si el cursor se construyera a partir de
`record.createdAt.toISOString()` (el `Date` ya mapeado que usa
`EquipmentRecord`/`WorkoutRecord`, ver `equipment.repository.ts:99` y
`workouts.repository.ts:70`), dos filas con el mismo milisegundo pero
microsegundos distintos colapsarían al mismo valor de cursor — pudiendo
producir tanto duplicados como omisiones en la travesía keyset.

Diseño requerido para Task14: el valor de `createdAt` que se codifica en
el cursor **no** debe salir del `Date` ya parseado por `pg`. Debe
obtenerse como texto directamente desde PostgreSQL con precisión
completa, por ejemplo:

```sql
to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
```

(o configurando un parser de tipo custom para el OID 1184 que devuelva
el string crudo en vez de un `Date`, aplicado únicamente en la ruta de
paginación para no afectar el resto de la API que ya depende del `Date`
mapeado). Cualquiera de las dos formas es aceptable; la que se elija
debe demostrarse en Task14 con un test que confirme que dos filas
insertadas microsegundos aparte generan cursores distintos y una
travesía sin duplicados/omisiones (ver matriz de tests, ítem 10).

---

## 9. Limit policy

### 9.1 Valores

```
DEFAULT_LIMIT = 50
MAX_LIMIT     = 100
```

### 9.2 Justificación

El backlog dice "límite máximo del lado servidor (p. ej. 50)" — "p.
ej." marca 50 como ejemplo, no como el único valor válido de máximo.
Se elige:

- `DEFAULT_LIMIT = 50`: usa literalmente el valor que el backlog cita,
  de forma que cualquier caller que solo pase `cursor` sin `limit`
  explícito obtiene el comportamiento que el backlog tenía en mente.
- `MAX_LIMIT = 100`: el doble del default, evaluado contra los datos que
  sí se conocen hoy sin necesitar un benchmark (explícitamente fuera de
  alcance de esta tarea, ver sección 18):
  - `EquipmentResponse` tiene ~20 campos escalares/strings cortos —
    payload por fila pequeño (sin sub-recursos anidados).
  - `WorkoutListItemResponse` (el shape de **lista**, no de detalle)
    tiene ~10 campos y explícitamente **no** incluye `intervals` — el
    propio código ya separa `WorkoutListItemResponse` de
    `WorkoutDetailResponse` para mantener el listado liviano
    (`workouts.service.ts:178-192` vs `194-209`).
  - Un `MAX_LIMIT` de 100 filas de cualquiera de los dos shapes es un
    payload JSON del orden de decenas de KB, no un riesgo de memoria ni
    de tiempo de respuesta a priori.
  - Duplicar el default (en vez de igualarlo) le da margen al futuro
    helper `fetchAll*` de Task16 (sección 16) para pedir páginas más
    grandes que el default de UI cuando el objetivo es "traer todo"
    (menos round-trips), sin necesitar un tercer valor de configuración.
- Se descarta `MAX_LIMIT = 50` (igual al default) porque eliminaría
  cualquier margen para ese caso de uso sin ninguna ganancia de
  seguridad adicional (100 filas de estos shapes no es un vector de
  abuso relevante comparado con 50).

Esta elección es una decisión razonada, no un benchmark — **Task15 debe
confirmarla o corregirla con `EXPLAIN ANALYZE` sobre datos
representativos antes de que se dependa de ella en producción** (ver
sección 18). Si Task15 encuentra que 100 filas con los índices
disponibles cuesta más de lo aceptable, `MAX_LIMIT` se ajusta ahí con
evidencia, no aquí por intuición.

### 9.3 Validación de `limit`

Preferencia de contrato explícita de esta tarea: **fallar la validación
con `HTTP 400`, nunca clampear en silencio.** Clampear silenciosamente
un `limit` inválido a un valor válido escondería errores de integración
del cliente (p. ej. un bug que envía `limit=-1` seguiría "funcionando"
sin que nadie note el bug).

```
limit=0        → HTTP 400 (PAGINATION_LIMIT_INVALID)
limit=-1       → HTTP 400 (PAGINATION_LIMIT_INVALID)
limit=abc      → HTTP 400 (PAGINATION_LIMIT_INVALID; no es un entero)
limit > 100    → HTTP 400 (PAGINATION_LIMIT_INVALID; no se trunca a 100)
limit ausente  → aplica DEFAULT_LIMIT si el request ya está en modo
                 paginado (por traer `cursor`); si NO hay ni `limit` ni
                 `cursor`, es el camino legacy sin límite (sección 6)
```

---

## 10. Equipment contract

### 10.1 Parámetros

| Parámetro | Tipo | Requerido | Notas |
|---|---|---|---|
| `category` | string, 1-30 chars | no | igual que hoy |
| `includeArchived` | `'true'\|'false'` | no | igual que hoy |
| `limit` | entero, 1-100 | no | activa modo paginado si está presente |
| `cursor` | string opaco | no | activa modo paginado si está presente |

### 10.2 Ejemplos conceptuales

Primera página (modo paginado, límite explícito):

```
GET /equipment?limit=50
→ 200
  Body:    [ {...50 items...} ]
  Headers: X-Next-Cursor: <opaque>   (si hay más filas)
```

Página siguiente:

```
GET /equipment?limit=50&cursor=<opaque>
→ 200
  Body:    [ {...hasta 50 items...} ]
  Headers: X-Next-Cursor: <opaque>   (ausente si era la última página)
```

Con filtro `category` — el filtro se repite en cada página, el cursor
está ligado a él (sección 12):

```
GET /equipment?category=trainer&limit=50
GET /equipment?category=trainer&limit=50&cursor=<opaque>
```

Con `includeArchived`:

```
GET /equipment?includeArchived=true&limit=50
```

Camino legacy (sin `limit` ni `cursor` — comportamiento actual, sin
cambios):

```
GET /equipment
GET /equipment?category=trainer
→ 200, array completo, sin header nuevo — idéntico a hoy
```

---

## 11. Workouts contract

### 11.1 Parámetros

| Parámetro | Tipo | Requerido | Notas |
|---|---|---|---|
| `mine` | `'true'\|'false'` | no | igual que hoy |
| `limit` | entero, 1-100 | no | activa modo paginado si está presente |
| `cursor` | string opaco | no | activa modo paginado si está presente |

### 11.2 Ejemplos conceptuales

Primera página:

```
GET /workouts?limit=50
→ 200
  Body:    [ {...50 items...} ]
  Headers: X-Next-Cursor: <opaque>
```

Página siguiente:

```
GET /workouts?limit=50&cursor=<opaque>
```

Con `mine=true` — visibilidad y ownership sin cambios (sección 13):

```
GET /workouts?mine=true&limit=50
GET /workouts?mine=true&limit=50&cursor=<opaque>
```

Camino legacy (comportamiento actual del único consumidor real hoy):

```
GET /workouts
GET /workouts?mine=true
→ 200, array completo, sin header nuevo — idéntico a hoy
```

---

## 12. Filters and cursor binding

Se elige **ligar el cursor al conjunto lógico de filtros** (opción 2 de
la Fase L del enunciado), no dejar que un cursor se reutilice
libremente con filtros distintos — reutilizar un cursor de
`category=trainer` contra `category=power_meter` produciría una
travesía keyset sin sentido semántico (saltar a mitad de un conjunto de
filas completamente distinto).

```
CURSOR_FILTER_BINDING = FINGERPRINT (campo `f` del cursor, sección 8.1)
FILTER_MISMATCH_RESULT = HTTP 400 (PAGINATION_CURSOR_FILTER_MISMATCH)
```

Mecánica: al generar un cursor, el servidor calcula
`f = primeros12hex(SHA-256(canonicalización de los filtros efectivos))`
— para Equipment: `category` (o su ausencia) + `includeArchived`; para
Workouts: `mine` (o su ausencia). Al recibir un cursor en un request
posterior, el servidor recalcula `f` a partir de los filtros que
**ese** request trae y lo compara contra el `f` embebido en el cursor.
Si no coincide exactamente → `400`. No se almacena el valor crudo de los
filtros en el cursor (nunca información sensible, solo el hash corto),
y no se acepta ningún mecanismo de "reutilizar cursor con filtros
distintos".

---

## 13. Authorization invariants

```
AUTHORIZATION_SEMANTICS_UNCHANGED = YES
```

El predicado keyset (sección 14) se agrega con `AND` al `WHERE` que ya
existe hoy — no lo reemplaza ni lo reordena:

- Equipment: `WHERE user_id = $1 [AND archived_at IS NULL] [AND
  category_code = $N] AND (<predicado keyset>)` — el scope `/me` sigue
  siendo la primera condición, estructural, no derivada del cursor.
- Workouts: `WHERE (owner_id = $1 [OR owner_id IS NULL OR is_public =
  TRUE]) AND archived_at IS NULL AND (<predicado keyset>)` — la
  visibilidad (propio / catálogo / público / `mine=true`) sigue siendo
  exactamente la que ya implementa `WorkoutsRepository.findAllForUser`
  hoy.

Ningún cursor, válido o forjado, puede ampliar qué filas son visibles —
solo puede mover el punto de partida **dentro** del conjunto que la
autorización ya permite (ver también sección 15, threat model).

---

## 14. Mutation/concurrency semantics

No se promete snapshot isolation global entre requests — no existe hoy
en el backend (no hay transacción compartida entre el request de la
página N y el de la página N+1, y no hay evidencia de que se necesite:
ver sección 21, fuera de alcance). Se documenta explícitamente qué sí y
qué no está garantizado:

```
STATIC_DATASET_NO_DUPLICATES = REQUIRED (garantizado por construcción:
  el predicado keyset usa una desigualdad estricta sobre un orden total
  — sección 7 — así que sobre un dataset que no cambia durante la
  travesía, ninguna fila puede aparecer dos veces)
STATIC_DATASET_NO_OMISSIONS  = REQUIRED (mismo razonamiento: la
  desigualdad estricta cubre exactamente el resto del orden total sin
  huecos)
CONCURRENT_MUTATION_SNAPSHOT = NOT_GUARANTEED
```

Comportamiento documentado bajo mutaciones concurrentes:

- **Fila nueva insertada** durante la travesía: `created_at` se asigna
  por `now()` en el momento del `INSERT`, siempre posterior al momento
  en que ya se leyó cualquier página anterior de la travesía en curso.
  Por lo tanto la fila nueva siempre ordena en o después del punto donde
  la travesía ya está parada — nunca puede "colarse" en una página ya
  entregada (no genera duplicado) ni queda fuera del rango que aún falta
  recorrer (no genera omisión del resto de la travesía). Sí puede faltar
  en un refetch completo desde el principio si el usuario vuelve a pedir
  la página 1 después — comportamiento esperado y estándar de keyset
  pagination, no un bug.
- **Fila archivada** durante la travesía: el archivado no cambia
  `created_at`/`id` (los campos de orden) — si la fila deja de cumplir
  el filtro de visibilidad (p. ej. `includeArchived=false`), simplemente
  deja de aparecer en páginas siguientes; si ya se había entregado en
  una página anterior, esa entrega no se revoca (no hay "un-send"). Es
  el mismo comportamiento que tendría un `DELETE` durante un scan en
  cualquier paginación por keyset sin versionado — no es un duplicado ni
  una omisión en el sentido de la sección 7, es un cambio del conjunto
  de resultados, documentado como esperable.
- **Fila modificada** (nombre, estado, etc.): `updated_at` cambia,
  `created_at`/`id` (la clave de orden) nunca cambia en ningún `UPDATE`
  existente — la fila conserva su posición exacta en la travesía keyset.
- **Cambios de visibilidad** (Workouts: `isPublic` vía `PATCH`): mismo
  razonamiento que "fila archivada" — puede entrar o salir del conjunto
  filtrado sin afectar el orden de las filas que sí se mantienen
  visibles.

---

## 15. Error contract

Todos los errores de paginación se implementan con la clase de error ya
existente (`backend/src/common/exceptions/api.exception.ts`,
`ApiException(status, code, message, details)`), sin introducir un
mecanismo nuevo:

```
MALFORMED_CURSOR_STATUS = 400   (code: PAGINATION_CURSOR_INVALID)
INVALID_LIMIT_STATUS    = 400   (code: PAGINATION_LIMIT_INVALID)
FILTER_MISMATCH_STATUS  = 400   (code: PAGINATION_CURSOR_FILTER_MISMATCH)
```

Validación fail-closed del cursor recibido (Fase O), en orden:

1. Es un string, dentro de `MAX_CURSOR_LENGTH` — si no, `400`.
2. Decodifica como base64url válido — si no, `400`.
3. El contenido decodificado es JSON válido — si no, `400`.
4. El JSON matchea exactamente el schema esperado (`v`, `createdAt`,
   `id`, `f`; sin campos extra) — si no, `400`.
5. `v` es una versión conocida por este servidor (hoy: `1`) — si no,
   `400` (nunca se intenta interpretar un cursor de una versión
   desconocida con reglas de otra versión).
6. `createdAt` es un timestamp válido con el formato esperado — si no,
   `400`.
7. `id` es un UUID canónico válido — si no, `400`.
8. `f` recalculado a partir de los filtros del request actual coincide
   con `f` — si no, `400` (`PAGINATION_CURSOR_FILTER_MISMATCH`).

Ningún paso de esta validación devuelve `500` ni ignora el cursor en
silencio — cualquier fallo es un `400` explícito con `code` distinguible
para que el cliente (y los tests) puedan diferenciar la causa exacta.

### 15.1 Cursor firmado — evaluación de threat model

```
CURSOR_SIGNATURE_REQUIRED = NO
```

El cursor codifica únicamente posición (`createdAt`, `id`) más un
fingerprint de filtros — nunca autoridad. Manipularlo no permite:

- **Leer datos de otro usuario**: el `WHERE` de ownership/visibilidad
  (sección 13) es estructural y se aplica con independencia total del
  contenido del cursor — un cursor forjado solo cambia el punto de
  partida **dentro** del conjunto ya autorizado del propio usuario.
- **Saltarse ownership**: mismo razonamiento — no hay ningún camino en
  el diseño donde el cursor determine qué `user_id`/`owner_id` se
  consulta.
- **Modificar datos**: son endpoints `GET`; el cursor nunca llega a un
  path de escritura.
- **Superar `MAX_LIMIT`**: `limit` se valida de forma completamente
  independiente del cursor en cada request (sección 9.3) — no viaja
  dentro del cursor.

El peor caso de un cursor forjado bien formado (JSON válido, versión
conocida, UUID con formato válido, fingerprint que por casualidad
coincide) es que el servidor arranque la travesía desde una posición
arbitraria **dentro del propio conjunto ya autorizado del usuario** —
funcionalmente equivalente a lo que ese mismo usuario ya puede lograr
hoy sin ningún cursor (pedir su propia lista completa y mirar donde
quiera). No es un límite de seguridad real; firmarlo sería
sobre-ingeniería sin una amenaza que lo justifique.

---

## 16. Flutter compatibility / rollout

Task13 **solo documenta** lo que Task16 deberá implementar. Nada de
esta sección se ejecuta en esta tarea.

### 16.1 Contrato para el futuro helper de agotamiento de páginas

Un futuro `fetchAll` (mismo nombre que ya usa
`WorkoutsRemoteDataSource.fetchAll`, coherente con la arquitectura
encontrada) migrado a modo paginado debe:

1. Pedir la primera página con `limit` (reutilizar `DEFAULT_LIMIT = 50`
   como tamaño de página, salvo que Task16 justifique otro valor) y los
   mismos filtros que hoy (`mine` / `category` + `includeArchived`).
2. Acumular los `items` del body de cada página en una lista creciente.
3. Leer el header `X-Next-Cursor` de la respuesta; si está presente,
   repetir el request con el mismo `limit` y los mismos filtros más
   `cursor=<ese valor>`; si está ausente, detenerse — esa fue la última
   página.
4. Aplicar un techo duro de iteraciones (p. ej. 200 páginas) como
   protección defensiva contra un cursor que ciclara por un bug de
   servidor — si se alcanza el techo, tratarlo como error y propagarlo,
   nunca como "fin silencioso de la lista".
5. No duplicar items: el diseño del servidor ya lo garantiza sobre un
   dataset estático (sección 14); un `Set`/dedup por `id` en el cliente
   es opcional, no obligatorio.
6. No omitir items: mismo razonamiento — el cliente confía en la
   garantía del servidor, no necesita lógica propia de detección de
   huecos.
7. Conservar los filtros idénticos en cada página del mismo walk (nunca
   cambiar `mine`/`category`/`includeArchived` a mitad de una travesía
   — cambiar de filtro implica arrancar una travesía nueva desde la
   página 1, sin cursor).
8. Propagar errores exactamente por el mismo camino que ya usa
   `WorkoutsRepositoryImpl` (`Either<Failure, List<Workout>>` vía
   `AppErrorHandler.handle`) — ningún fallo de una página intermedia se
   traga en silencio.

### 16.2 Dependencia explícita para Equipment

Equipment no tiene consumidor Flutter hoy (sección 3.1). Si para cuando
Task16 se ejecute todavía no existe un feature de Equipment en Flutter,
la parte de Task16 relativa a Equipment queda automáticamente diferida
hasta que ese feature exista — el contrato de este documento (secciones
10 y 16.1) ya queda listo para cuando se necesite, sin bloquear el
cierre de la parte de Workouts.

---

## 17. Backend test matrix

Tests obligatorios para Task14 (no se escriben en esta tarea). Aplican a
ambos endpoints salvo que se indique lo contrario.

1. `limit` por defecto (sin `limit`, con `cursor`) devuelve
   `DEFAULT_LIMIT` filas cuando hay más disponibles.
2. `limit` explícito en el máximo (`limit=100`) es aceptado.
3. `limit > MAX_LIMIT` → `400 PAGINATION_LIMIT_INVALID`.
4. Cursor malformado (base64url inválido / JSON inválido / schema
   incorrecto) → `400 PAGINATION_CURSOR_INVALID`.
5. Cursor con `v` desconocida → `400 PAGINATION_CURSOR_INVALID`.
6. Primera página: sin `cursor`, con `limit`, devuelve las primeras N
   filas en el orden `created_at DESC, id DESC` y `X-Next-Cursor`
   correcto si hay más.
7. Página intermedia: con `cursor` de una página anterior, continúa
   exactamente donde la anterior terminó, sin solapamiento.
8. Última página: `rows.length <= limit` → sin header
   `X-Next-Cursor`.
9. Colección vacía: `200`, body `[]`, sin header.
10. Mismo `created_at` en varias filas (test que fuerza el empate,
    p. ej. insertando filas dentro de la misma transacción/lote) no
    produce duplicados ni omisiones a lo largo de una travesía completa.
11. Desempate por `id DESC` verificado explícitamente con filas de
    `created_at` idéntico.
12. Recorrido completo de un dataset conocido (N filas, page size < N)
    no produce duplicados.
13. Recorrido completo del mismo dataset no omite ninguna fila.
14. Filtros de Equipment (`category`, `includeArchived`) se conservan
    correctamente entre páginas de una misma travesía.
15. `mine` de Workouts se conserva correctamente entre páginas.
16. Ownership de Equipment (`/me`-scope) permanece intacto en modo
    paginado — un usuario no puede ver equipamiento ajeno vía cursor.
17. Visibilidad de Workouts (propios / catálogo / públicos / `mine`)
    permanece intacta en modo paginado.
18. Cursor generado bajo un filtro y reenviado con un filtro distinto →
    `400 PAGINATION_CURSOR_FILTER_MISMATCH`.
19. Ninguna respuesta, bajo ningún `limit` válido, supera `MAX_LIMIT`
    filas.
20. Cliente legacy (sin `limit` ni `cursor`) recibe exactamente el mismo
    array completo y el mismo shape que antes de Task14 — test de
    regresión explícito contra el contrato actual (sección 1).

---

## 18. Performance and index hypotheses

```
INDEX_HYPOTHESIS_ONLY = YES
INDEX_CREATION_DEFERRED_TO_TASK15 = YES
```

No se crea ningún índice ni migración en esta tarea. Las siguientes son
**hipótesis** a validar por Task15 con `EXPLAIN`/`EXPLAIN ANALYZE` sobre
un dataset representativo, derivadas de los `WHERE` reales auditados en
la sección 1 (no inventadas):

- **Equipment**: `(user_id, created_at DESC, id DESC)` — cubre
  exactamente el filtro estructural (`user_id = $1`) más el orden
  keyset completo. `category_code`/`archived_at` son selectivos pero
  opcionales — Task15 decide con evidencia si conviene un índice parcial
  adicional (p. ej. `WHERE archived_at IS NULL`) o si el índice base
  alcanza.
- **Workouts**: el `WHERE` real tiene dos formas según `mineOnly`
  (`owner_id = $1` vs `owner_id = $1 OR owner_id IS NULL OR is_public =
  TRUE`) — la segunda no es sargable de forma trivial con un único
  índice B-tree simple. Hipótesis a evaluar en Task15:
  `(owner_id, created_at DESC, id DESC)` para el camino `mineOnly`, y
  por separado si el camino de catálogo+públicos necesita un índice
  distinto (p. ej. parcial `WHERE owner_id IS NULL OR is_public = TRUE`)
  o si el volumen real no lo justifica.

No se etiqueta ninguna de estas dos hipótesis como `INDEX_REQUIRED` —
esa palabra se reserva para lo que Task15 confirme con `EXPLAIN`.

---

## 19. Task14 / Task15 / Task16 boundaries

```
TASK14 = implementación backend (DTOs, validación de limit/cursor,
         codec de cursor v1, predicado keyset, header X-Next-Cursor,
         modo legacy intacto, tests de la sección 17)
TASK15 = evidencia de rendimiento — dataset representativo + EXPLAIN /
         EXPLAIN ANALYZE contra las hipótesis de la sección 18; crea
         índices SOLO si la evidencia lo respalda
TASK16 = Flutter — WorkoutsRemoteDataSource (y el datasource de
         Equipment si ya existe) migran al modo paginado según la
         sección 16; pruebas de no-truncamiento, no-duplicados,
         no-omisiones del lado cliente
```

Ninguna ventana rompe al cliente vigente:

- Antes de Task14: comportamiento actual, sin cambios.
- Durante/después de Task14: el default legacy (sección 6.1) sigue
  siendo idéntico al actual — el único consumidor real
  (`WorkoutsRemoteDataSource.fetchAll`) no envía `limit`/`cursor`, así
  que no nota ningún cambio hasta que Task16 lo migre explícitamente.
- Durante/después de Task15: solo agrega índices (o no, según
  evidencia) — cambio de rendimiento, no de contrato; no afecta shape ni
  comportamiento observable.
- Durante/después de Task16: el cliente pasa a pedir modo paginado a
  propósito, ya con el helper de la sección 16.1 diseñado para no
  truncar, no duplicar y no omitir.
- La fase Enforcement (sección 6.3), que sí podría cambiar el
  comportamiento del default legacy, queda fuera de Task14-16 por
  diseño explícito y requiere autorización separada — no hay ninguna
  tarea numerada todavía que la ejecute.

---

## 20. Acceptance criteria

Esta tarea (Task13) se considera completa porque este documento define,
con evidencia verificada contra el código real y no supuestos:

- [x] Contrato actual (sección 1).
- [x] Incompatibilidades actuales — riesgo de shape y de truncamiento
      silencioso (sección 4).
- [x] Estrategia compatible elegida, con justificación explícita
      (secciones 5-6).
- [x] Shape exacto de la respuesta en todos los casos (secciones 6.1,
      10, 11).
- [x] Parámetros exactos (`limit`, `cursor`, filtros existentes
      preservados — secciones 10.1, 11.1).
- [x] `limit` default/máximo, con justificación (sección 9).
- [x] Cursor opaco, versionado (sección 8).
- [x] `created_at + id` como orden total (sección 7).
- [x] Precisión de timestamp y por qué el `Date` de JS no alcanza
      (sección 8.2).
- [x] Predicado keyset (sección 14 y Fase I ya validada durante la
      auditoría — coherente con `DESC, DESC`).
- [x] `LIMIT N+1` como mecanismo de detección de "hay más páginas"
      (`HAS_MORE_DETECTION`, referenciado en secciones 9-10-11 vía el
      header `X-Next-Cursor`; algoritmo: pedir `limit+1`, si vuelven
      `limit+1` filas se devuelven las primeras `limit` y el cursor sale
      de la última devuelta, la fila `limit+1` nunca se entrega).
- [x] `nextCursor` (aquí, `X-Next-Cursor`) — semántica de página final
      (ausencia de header) definida sin ambigüedad (secciones 6.1, 10.2,
      11.2).
- [x] Filtros y su binding al cursor (sección 12).
- [x] Invariantes de autorización (sección 13).
- [x] Contrato de errores, `400` en todos los casos de input inválido
      (sección 15).
- [x] Concurrencia entre páginas documentada sin prometer snapshot
      global inexistente (sección 14).
- [x] Rollout backend→Flutter en fases explícitas, sin ventana de
      ruptura (secciones 6.3, 16, 19).
- [x] Matriz de tests futura de 20 ítems (sección 17).
- [x] Política de índices diferida a Task15, etiquetada como hipótesis
      (sección 18).
- [x] No-ruptura de clientes demostrable con evidencia del repo, no
      solo afirmada (secciones 3, 6.2).

```
KEYSET_PREDICATE_DEFINED = YES
```

Predicado exacto (para `ORDER BY created_at DESC, id DESC`, sobre el
`WHERE` de ownership/filtros ya existente):

```sql
AND (
  created_at < :cursor_created_at
  OR (created_at = :cursor_created_at AND id < :cursor_id)
)
```

Coherente con `DESC, DESC`: "estrictamente después" en el orden de
recorrido (descendente) significa un `created_at` estrictamente menor,
o igual `created_at` con un `id` estrictamente menor — exactamente lo
que selecciona la siguiente porción del recorrido sin repetir la
posición del cursor ni saltarse la fila inmediatamente siguiente.

---

## 21. Out of scope

Explícitamente no incluido en Task13 (documentación de diseño):

- Implementación de DTOs, controllers, repositories o el codec real del
  cursor.
- Cambios a `backend/`, `lib/`, `test/`, `integration_test/`,
  `migrations/`, `.github/workflows/`, o `PROJECT_STATUS.md`.
- Creación de índices o migraciones (Task15).
- Benchmark o generación de dataset de carga (Task15).
- Migración real de Flutter (Task16), incluyendo el feature de
  Equipment que todavía no existe.
- Ejecución de la fase Enforcement (sección 6.3) — requiere autorización
  explícita separada, no tiene tarea numerada asignada todavía.
- Firma criptográfica del cursor (evaluada y descartada en 15.1, sin
  amenaza que la justifique).
- Cualquier interacción con rate limiting (`T-F0.4`), Redis, u otras
  tareas del backlog — no auditadas ni modificadas aquí.
- Deployment, `workflow_dispatch`, mutación de base de datos Development,
  o cualquier otra acción fuera de lectura de código y escritura de este
  único documento Markdown.
