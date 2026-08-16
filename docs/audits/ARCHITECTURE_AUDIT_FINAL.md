# Auditoría final — Documento 1: Arquitectura General del Sistema

- **Fecha:** 2026-07-24
- **Rama:** `feature/d2`
- **HEAD al iniciar y al terminar esta tarea:** `d3d01d8` (sin cambios — esta tarea no genera ningún commit, ver confirmación al final)
- **Rol:** arquitecto principal / desarrollador senior, modo autónomo (instrucción del propietario: trabajar sin pedir confirmación intermedia, deteniéndome solo ante riesgo de pérdida de datos, operaciones irreversibles, o un hallazgo de seguridad crítico que requiera su decisión)
- **Alcance de esta tarea:** auditar el estado real del repositorio y producir 3 documentos de arquitectura. **No se implementó ningún módulo funcional nuevo, no se modificó código de producción, no se hizo commit.**

---

## 1. Resumen ejecutivo

Se auditó el repositorio completo (cliente Flutter, backend NestJS, Firebase, CI/CD, documentación existente) y se produjeron los 3 documentos pedidos:

- `docs/architecture/01_SYSTEM_ARCHITECTURE.md` — documento maestro: estado actual con evidencia, arquitectura objetivo por capas, estrategia modular (19 módulos definidos, ninguno implementado), decisión de backend (monolito modular), estrategia de datos con tabla de fuente de verdad, entornos, multiplataforma, seguridad con riesgos clasificados, offline/sync (contrato, no implementación), rendimiento, pruebas, CI/CD, plan de transición priorizado (P0-P3), diagramas Mermaid.
- `docs/architecture/adr/0001` a `0007` — 7 registros de decisión (monolito vs. microservicios, PostgreSQL vs. Firestore, estrategia de autenticación, arquitectura offline, organización del monorepo, manejo de entornos, adaptadores multiplataforma), cada uno con contexto, decisión, alternativas descartadas, consecuencias y riesgos.
- Este documento.

**Hallazgo estructural principal**: el proyecto tiene **dos sistemas de autenticación y persistencia independientes en paralelo** (Firebase para 8 de 10 features; NestJS+PostgreSQL para Workouts/Equipment) sin puente entre ellos — ya documentado como deuda técnica por el propio código (`dev_backend_test_user.dart`), formalizado acá como riesgo **P0** con plan de convergencia (ADR-0003).

**Riesgo crítico identificado y NO resuelto** (requiere decisión del propietario, según sus propias instrucciones): un único proyecto Firebase (`ridepro-dbafe`) sirve tanto para lo que sería desarrollo como para lo que sería producción — no hay separación de entornos a nivel de Firebase. Me detuve en este punto, lo documenté (sección 8 del documento de arquitectura y ADR-0006), y no ejecuté ningún cambio — no es una acción destructiva, pero crear infraestructura Firebase nueva tiene costo real y es una decisión de negocio, no solo técnica.

**Ningún módulo nuevo fue implementado.** El código de producción (`lib/`, `backend/src/`) no fue modificado en absoluto durante esta tarea — verificado con `git status` (ver sección 3).

---

## 2. Archivos inspeccionados

**Documentación existente, leída completa o en secciones dirigidas:**
`ARCHITECTURE_DECISIONS.md`, `docs/OFFLINE_FIRST.md`, `docs/SECURITY_AUDIT.md`, `CI_CD_GUIDE.md`, `docs/TECHNICAL_SPECIFICATION_M0_M1.md` (secciones 0, 1, 5-10), `docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md` (sección 0), `ROADMAP_M0_M1.md` (encabezados, para no contradecir clasificaciones ya existentes), `docs/AUDITORIA_FINAL.md` (contexto de sesiones previas del mismo día), `pubspec.yaml`.

**Código inspeccionado por estructura (no línea por línea en su totalidad, dado el volumen):**
- `lib/` completo (estructura de directorios de `app/`, `core/` con sus 11 subcarpetas, `demo/`, los 10 `features/*`, `l10n/`).
- `backend/src/` completo (estructura de `common/`, `config/`, `database/`, `jwt/`, los 5 `modules/*`).
- `test/` (Flutter) y `backend/test/`/`backend/src/**/*.spec.ts` — conteo y ubicación, no contenido línea por línea (ya validado en sesiones previas del mismo día, ver `docs/AUDITORIA_FINAL.md`).
- `lib/features/training/presentation/providers/ride_session_controller.dart` — lectura dirigida (mención de ANT+, `checkForRecoverableSnapshot`).
- `lib/core/config/dev_backend_test_user.dart` — releído para el hallazgo de auth dual (ya modificado en una sesión previa del mismo día, no en esta tarea).

**Verificación de ausencia** (evidencia negativa, tan importante como la positiva): `windows/` (carpeta de plataforma), `Dockerfile`/`docker-compose.yml`, `integration_test/` (directorio), uso de `package:logger`, uso de `audit_log` en el backend, dependencias `video_player`/`workmanager`/`ant`.

---

## 3. Comandos ejecutados

