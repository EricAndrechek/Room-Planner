// Types for scripts/discovery.mjs (imported by the Worker, the layout and the e2e).
export declare const registry: {
  name: string;
  version: string;
  repository: { url: string; source: string };
  [key: string]: unknown;
};
export declare const MARKDOWN_PAGES: string[];
export declare function markdownPath(path: string): string | null;
export declare const PATHS: {
  mcp: string;
  serverCard: string;
  openapi: string;
  planSchema: string;
  api: string;
  apiCatalog: string;
  aiCatalog: string;
  security: string;
  agents: string;
  llms: string;
  llmsFull: string;
  privacy: string;
  terms: string;
  support: string;
};
export declare function apiCatalog(origin: string): { linkset: Record<string, unknown>[] };
export declare function securityTxt(origin: string, now?: Date): string;
export declare function linkHeader(path: string, options?: { twin?: boolean }): string;
export declare const API_POINTER_PAGES: string[];
