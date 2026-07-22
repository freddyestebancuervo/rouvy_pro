import { ApiException } from '../exceptions/api.exception';

interface OwnedResource {
  userId: string;
}

/**
 * Patrón de ownership compartido (ver
 * docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md, decisión transversal 0.1.4):
 * un recurso ajeno responde EXACTAMENTE igual que uno inexistente — quien
 * llama decide el error concreto (vía `onNotFound`), pero nunca se llega
 * a un `403` que confirmaría a un usuario que el recurso de otro existe.
 * Se extrae acá para que Equipamiento, Entrenamientos y Actividades
 * reutilicen la misma regla en vez de reimplementarla cada uno (mismo
 * tipo de duplicación que ya se corrigió en la auditoría de Bloque C con
 * `AUTH_INVALID_CREDENTIALS`).
 */
export function assertOwned<T extends OwnedResource>(
  resource: T | null,
  userId: string,
  onNotFound: () => ApiException,
): T {
  if (!resource || resource.userId !== userId) {
    throw onNotFound();
  }
  return resource;
}