Todos de solo lectura (`find`, `grep`, `git status`, `git remote`, `git branch`, `git log`, `wc -l`, `cat`) salvo la creación de los archivos nuevos y una edición de `.gitignore` (ver sección 4). Comandos representativos:

```bash
find lib -type f -name "*.dart" | sed 's|/[^/]*$||' | sort -u
for d in lib/features/*/; do echo "$d: $(find "$d" -name "*.dart" | wc -l) archivos"; done
find backend/src -name "*.ts" -not -name "*.spec.ts" | sort
find . -maxdepth 3 -iname "Dockerfile*" -o -iname "docker-compose*"
find test -name "*_test.dart" | wc -l
find backend/src -name "*.spec.ts" | wc -l
find backend/test -name "*.e2e-spec.ts" | wc -l
grep -rln "audit_log" backend/src
grep -rli "ant+|antplus|ant_plus" lib backend/src pubspec.yaml
grep -i "video_player|chewie" pubspec.yaml
grep -rli "download" lib/features --include="*.dart"
grep -i "workmanager|background_fetch|flutter_background" pubspec.yaml
grep -rln "package:logger" lib --include="*.dart"
find . -path "*/integration_test/*" -name "*.dart"
ls -d */   # confirma ausencia de windows/
git remote -v
git branch -vv
git status --short
git log -1 --format="%h %s"
```

Resultados de cada uno ya incorporados como evidencia citada en `01_SYSTEM_ARCHITECTURE.md` (sección 1, con referencia directa a qué comando sostiene cada afirmación).

---

## 4. Cambios realizados

| Archivo | Tipo de cambio | Motivo |
|---|---|---|
| `docs/architecture/01_SYSTEM_ARCHITECTURE.md` | **Nuevo** | Documento maestro pedido |
| `docs/architecture/adr/0001` a `0007-*.md` | **Nuevos** (7 archivos) | ADRs pedidos |
| `docs/audits/ARCHITECTURE_AUDIT_FINAL.md` | **Nuevo** | Este documento |
| `.gitignore` | **Modificado** (aditivo, 1 regla) | `devtools_options.yaml` apareció como untracked durante esta sesión — generado automáticamente por herramientas de Flutter (`flutter analyze`/`flutter test`/DevTools) en sesiones previas del mismo día, nunca por esta tarea. Se ignora por ser config local de tooling sin contenido específico del proyecto, mismo criterio ya aplicado esta semana a `node_modules/`/`.playwright-mcp/`/`coverage/` (ver `docs/AUDITORIA_FINAL.md`). |

**Ningún archivo de código de producción fue tocado** (`lib/**/*.dart` salvo lo ya listado como *lectura*, `backend/src/**/*.ts`, migraciones, tests). **Ningún módulo nuevo de la sección 3 del documento de arquitectura fue implementado** — son definiciones de contrato, no código.

**No se ejecutó ningún `git add` ni `git commit`** para estos cambios — quedan en el working tree, sin trackear/modificados, a la espera de revisión, tal como pidió explícitamente el propietario ("No hagas commits hasta mostrarme primero el plan y los archivos que serían incluidos").

---

## 5. Pruebas ejecutadas y resultados

**Esta tarea no modifica código de producción, por lo que no aplica volver a correr `flutter test`/`npm test` como parte de ella** — no hay código nuevo que probar. El estado de esas suites, validado en la sesión de trabajo previa del mismo día (2026-07-23→24, ver `docs/AUDITORIA_FINAL.md`) y sin cambios desde entonces (confirmado con `git status` — cero archivos de código modificados), es:

| Suite | Resultado | Cuándo se validó |
|---|---|---|
| `flutter analyze --fatal-infos` | ✅ No issues found! | Sesión previa, mismo día |
| `flutter test` | ✅ 186/186 | Sesión previa, mismo día |
| `npm test` (backend, unitarios) | ✅ 73/73, 8/8 suites | Sesión previa, mismo día |
| `npm run test:e2e` (backend, contra Postgres real en Docker) | ✅ 57/57, 7/7 suites | Sesión previa, mismo día |
| `npm run lint` / `tsc --noEmit` / `npm run build` (backend) | ✅ sin errores | Sesión previa, mismo día |

**Verificación propia de esta tarea**: `git status --short` confirma que, al momento de escribir este documento, el único cambio de código (no-documentación) es la línea añadida a `.gitignore` (sección 4) — cero archivos `.dart`/`.ts` modificados. No se requiere ninguna suite de pruebas adicional para documentación Markdown.

---

## 6. Riesgos pendientes

Clasificados igual que en la sección 8 del documento de arquitectura, para consulta rápida acá:

