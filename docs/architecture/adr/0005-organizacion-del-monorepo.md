# ADR-0005: Organización del monorepo

- **Fecha:** 2026-07-24
- **Estado:** Aceptado (formaliza la estructura ya vigente)

## Contexto

El repositorio contiene hoy, en una sola raíz de git: el cliente Flutter (`lib/`, `test/`, `android/`, `ios/`, `web/`), el backend NestJS (`backend/`), configuración de Firebase (`firestore.rules`, `firebase.json`, `firebase/`), y documentación (`docs/`, `*.md` de raíz). No hay separación en repositorios distintos ni en un workspace de tipo Nx/Turborepo con paquetes compartidos.

## Decisión

**Mantener un único repositorio (monorepo simple, sin herramienta de workspace dedicada)**, con las siguientes reglas:

1. **`backend/` es un proyecto Node/NestJS autocontenido** — su propio `package.json`, su propio `node_modules/`, su propio `tsconfig.json`. No comparte código fuente con Flutter (no hay, ni se propone, un paquete de tipos/DTOs compartido entre TypeScript y Dart).
2. **`firebase/rules-tests/` y `firebase/seed/`** son sub-proyectos Node igualmente autocontenidos, cada uno con su propio `package.json` — mismo patrón, sin dependencias cruzadas entre ellos ni con `backend/`.
3. **`lib/` (Flutter) es el único cliente** — no hay ni se propone un segundo cliente (p. ej. un panel de administración en React/Next.js) que justificaría estructurar esto como un monorepo con paquetes compartidos de verdad.
4. **La documentación vive junto al código que describe** (`docs/` para specs/auditorías/arquitectura, `*.md` de raíz para guías operativas de setup) — no se centraliza en un wiki externo, para que el historial de git sea la fuente de verdad de cuándo cambió cada decisión.

## Alternativas descartadas

1. **Separar en repositorios independientes** (`rouvy-app`, `rouvy-backend`, `rouvy-firebase`). Descartada: con un único desarrollador/agente por sesión de trabajo y sin necesidad de permisos de acceso diferenciados por equipo, la fricción de coordinar cambios que cruzan cliente+backend (como el propio Bloque D, que tocó ambos) en PRs separados no se justifica. Un monorepo permite un solo PR/commit que cambie el contrato de API en el backend y su consumo en Flutter a la vez, con CI validando ambos lados del cambio junto.
2. **Adoptar una herramienta de workspace** (Nx, Turborepo, melos para Dart). Descartada por ahora: estas herramientas resuelven problemas de monorepos con **muchos paquetes que se importan entre sí** (build incremental, caché de tareas, versionado coordinado) — este repo no tiene ese problema porque Flutter y NestJS no comparten código fuente ni se importan mutuamente. Adoptar la herramienta sin ese problema sería complejidad sin beneficio medible.
3. **Extraer un paquete de tipos compartidos** (p. ej. generar tipos Dart desde los DTOs de NestJS, o un esquema OpenAPI compartido). Descartada por ahora, pero **no descartada para siempre** — ver plan de transición T13 (tests de contrato): si la duplicación manual de forma de DTO entre `backend/src/modules/*/dto/` y `lib/features/*/data/models/` empieza a causar bugs reales de desincronización, esta decisión debe revisarse. Hoy no hay evidencia de que haya ocurrido.

## Consecuencias

- Un cambio que afecte a ambos lados (cliente y backend) se revisa y se comitea en el mismo repositorio, facilitando trazabilidad — ya es el patrón usado en las sesiones de Bloque D documentadas en `ROADMAP_M0_M1.md`.
- CI necesita jobs separados por sub-proyecto (`flutter-checks`, `backend-tests`, `firestore-rules-tests`) porque no hay una herramienta de workspace que infiera automáticamente qué construir/testear según qué cambió — cada job hoy corre siempre completo, sin path-filtering. Aceptable al volumen actual (minutos de CI, no horas); revisar si el tiempo total de CI se vuelve un problema real.
- La carpeta `docs/architecture/` (este documento y sus ADRs) y `docs/audits/` se consolidan como el lugar canónico para decisiones de arquitectura de aquí en adelante, en vez de que cada sesión cree un documento suelto en la raíz — reduce la dispersión ya visible hoy (10 archivos `.md` en la raíz del repo, algunos ya desactualizados como `CI_CD_GUIDE.md`).

## Riesgos

- Si el equipo crece a varios desarrolladores trabajando en paralelo en cliente y backend, la falta de path-filtering en CI (correr los 3 jobs siempre, aunque un cambio solo toque Flutter) empieza a costar tiempo de espera innecesario. Mitigación de bajo riesgo cuando ocurra: `paths:`/`paths-ignore:` en `ci.yml` por job — cambio aditivo, no estructural.
- La ausencia de una herramienta de workspace significa que cualquier futura necesidad real de compartir código (tipos, validadores) requeriría introducir tooling nuevo en ese momento, no antes — riesgo aceptado conscientemente (mismo criterio anti-sobreingeniería del resto de este documento).
