# Auditoría de seguridad — Escalada de privilegios vía `firestore.rules`

**Severidad:** Crítica · **Estado:** Mitigado en código (`firestore.rules`) y
**verificado con tests ejecutados contra el emulador real** (ver sección
final) — 2026-07-21.

---

## 1. La vulnerabilidad

Al implementar la tarea A2 del roadmap (añadir el campo `role` a
`users/{uid}`), la regla de Firestore propuesta originalmente en
`docs/TECHNICAL_SPECIFICATION_M0_M1.md` (sección 5.4) era:

```
allow update: if request.auth != null
              && request.auth.uid == uid
              && !request.resource.data.diff(resource.data)
                  .affectedKeys()
                  .hasAny(['role', 'premium']);

allow create: if request.auth != null && request.auth.uid == uid;
```

La regla de `update` protegía correctamente `role`/`premium` — pero la
regla de `create` **no imponía ninguna restricción sobre el contenido del
documento**, solo sobre quién podía crearlo (el propio `uid`). Un cliente
podía escribir, en la creación inicial de su propio documento, **cualquier
valor en cualquier campo**, incluyendo `role: "admin"`.

## 2. Cómo se explota (paso a paso)

Cualquier usuario autenticado, usando el SDK cliente de Firestore
directamente (sin necesidad de acceso especial, herramientas de
desarrollador, ni exploit técnico — es una llamada normal del SDK):

```javascript
// Ejecutable desde el propio navegador/app de un atacante, con una
// cuenta de usuario normal ya autenticada:
await setDoc(doc(firestore, `users/${myOwnUid}`), {
  email: 'attacker@example.com',
  displayName: 'Attacker',
  role: 'admin',        // ← la regla de `create` no lo impedía
});
```

Como la creación del documento ocurre en el primer login (ver
`AuthRemoteDataSourceImpl._fetchUserDocument` en el cliente Flutter, que
crea el documento con `.set()` si no existe todavía), y las reglas de
Firestore **no distinguen "esta escritura la hizo el código legítimo de
la app" de "esta escritura la hizo alguien llamando al SDK a mano"** — la
regla es la única barrera. Bastaba con que el atacante llamara al SDK de
Firestore directamente (posible desde cualquier cliente con las
credenciales de Firebase del proyecto, que son públicas por diseño — la
seguridad de Firebase depende enteramente de las reglas, no de ocultar la
configuración) para auto-otorgarse `role: "admin"` en su primer login.

## 3. Impacto (por qué es Crítico, no Medio/Bajo)

- **Cualquier verificación de rol que confíe en el campo `role` de
  Firestore** (paneles de admin, gates de funcionalidad premium/coach en
  el cliente, futuras Cloud Functions que lean este campo para decidir
  permisos) habría confiado en un dato que el propio atacante controlaba.
- No requiere ningún conocimiento técnico avanzado — es una llamada
  estándar del SDK, no una inyección ni un exploit de infraestructura.
- Se detectó **antes de que existiera ningún consumidor real del campo
  `role`** (el panel de administración todavía no está construido) — el
  campo se añadió en A2 y el hueco se cerró en A3, en el mismo ciclo de
  trabajo, sin ventana de exposición en producción.

## 4. La corrección (`firestore.rules`)

Dos cambios:

1. **La regla de `create` ahora sí valida el contenido**, no solo el
   autor:
   ```
   function _hasSafeDefaultsOnCreate(data) {
     let noDefaultAllowed = ['permissions', 'subscription', 'isAdmin', 'customClaims'];
     return !data.keys().hasAny(noDefaultAllowed)
            && (!('role' in data) || data.role == 'user')
            && (!('premium' in data) || data.premium == false);
   }
   ```
   - `permissions`, `subscription`, `isAdmin`, `customClaims`: prohibidos
     por completo en la creación — no existe un valor de estos campos que
     tenga sentido que un cliente proponga.
   - `role`: permitido ÚNICAMENTE si el valor es exactamente `'user'`
     (o si el campo no aparece en absoluto).
   - `premium`: permitido ÚNICAMENTE si es exactamente `false`.

