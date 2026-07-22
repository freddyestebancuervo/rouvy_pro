import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';

export type RotationOutcome =
  | { status: 'not_found' }
  | { status: 'expired' }
  /** Reuso detectado: ya se revocaron todos los tokens activos del usuario. */
  | { status: 'reused'; userId: string }
  | { status: 'rotated'; userId: string };

/**
 * Módulo propio (no vive dentro de `modules/auth/`) porque tanto
 * `AuthModule` (`register`/`login`/`refresh`) como `UsersModule`
 * (`DELETE /users/me` revoca todos los tokens del usuario al borrar la
 * cuenta) necesitan este repositorio — dejarlo dentro de `AuthModule`
 * hubiera obligado a un import circular (`AuthModule` ya importa
 * `UsersModule` para `UsersRepository`).
 */
@Injectable()
export class RefreshTokensRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async create(params: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    deviceInfo?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, device_info)
       VALUES ($1, $2, $3, $4)`,
      [params.userId, params.tokenHash, params.expiresAt, params.deviceInfo ?? null],
    );
  }

  /** `DELETE /users/me` (spec 1.2): "revoca todos los refresh tokens del
   * usuario de inmediato". */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.pool.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }

  /**
   * Implementa la rotación obligatoria + detección de reuso de la spec
   * sección 5.2, en una única transacción con `SELECT ... FOR UPDATE`
   * (bloquea la fila del token entrante) para que dos requests concurrentes
   * con el MISMO refresh token nunca puedan rotarlo dos veces en paralelo
   * — la segunda espera el lock y, al obtenerlo, ya encuentra la fila
   * marcada `revoked_at`, cayendo en la rama de reuso como corresponde.
   *
   * El token nuevo (`newTokenHash`/`newExpiresAt`) se genera SIEMPRE antes
   * de llamar a este método (es una operación local, sin DB — ver
   * `TokenService.issueRefreshToken`); si la rotación no resulta válida,
   * simplemente se descarta sin haber tocado la base.
   */
  async rotate(params: {
    oldTokenHash: string;
    newTokenHash: string;
    newExpiresAt: Date;
  }): Promise<RotationOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const lockResult = await client.query<{
        user_id: string;
        revoked_at: Date | null;
        expires_at: Date;
      }>(
        'SELECT user_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [params.oldTokenHash],
      );
      const row = lockResult.rows[0];

      if (!row) {
        await client.query('ROLLBACK');
        return { status: 'not_found' };
      }

      if (row.revoked_at !== null) {
        // Reuso: alguien presentó un refresh token que ya había sido
        // canjeado antes — señal de robo/fuga (spec 5.2, punto 4).
        // Revoca TODOS los tokens activos del usuario, forzando
        // reautenticación completa.
        await client.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
          [row.user_id],
        );
        await client.query('COMMIT');
        return { status: 'reused', userId: row.user_id };
      }

      if (row.expires_at.getTime() < Date.now()) {
        await client.query('COMMIT');
        return { status: 'expired' };
      }

      await client.query(
        'UPDATE refresh_tokens SET revoked_at = now(), replaced_by_token_hash = $2 WHERE token_hash = $1',
        [params.oldTokenHash, params.newTokenHash],
      );
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [row.user_id, params.newTokenHash, params.newExpiresAt],
      );
      await client.query('COMMIT');
      return { status: 'rotated', userId: row.user_id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
