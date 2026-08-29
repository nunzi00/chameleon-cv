/**
 * Se importa antes que pdf.js en el worker: instala el `DOMMatrix` mínimo si no existe (en el
 * ejecutable autónomo no está `@napi-rs/canvas`). Cableado de I/O, sin cobertura propia: la
 * lógica vive en `dom-matrix.ts`.
 */
import { installDomMatrixPolyfill } from './dom-matrix.mts';

installDomMatrixPolyfill();