2. **La lista de campos protegidos en `update` se amplió** de
   `['role', 'premium']` (la propuesta original) a
   `['role', 'permissions', 'subscription', 'isAdmin', 'customClaims', 'premium']`
   — cerrando también los otros campos sensibles que el encargo de esta
   tarea identificó explícitamente.

Ver `firestore.rules` (raíz del proyecto) para el archivo completo.

## 5. Cómo se garantizan los valores seguros por defecto (punto 3 del encargo)

El documento inicial de un usuario se crea, en la práctica, sin el campo
`role` en absoluto (`UserModel.toMap()` en el cliente Flutter nunca lo
incluye — ver `lib/features/auth/data/models/user_model.dart`). La regla
de `create` lo permite (rama `!('role' in data)`), y cualquier lectura
posterior sin el campo cae a `UserRole.user` por el fallback ya
implementado en `UserModel.fromMap` (tarea A2). El resultado neto: todo
usuario nuevo es `user` de forma segura, sin que ni el cliente ni las
reglas tengan que "confiar" en que el valor por defecto se escriba
correctamente — la ausencia del campo ES el valor seguro.

## 6. Cómo se asignan roles elevados (punto 4 del encargo)

**Nunca desde el cliente.** El único camino para que un usuario pase a
`premium`, `coach` o `admin` es:
- Un script de administración con Firebase Admin SDK (que se ejecuta con
  privilegios de servidor y **se salta estas reglas por completo** — es
  el mecanismo de diseño de Firestore para operaciones administrativas),
  como el ya existente `firebase/scripts/backfill_user_roles.js`.
- Una Cloud Function con Admin SDK, activada por un evento de confianza
  (p. ej. un webhook de Stripe confirmando un pago de suscripción premium,
  o una acción explícita de un admin autenticado en el futuro panel de
  administración, verificada server-side).

Ningún flujo de este proyecto, hoy, asigna roles desde el cliente — es
una propiedad que se mantiene por la ausencia de código cliente que lo
intente, reforzada ahora también por la regla que lo bloquearía aunque
existiera.

## 7. Tests automatizados (punto 5 del encargo)

`firebase/rules-tests/firestore.rules.test.js` — suite completa contra el
emulador de Firestore, cubriendo exactamente los 4 ataques exigidos más
casos de control positivos (ver `firebase/rules-tests/README.md` para el
desglose completo y las instrucciones de ejecución).

## 8. Verificación ejecutada — 2026-07-21

Corrido en un entorno con Node.js, Java (OpenJDK 21) y red disponibles
(`npm install` en `firebase/rules-tests` sin `403`/`ENOTFOUND`). Sin
`firebase-tools` instalado globalmente, se invocó vía `npx firebase-tools`
(evita una instalación global; equivalente al `npm test` documentado en
`firebase/rules-tests/package.json`):

```bash
cd firebase/rules-tests
npm install
npx firebase-tools emulators:exec --config ../../firebase.json \
  --project=demo-ridepro-security-tests --only firestore "npx jest --runInBand"
```

Resultado — **28/28 tests pasaron**, los 4 ataques descritos arriba
(escalada en creación, escalada post-creación, campos protegidos
adicionales, acceso cruzado entre usuarios) más los casos de control de
uso legítimo:

```
Test Suites: 1 passed, 1 total
Tests:       28 passed, 28 total
Snapshots:   0 total
Time:        6.198 s
```

La tarea A3 (y A5, misma suite) se consideran **implementadas y
verificadas**. `firestore.rules` queda habilitado para desplegarse con
`firebase deploy --only firestore:rules` cuando exista un proyecto de
Firebase real configurado (ver `SETUP_SOCIAL_LOGIN.md` — el
`applicationId`/`google-services.json` siguen siendo placeholders a
propósito).
