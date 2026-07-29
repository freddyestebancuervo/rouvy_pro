import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { isPoolConnectionTimeout } from '../database/pg-error.util';
import { ApiException } from '../exceptions/api.exception';

/**
 * Traduce cualquier excepción a el sobre de error único de la spec
 * (sección 1.2): `{ error: { code, message, requestId, details } }`. Sin
 * este filtro global, las excepciones por defecto de Nest
 * (`{ statusCode, message, error }`) no coincidirían con el contrato que
 * el cliente (y `AuthApiContract`, tarea C1) espera.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const requestId = randomUUID();

    if (exception instanceof ApiException) {
      if (exception.retryAfterSeconds != null) {
        response.set('Retry-After', String(exception.retryAfterSeconds));
      }
      response.status(exception.getStatus()).json({
        error: {
          code: exception.code,
          message: exception.message,
          requestId,
          details: exception.details,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const { code, message, details } = this.normalizeHttpExceptionBody(status, body);
      response.status(status).json({ error: { code, message, requestId, details } });
      return;
    }

    // Fase 4.2 Parte 2 — el pool de Postgres agotado (`connectionTimeoutMillis`
    // cumplido esperando un slot libre) NO es una falla de programación: es
    // saturación esperable bajo carga. Se traduce a `503` con un código de
    // negocio estable, antes del `500` genérico de abajo — a propósito
    // nunca captura errores de integridad/migración/programación (ver
    // `isPoolConnectionTimeout`, exige mensaje exacto + ausencia de `.code`).
    if (isPoolConnectionTimeout(exception)) {
      this.logger.warn('Pool de PostgreSQL saturado: timeout al adquirir conexión.');
      response.set('Retry-After', '2');
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        error: {
          code: 'DATABASE_TEMPORARILY_UNAVAILABLE',
          message: 'El servicio está temporalmente saturado. Probá de nuevo en unos segundos.',
          requestId,
          details: null,
        },
      });
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Ocurrió un error inesperado.',
        requestId,
        details: null,
      },
    });
  }

  /**
   * `ValidationPipe` (class-validator) y las excepciones nativas de Nest
   * (`UnauthorizedException`, `ThrottlerException`, ...) no traen `code` —
   * lo mapeamos por status a los códigos ya definidos en la spec.
   */
  private normalizeHttpExceptionBody(
    status: number,
    body: string | object,
  ): { code: string; message: string; details: unknown } {
    const asObject = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const rawMessage = asObject.message ?? body;
    const isValidationErrors = Array.isArray(rawMessage);

    const message = isValidationErrors
      ? 'Los datos enviados no son válidos.'
      : typeof rawMessage === 'string'
        ? rawMessage
        : 'Ocurrió un error inesperado.';

    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      return { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes, intentá de nuevo más tarde.', details: null };
    }
    if (status === HttpStatus.BAD_REQUEST) {
      return { code: 'VALIDATION_ERROR', message, details: isValidationErrors ? rawMessage : null };
    }
    if (status === HttpStatus.UNAUTHORIZED) {
      return { code: 'UNAUTHORIZED', message, details: null };
    }
    if (status === HttpStatus.NOT_FOUND) {
      return { code: 'NOT_FOUND', message, details: null };
    }
    return { code: 'ERROR', message, details: null };
  }
}
