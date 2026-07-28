import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { createDatabasePool } from '../src/config/database.config';
import { FirebaseEmailConflictError } from '../src/modules/users/errors/firebase-email-conflict.error';
import { UsersRepository } from '../src/modules/users/users.repository';

/**
 * Contra Postgres real (misma filosofía que el resto de la suite e2e:
 * `test/users.e2e-spec.ts`, `test/equipment.e2e-spec.ts`, etc.), pero SIN
 * levantar la app Nest completa vía `createTestApp()` — a diferencia de
 * esos specs, `UsersRepository.upsertByFirebaseUid`/`findByFirebaseUid`
 * (Fase 2 del puente Firebase → NestJS → PostgreSQL) todavía no están
 * conectados a ningún endpoint HTTP (eso es la Fase 3), así que no hay
 * nada que probar vía `supertest` todavía. `UsersRepository` solo necesita
 * un `pg.Pool` real — se instancia directo, sin el resto del contenedor
 * de DI.
 */
describe('UsersRepository — firebase_uid (Fase 2, e2e contra Postgres real)', () => {
  let pool: Pool;
  let repo: UsersRepository;

  beforeAll(() => {
    pool = createDatabasePool();
    repo = new UsersRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  function freshEmail(label: string): string {
    return `e2e-firebase-${label}-${randomUUID()}@ridepro.com`;
  }

  async function insertLegacyUser(email: string): Promise<string> {
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, display_name, auth_provider)
       VALUES ($1, 'hash-no-relevante', 'Usuario Legacy', 'password')
       RETURNING id`,
      [email],
    );
    const userId = result.rows[0].id as string;
    await pool.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, (SELECT id FROM roles WHERE name = 'user'))`,
      [userId],
    );
    return userId;
  }

  describe('findByFirebaseUid', () => {
    it('encuentra al usuario correcto por firebase_uid', async () => {
      const firebaseUid = `uid-${randomUUID()}`;
      const email = freshEmail('find-ok');
      const { user: created } = await repo.upsertByFirebaseUid({
        firebaseUid,
        email,
        emailVerified: true,
        displayName: 'Rider Firebase',
        provider: 'google',
      });

      const found = await repo.findByFirebaseUid(firebaseUid);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.email).toBe(email);
    });

    it('devuelve null cuando no existe ningún usuario con ese firebase_uid', async () => {
      const found = await repo.findByFirebaseUid(`uid-inexistente-${randomUUID()}`);
      expect(found).toBeNull();
    });

    it('un usuario legacy con firebase_uid NULL sigue siendo encontrable por email/id (sin romper nada)', async () => {
      const email = freshEmail('legacy');
      const userId = await insertLegacyUser(email);

      const byEmail = await repo.findByEmail(email);
      const byId = await repo.findById(userId);

      expect(byEmail).not.toBeNull();
      expect(byEmail?.firebaseUid).toBeNull();
      expect(byId).not.toBeNull();
      expect(byId?.firebaseUid).toBeNull();
    });
  });

  describe('upsertByFirebaseUid — creación', () => {
    it('crea un usuario nuevo cuando no existe ni por firebase_uid ni por email', async () => {
      const firebaseUid = `uid-${randomUUID()}`;
      const email = freshEmail('nuevo');

      const { user, isNew } = await repo.upsertByFirebaseUid({
        firebaseUid,
        email,
        emailVerified: true,
        displayName: 'Usuario Nuevo',
        provider: 'password',
      });

      expect(isNew).toBe(true);
      expect(user.email).toBe(email);
      expect(user.firebaseUid).toBe(firebaseUid);
      expect(user.displayName).toBe('Usuario Nuevo');
      expect(user.passwordHash).toBeNull();

      const roles = await repo.findRoleNames(user.id);
      expect(roles).toEqual(['user']);
    });
  });

  describe('upsertByFirebaseUid — actualización de usuario existente', () => {
    it('actualiza email/displayName/emailVerified/provider en la siguiente llamada, sin duplicar la fila', async () => {
      const firebaseUid = `uid-${randomUUID()}`;
      const originalEmail = freshEmail('update-original');

      const { user: first, isNew: firstIsNew } = await repo.upsertByFirebaseUid({
        firebaseUid,
        email: originalEmail,
        emailVerified: false,
        displayName: 'Nombre Viejo',
        provider: 'password',
      });

      const newEmail = freshEmail('update-nuevo');
      const { user: second, isNew: secondIsNew } = await repo.upsertByFirebaseUid({
        firebaseUid,
        email: newEmail,
        emailVerified: true,
        displayName: 'Nombre Nuevo',
        provider: 'google',
      });

      expect(firstIsNew).toBe(true);
      expect(secondIsNew).toBe(false);
      expect(second.id).toBe(first.id); // misma fila, no un duplicado
      expect(second.email).toBe(newEmail);
      expect(second.displayName).toBe('Nombre Nuevo');
      expect(second.emailVerified).toBe(true);
      expect(second.authProvider).toBe('google');
    });

    it('NUNCA toca password_hash de un usuario existente', async () => {
      // Usuario legacy con password real, luego "vinculado" a Firebase
      // manualmente vía SQL directo (simulando un estado ya vinculado) —
      // el upsert de acá NO debe tocar su password_hash.
      const firebaseUid = `uid-${randomUUID()}`;
      const email = freshEmail('password-intacto');
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, display_name, auth_provider, firebase_uid)
         VALUES ($1, 'hash-original-no-debe-cambiar', 'Con Password', 'password', $2)
         RETURNING id`,
        [email, firebaseUid],
      );
      const userId = result.rows[0].id as string;

      await repo.upsertByFirebaseUid({
        firebaseUid,
        email,
        emailVerified: true,
        displayName: 'Con Password Actualizado',
        provider: 'password',
      });

      const raw = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
      expect(raw.rows[0].password_hash).toBe('hash-original-no-debe-cambiar');
    });

    it('NUNCA cambia los roles de un usuario existente (no vienen de datos externos)', async () => {
      const firebaseUid = `uid-${randomUUID()}`;
      const email = freshEmail('roles-intactos');
      const { user } = await repo.upsertByFirebaseUid({
        firebaseUid,
        email,
        emailVerified: true,
        displayName: 'Rider',
        provider: 'password',
      });
      // Simula una elevación manual/administrativa previa — el upsert NO
      // debe revertirla ni tocarla de ninguna forma.
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, (SELECT id FROM roles WHERE name = 'coach'))`,
        [user.id],
      );

      await repo.upsertByFirebaseUid({
        firebaseUid,
        email,
        emailVerified: true,
        displayName: 'Rider',
        provider: 'password',
      });

      const roles = await repo.findRoleNames(user.id);
      expect(roles.sort()).toEqual(['coach', 'user']);
    });
  });

  describe('upsertByFirebaseUid — política de colisión de email', () => {
    it('produce un conflicto explícito si el email ya existe sin firebase_uid vinculado (nunca fusiona)', async () => {
      const email = freshEmail('colision');
      const legacyUserId = await insertLegacyUser(email);

      await expect(
        repo.upsertByFirebaseUid({
          firebaseUid: `uid-${randomUUID()}`,
          email,
          emailVerified: true,
          displayName: 'Intento De Fusion',
          provider: 'google',
        }),
      ).rejects.toBeInstanceOf(FirebaseEmailConflictError);

      // La fila legacy original queda exactamente igual — sin fusión.
      const legacy = await repo.findById(legacyUserId);
      expect(legacy?.firebaseUid).toBeNull();
      expect(legacy?.displayName).toBe('Usuario Legacy');
    });

    it('produce conflicto si el email coincide con una fila vinculada a OTRO firebase_uid distinto', async () => {
      const email = freshEmail('colision-otro-uid');
      await repo.upsertByFirebaseUid({
        firebaseUid: `uid-original-${randomUUID()}`,
        email,
        emailVerified: true,
        displayName: 'Dueño Original',
        provider: 'apple',
      });

      await expect(
        repo.upsertByFirebaseUid({
          firebaseUid: `uid-distinto-${randomUUID()}`,
          email,
          emailVerified: true,
          displayName: 'Otro Intento',
          provider: 'google',
        }),
      ).rejects.toBeInstanceOf(FirebaseEmailConflictError);
    });
  });
});
