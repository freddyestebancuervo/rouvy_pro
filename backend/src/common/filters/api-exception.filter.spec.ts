import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ApiException } from '../exceptions/api.exception';
import { ApiExceptionFilter } from './api-exception.filter';

/**
 * Unit tests de `ApiExceptionFilter` — Fase 4.2 Parte 2 agrega la
 * traducción de saturación de pool (`isPoolConnectionTimeout` → 503) y el
 * header `Retry-After` (saturación de pool y rate limit por identidad,
 * `ApiException.retryAfterSeconds`). El resto del filtro (mapeo de
 * `HttpException` nativas, 500 genérico) no es nuevo de esta fase, pero
 * queda cubierto acá por ser el mismo archivo/clase.
 */
describe('ApiExceptionFilter', () => {
  function buildHost() {
    const response = {
      set: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({}),
      }),
    } as unknown as ArgumentsHost;
    return { host, response };
  }

  it('timeout de adquisición del pool (pg-pool, sin .code) → 503 DATABASE_TEMPORARILY_UNAVAILABLE con Retry-After', () => {
    const filter = new ApiExceptionFilter();
    const { host, response } = buildHost();
    const poolTimeoutError = new Error('timeout exceeded when trying to connect');

    filter.catch(poolTimeoutError, host);

    expect(response.set).toHaveBeenCalledWith('Retry-After', '2');
    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.json).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 'DATABASE_TEMPORARILY_UNAVAILABLE',
        details: null,
      }),
    });
    // El mensaje al cliente es genérico y amigable — nunca el texto interno de pg-pool.
    const body = response.json.mock.calls[0][0];
    expect(body.error.message).not.toContain('pg-pool');
    expect(body.error.message).not.toContain('trying to connect');
  });

  it('un error de Postgres real (mismo tipo de mensaje pero con .code) NO se traduce a 503 — cae al 500 genérico', () => {
    const filter = new ApiExceptionFilter();
    const { host, response } = buildHost();
    const realPgError = Object.assign(new Error('timeout exceeded when trying to connect'), {
      code: '57014',
    });

    filter.catch(realPgError, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.json).toHaveBeenCalledWith({
      error: expect.objectContaining({ code: 'INTERNAL_SERVER_ERROR' }),
    });
  });

  it('un error de programación cualquiera (sin relación con el pool) sigue devolviendo 500 genérico, sin stack trace crudo', () => {
    const filter = new ApiExceptionFilter();
    const { host, response } = buildHost();

    filter.catch(new TypeError("Cannot read properties of undefined (reading 'foo')"), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const body = response.json.mock.calls[0][0];
    expect(body.error.message).toBe('Ocurrió un error inesperado.');
    expect(body.error.message).not.toContain('Cannot read properties');
  });

  it('ApiException con retryAfterSeconds (rate limit por identidad, Capas 2/3) agrega el header Retry-After con el valor exacto', () => {
    const filter = new ApiExceptionFilter();
    const { host, response } = buildHost();
    const rateLimited = new ApiException(
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMITED',
      'Demasiadas solicitudes, intentá de nuevo más tarde.',
      null,
      37,
    );

    filter.catch(rateLimited, host);

    expect(response.set).toHaveBeenCalledWith('Retry-After', '37');
    expect(response.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('ApiException sin retryAfterSeconds no agrega el header Retry-After', () => {
    const filter = new ApiExceptionFilter();
    const { host, response } = buildHost();
    const conflict = new ApiException(HttpStatus.CONFLICT, 'FIREBASE_EMAIL_CONFLICT', 'Ya existe.');

    filter.catch(conflict, host);

    expect(response.set).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });

  it('HttpException nativa (p. ej. ThrottlerException de Capa 1) se mapea a RATE_LIMITED por status, sin exponer su mensaje interno', () => {
    const filter = new ApiExceptionFilter();
    const { host, response } = buildHost();

    filter.catch(new HttpException('ThrottlerException: Too Many Requests', HttpStatus.TOO_MANY_REQUESTS), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    const body = response.json.mock.calls[0][0];
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).not.toContain('ThrottlerException');
  });
});