| Riesgo | Severidad | Requiere autorización del propietario para resolver |
|---|---|---|
| Un único proyecto Firebase para todos los entornos | **Crítico** | **Sí** — costo real, decisión de infraestructura |
| Auth NestJS sin puente con Firebase Auth (solo cuenta QA de debug) | **Alto** | No para diseñar (ya en ADR-0003); sí para priorizar la implementación (T2) |
| `audit_log` sin escritura real | Medio | No — es un cambio aditivo de bajo riesgo cuando se priorice |
| Sin tests de contrato Flutter↔NestJS | Medio | No |
| Rotación de historial de git (contraseñas QA en commits anteriores a esta semana) | Medio | **Sí** — reescritura de historial, explícitamente fuera de lo que puedo ejecutar sin autorización |
| Sin Docker Compose para desarrollo reproducible | Bajo | No |
| `applicationId`/`package_name` de Android en placeholder | Bajo | Sí (decisión de producto: nombre final) |
| `windows/` sin generar | Medio | No — es una tarea técnica (T7), sin decisión de negocio pendiente |

**No encontré ningún hallazgo que alcance el criterio de "deténme ahora mismo, en medio de la tarea"** definido por el propietario (riesgo de pérdida de datos, operación irreversible, o vulnerabilidad crítica activa que exija remediación inmediata) — el riesgo crítico (Firebase único) es real pero no es una vulnerabilidad *explotable hoy mismo por un tercero*: es una ausencia de aislamiento de entornos, cuya corrección es una decisión de infraestructura a programar, no una emergencia que justifique interrumpir la entrega de este documento. Se documenta con la severidad que le corresponde y se deja para decisión explícita del propietario, sin bloquear el resto del trabajo.

---

## 7. Decisiones tomadas (y su justificación breve)

1. **Priorizar la lectura de documentación existente antes de escribir cualquier cosa nueva** — evitó contradecir decisiones ya tomadas (p. ej. el patrón Adapter de wearables, la decisión "todo lo nuevo a Postgres" de Bloque D) y permitió citar evidencia real en vez de reinventar análisis ya hecho.
2. **No releer en detalle código ya auditado exhaustivamente en sesiones previas del mismo día** (CORS, credenciales QA, CI, JWT) — se referencia `docs/AUDITORIA_FINAL.md` en vez de repetir el trabajo, cumpliendo la instrucción explícita del propietario de no reiniciar análisis ya hecho.
3. **Clasificar el riesgo del proyecto Firebase único como "crítico, pero no de parada de emergencia"** — ver justificación en sección 6. Decisión propia, documentada para que el propietario pueda objetarla si su criterio de severidad difiere.
4. **No implementar ningún módulo de la sección 3** ni siquiera a nivel de esqueleto de carpetas — interpretación estricta de "no implementes estos módulos, solo define" del encargo original.
5. **No commitear nada** — interpretación literal de "no hagas commits hasta mostrarme primero el plan y los archivos que serían incluidos": este documento y los demás quedan en el working tree para revisión.
6. **Agregar la única línea a `.gitignore`** pese a la instrucción de no commitear — se consideró un cambio de higiene menor, aditivo, sin relación con la tarea de arquitectura en sí, coherente con la regla permanente ya establecida el mismo día sobre no dejar artefactos de tooling sin ignorar. Se deja igualmente sin commitear, sujeto a la misma revisión que el resto.

---

## 8. Próximos pasos

Ver el plan de transición completo (sección 13 de `01_SYSTEM_ARCHITECTURE.md`) para la lista priorizada P0-P3 con 15 acciones. Resumen de los primeros pasos recomendados, en orden:

1. **Revisar y aprobar (o corregir) estos 3 documentos** — nada se ejecuta de acá en adelante sin que el propietario los revise, según sus propias instrucciones.
2. **T1** — Autorizar el `push` del fix de CI ya commiteado localmente en una sesión previa (`79a073c`), pendiente desde entonces por la misma razón (no hacer push sin autorización).
3. **T9** — Decidir sobre la separación de proyectos Firebase por entorno (el riesgo crítico de la sección 6) — requiere decisión y presupuesto del propietario.
4. **T3, T4, T5, T6, T7** (P1, sin dependencias entre sí) — auditoría de acciones críticas, idempotencia en endpoints, Docker Compose, extensión de CI, generación del proyecto Windows.
5. **T2** — Implementar el puente de autenticación Firebase↔NestJS (ADR-0003), una vez priorizado.

---

## 9. Confirmación explícita

- ✅ **No ejecuté `git push`** en ningún momento de esta tarea.
- ✅ **No ejecuté ningún `merge`.**
- ✅ **No hice ningún despliegue.**
- ✅ **No eliminé código funcional** — no se tocó ningún archivo de `lib/` ni `backend/src/` salvo lectura.
- ✅ **No inicié el desarrollo de ningún módulo nuevo** — la sección 3 del documento de arquitectura son contratos, no código.
- ✅ **No hice ninguna reescritura general** del proyecto.
- ✅ **No introduje microservicios, Redis, Kafka ni tecnologías nuevas** — la decisión (ADR-0001) es explícitamente no hacerlo sin necesidad comprobada.
- ✅ **No guardé ninguna credencial en el repositorio.**
- ✅ **No hice ningún commit** — todos los archivos nuevos/modificados de esta tarea están en el working tree sin trackear/sin stagear, a la espera de revisión.
- ✅ **Me detuve y documenté** (sin ejecutar un cambio destructivo) ante el único hallazgo que se acerca al umbral de decisión del propietario: la falta de separación de proyectos Firebase por entorno (sección 6, ADR-0006).
