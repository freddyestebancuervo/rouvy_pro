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
