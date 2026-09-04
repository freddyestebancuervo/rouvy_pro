import { Controller, Get, HttpStatus, Inject, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from './database/database.module';
import { ApiException } from './common/exceptions/api.exception';

/**
 * KORIXA-MVP-SAFETY-01 — separa liveness de readiness y deja de exponer
 * el error interno de Postgres al cliente (hallazgo: el endpoint único
 * anterior devolvía `error.message` crudo en el 503).
 *
 * `GET /v1/live` — liveness: el proceso Node está arriba y puede
 * responder HTTP. Nunca consulta Postgres — un incidente de base de
 * datos no debe hacer que un orquestador reinicie un proceso que en
 * realidad está sano (eso es tarea de `/v1/ready`).
 *
 * `GET /v1/ready` — readiness: además de estar vivo, confirma que la
 * conexión a Postgres funciona de verdad (`SELECT 1`), no solo que el
 * proceso esté vivo.
 *
 * `GET /v1/health` — alias de compatibilidad hacia atrás, con el mismo
 * comportamiento que `/v1/ready`. Se mantiene porque tiene consumidores
 * reales y contractuales ya verificados: `.github/workflows/ci.yml`,
 * `.github/workflows/backend-deploy-development.yml`,
 * `.github/workflows/_backend-deploy-cloud-run-production.yml`, el
 * `HEALTHCHECK` de `Dockerfile` (heredado por `docker-compose.yml`), y
 * `backend/test/app.e2e-spec.ts`. Nuevo código/infraestructura debe
 * preferir `/v1/live` o `/v1/ready` explícitamente; este alias no se
 * retira mientras esos consumidores sigan existiendo.
 */
@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: string; database: string }> {
    return this.checkDatabaseReadiness();
  }

  @Get('health')
  async health(): Promise<{ status: string; database: string }> {
    return this.checkDatabaseReadiness();
  }

  private async checkDatabaseReadiness(): Promise<{ status: string; database: string }> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', database: 'connected' };
    } catch (error) {
      // El error real (mensaje/stack de `pg`, que puede incluir host,
      // nombre de base o detalle de TLS) queda SOLO en el log del
      // servidor — nunca en la respuesta al cliente. `ApiException` fija
      // `code`/`message` a valores constantes controlados por este
      // archivo, nunca derivados de `error`, así que
      // `ApiExceptionFilter` no tiene ningún dato interno que reenviar.
      this.logger.error(
        'Readiness check falló: la conexión a Postgres no respondió.',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'DATABASE_UNAVAILABLE', 'El servicio no está disponible en este momento.', {
        status: 'error',
        database: 'unreachable',
      });
    }
  }
}
