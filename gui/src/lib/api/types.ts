/**
 * El contrato de la API, importado del servidor solo como tipos (docs/gui-mvp.md §4.1): si cambia una ruta, el
 * compilador de la GUI lo detecta. Vite no incluye código del servidor: las importaciones de tipos se borran.
 */
export type {
  BuildResponse,
  DatasetIssue,
  ErrorResponse,
  ProfileResponse,
  ShutdownResponse,
  SourceResponse,
  SourceWriteResponse,
  SourcesResponse,
  StatusResponse,
  ValidateResponse,
} from '../../../../src/serve/contract';
