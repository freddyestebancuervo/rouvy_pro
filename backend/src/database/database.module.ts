import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { createDatabasePool } from '../config/database.config';

export const PG_POOL = Symbol('PG_POOL');

/**
 * Cierra el pool cuando Nest apaga la app (`app.close()` en tests e2e,
 * SIGTERM en producción). Sin esto, `pg.Pool` deja el socket TCP abierto
 * indefinidamente — es la causa exacta del "Jest did not exit" (handle
 * abierto) que arrastraba el test e2e original, donde `AppController`
 * creaba su propio `Pool` fuera del ciclo de vida de Nest.
 */
@Injectable()
class DatabasePoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

/** Módulo global: un único `pg.Pool` compartido por toda la app en vez de
 * que cada consumidor abra el suyo. */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => createDatabasePool(),
    },
    DatabasePoolShutdown,
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
