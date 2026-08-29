/**
 * El contrato de la API, importado del servidor solo como tipos (docs/gui-mvp.md §4.1): si cambia una ruta, el
 * compilador de la GUI lo detecta. Vite no incluye código del servidor: las importaciones de tipos se borran.
 */
export type {
  AnalyzeRequest,
  AnalyzeResponse,
  BuildResponse,
  DatasetIssue,
  ErrorResponse,
  ExtractResponse,
  GenerateReportPayload,
  GenerateRequest,
  GenerateResponse,
  OutputEntry,
  OutputListResponse,
  ProfileResponse,
  ShutdownResponse,
  SourceResponse,
  SourceWriteResponse,
  SourcesResponse,
  StatusResponse,
  ThemeCreateRequest,
  ThemeCreateResponse,
  ThemesResponse,
  ValidateResponse,
} from '../../../../src/serve/contract';
