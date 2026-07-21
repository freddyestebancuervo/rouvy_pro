# Tests de seguridad de las reglas de Firestore

Verifica automáticamente `../../firestore.rules` contra el emulador local
de Firestore — nunca contra el proyecto de producción.

## Requisitos previos

- Node.js 18+
- Firebase CLI instalada globalmente: `npm install -g firebase-tools`
- Java 11+ (lo requiere el emulador de Firestore internamente)

## Seguridad: por qué no hay riesgo de tocar el proyecto real

El `projectId` usado en todas partes (`.firebaserc` en la raíz del
proyecto, y el propio test) es `demo-ridepro-security-tests` — el
prefijo `demo-` no es solo un nombre descriptivo: el SDK de Firebase lo
reconoce específicamente y activa un modo que **nunca requiere
autenticación real ni puede resolver a un proyecto de Firebase
existente**. Es estructuralmente imposible que estos tests, corridos con
`emulators:exec`, escriban en un proyecto de producción — no hace falta
recordar pasar `--project` cada vez ni confiar en que nadie se
equivoque.

## Ejecutar

```bash
cd firebase/rules-tests
npm install
npm test
```

`npm test` levanta el emulador de Firestore automáticamente
(`firebase emulators:exec`), corre la suite completa con Jest, y apaga el
emulador al terminar — no hace falta arrancarlo manualmente ni tener
ninguna otra terminal abierta.

**Nota de estructura:** `firebase.json` vive en la raíz del proyecto
(`rouvy_pro/`), dos niveles por encima de esta carpeta — por eso el
script `test` de `package.json` incluye `--config ../../firebase.json`.
Si corres el comando de `emulators:exec` manualmente en vez de vía `npm
test`, necesitas ese mismo flag (o ejecutarlo desde la raíz del proyecto
en su lugar):
```bash
# Desde firebase/rules-tests/:
firebase emulators:exec --config ../../firebase.json --project=demo-ridepro-security-tests --only firestore "npm run test:rules"
```

## Qué cubre `firestore.rules.test.js`

- **Ataque 1:** crear una cuenta con `role="admin"`/`"coach"` directamente.
- **Ataque 2:** modificar `role` después de la creación (incluyendo el
  intento de colarlo junto a un cambio legítimo en el mismo `update`).
- **Ataque 3:** modificar `permissions`, `subscription`, `isAdmin`,
  `customClaims` o `premium`, tanto en `create` como en `update`.
- **Ataque 4:** leer/escribir el documento de otro usuario (perfil e
  historial de sesiones), y acceso sin autenticar.
- **Casos de control:** confirma que el uso legítimo (leer/editar el
  propio perfil, crear una sesión propia) sigue funcionando — sin esto,
  una regla que simplemente deniegue todo "pasaría" los tests de ataque
  de forma engañosa.

## Estado de ejecución

⚠️ **No se han ejecutado en el entorno donde se escribieron.** Node.js,
Java y npm SÍ estaban disponibles ahí — el bloqueo real fue la falta de
acceso a red (npm registry devolvía `403 Forbidden`), que impide tanto
instalar Firebase CLI como descargar las dependencias de este propio
`package.json`. Ver `docs/SECURITY_AUDIT.md` para el detalle. Antes de
considerar la tarea A3 del roadmap cerrada, correr esta suite en un
entorno con acceso a red y confirmar que los ~20 tests pasan.
