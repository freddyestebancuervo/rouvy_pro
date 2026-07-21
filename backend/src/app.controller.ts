import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { createDatabasePool } from './config/database.config';

/**
 * `GET /v1/health` — único endpoint de este scaffold (C2). Sirve para
 * verificar, sin ninguna lógica de negocio de por medio, que el servidor
 * arrancó Y que la conexión a Postgres funciona de verdad (no solo que
 * el proceso Node esté vivo) — es la prueba de humo mínima antes de
 * empezar la tarea C3.
 */
@Controller('health')
export class AppController {
  private readonly pool: Pool;

  constructor() {
    this.pool = createDatabasePool();
  }

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
