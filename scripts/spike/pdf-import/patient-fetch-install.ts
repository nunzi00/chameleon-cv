/**
 * Instala el transporte paciente antes de que se cargue `src/llm` (T-8.4, P2): el cliente HTTP del producto captura
 * `fetch` al importarse, así que este módulo debe ser el primer import del punto de entrada del spike.
 */
import { installPatientFetch } from './patient-fetch';

installPatientFetch();
