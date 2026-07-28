/**
 * Token de inyección para el servicio `Auth` de `firebase-admin` (ver
 * `firebase-admin.module.ts`, que lo provee, y
 * `firebase-token-verifier.service.ts`, que lo consume vía `@Inject`).
 *
 * Vive en su propio archivo a propósito: declararlo dentro de
 * `firebase-admin.module.ts` creaba un import circular real entre ese
 * módulo y el servicio (cada uno importaba del otro), y bajo ese ciclo el
 * módulo que se termina de evaluar SEGUNDO recibe el valor todavía
 * `undefined` del primero — `@Inject(undefined)` no matchea ningún
 * provider real, y Nest lo reporta como "no se puede resolver la
 * dependencia" (hallazgo real, reproducido de forma aislada durante la
 * Fase 3, antes de este archivo existir).
 */
export const FIREBASE_AUTH = 'FIREBASE_AUTH';
