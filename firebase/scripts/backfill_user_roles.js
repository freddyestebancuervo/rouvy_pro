/**
 * Backfill de la tarea A2 (ROADMAP_M0_M1.md): añade el campo `role` a
 * todos los documentos `users/{uid}` que no lo tengan todavía.
 *
 * Por qué hace falta un script y no simplemente confiar en el default
 * del cliente (`UserRole.fromRaw(null) → UserRole.user`): el cliente ya
 * degrada con seguridad si el campo falta (ver `UserModel.fromMap`), así
 * que este script NO es estrictamente bloqueante para que la app siga
 * funcionando — pero sin él, cualquier query futura del panel de admin
 * que filtre por `role` (p. ej. "todos los coaches") no encontraría a
 * los usuarios antiguos, que técnicamente SON `user` pero no lo tienen
 * escrito. Ejecutar este script hace que el dato exista de verdad en
 * Firestore, no solo como default implícito del cliente.
 *
 * Uso:
 *   1. npm install firebase-admin
 *   2. Descargar una clave de cuenta de servicio desde Firebase Console
 *      → Configuración del proyecto → Cuentas de servicio → Generar
 *      nueva clave privada.
 *   3. GOOGLE_APPLICATION_CREDENTIALS=./ruta/a/tu-clave.json node backfill_user_roles.js
 *
 * Es IDEMPOTENTE — correrlo varias veces no hace daño, solo actualiza
 * los documentos que todavía no tengan el campo.
 */

const admin = require('firebase-admin');

admin.initializeApp();

const BATCH_SIZE = 400; // por debajo del límite de 500 escrituras/batch de Firestore

async function backfillUserRoles() {
  const db = admin.firestore();
  const usersRef = db.collection('users');

  let processed = 0;
  let updated = 0;
  let lastDoc = null;

  // Paginado manual en vez de traer toda la colección de una vez —
  // necesario para no agotar memoria si la base de usuarios crece mucho
  // antes de que alguien vuelva a correr este script.
  while (true) {
    let query = usersRef.orderBy(admin.firestore.FieldPath.documentId()).limit(BATCH_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();
    let batchHasWrites = false;

    for (const doc of snapshot.docs) {
      processed++;
      const data = doc.data();
      if (data.role === undefined) {
        batch.update(doc.ref, { role: 'user' });
        batchHasWrites = true;
        updated++;
      }
    }

    if (batchHasWrites) {
      await batch.commit();
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    console.log(`Procesados: ${processed} · Actualizados hasta ahora: ${updated}`);

    if (snapshot.docs.length < BATCH_SIZE) break; // última página
  }

  console.log(`\nBackfill completo. Total procesados: ${processed}. Total actualizados: ${updated}.`);
}

backfillUserRoles()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backfill falló:', error);
    process.exit(1);
  });
