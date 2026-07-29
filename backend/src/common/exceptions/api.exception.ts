import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Excepción base para el sobre de error estándar de la spec (sección 1.2):
 * `{ error: { code, message, requestId, details } }`. `ApiExceptionFilter`
 * la traduce a esa forma; cualquier endpoint que necesite un `code`
 * específico del contrato (`AUTH_INVALID_CREDENTIALS`,
 * `EMAIL_ALREADY_EXISTS`, etc.) lanza esta clase en vez de las excepciones
 * genéricas de Nest.
 */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: string,
    message: string,
    public readonly details: unknown = null,
    /** Fase 4.2 Parte 2 — opcional, sin afectar a ningún llamador existente.
     * `ApiExceptionFilter` lo traduce al header `Retry-After` cuando está
     * presente (saturación de pool, rate limit por identidad). */
    public readonly retryAfterSeconds?: number,
  ) {
    super({ code, message, details }, status);
  }
}
