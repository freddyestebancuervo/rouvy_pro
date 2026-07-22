import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from './database/database.module';

/**
 * `GET /v1/health` — verifica, sin ninguna lógica de negocio de por medio,
 * que el servidor arrancó Y que la conexión a Postgres funciona de verdad
 * (no solo que el proceso Node esté vivo).
 */
@Controller('health')
export class AppController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async check(): Promise<{ status: string; database: string }> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', database: 'connected' };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unreachable',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
