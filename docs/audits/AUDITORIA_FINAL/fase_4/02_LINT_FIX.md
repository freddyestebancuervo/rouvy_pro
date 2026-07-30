# 2. Corrección del fallo global de `npm run lint` en `test/**`

## Causa raíz

`.eslintrc.js` apuntaba `parserOptions.project` a `tsconfig.json`, cuyo
`include` es únicamente `["src/**/*"]` (correcto para `nest build`, que no
debe compilar tests al `dist/`). `typescript-eslint` necesita que **todo**
archivo que lintea esté incluido en el programa TypeScript que le indica
`project` para las reglas type-aware — como ningún archivo de `test/**` estaba
incluido, cada uno fallaba con un error de parsing:

```
Parsing error: ESLint was configured to run on `.../test/utils/test-app.ts`
using `parserOptions.project`: `.../tsconfig.json`. However, that TSConfig
does not include this file.
```

## Corrección (sin excluir tests, sin silenciar reglas)

Se creó `backend/tsconfig.eslint.json`, exclusivo para ESLint, que extiende el
tsconfig real y agrega `test/**/*` a `include`:

```json
{
  "extends": "./tsconfig.json",
  "include": ["src/**/*", "test/**/*"],
  "compilerOptions": { "noEmit": true }
}
```

Y se apuntó `.eslintrc.js` → `parserOptions.project: 'tsconfig.eslint.json'`.
`tsconfig.json` (el que usa `nest build`) no se tocó — sigue excluyendo
`test/**` del build de producción.

## Verificación

- `npx eslint "{src,test}/**/*.ts"` → **0 errores**, exit code 0.
- `npm run lint` (con `--fix`) → sin salida, sin errores.
- `npm run build` tras el cambio → `dist/` no contiene ningún archivo de
  `test/**/*.e2e-spec.ts` (confirmado con `find dist -iname "*e2e*"` → vacío).
  Los `*.spec.ts` presentes en `dist/` son los co-ubicados en `src/**`
  (situación preexistente, no introducida por este cambio — no tocada, fuera
  de alcance de esta corrección puntual de lint).

Ningún test fue excluido del linting y ninguna regla fue desactivada o
suavizada — la corrección es exclusivamente de configuración de TypeScript
para ESLint.
