// Types for scripts/discovery.mjs (imported by the Worker, the layout and the e2e).
export declare const registry: {
  name: string;
  version: string;
  title: string;
  description: string;
  websiteUrl: string;
  repository: { url: string; source: string };
  icons: { src: string; mimeType: string; sizes: string[] }[];
  [key: string]: unknown;
};
export declare const MARKDOWN_PAGES: string[];
export declare function markdownPath(path: string): string | null;
export declare const PATHS: {
  mcp: string;
  serverCard: string;
  serverCardWellKnown: string;
  openapi: string;
  planSchema: string;
  api: string;
  apiCatalog: string;
  aiCatalog: string;
  ard: string;
  agentSkills: string;
  skill: string;
  search: string;
  searchIndex: string;
  poppy: string;
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
export declare const MODERN_PROTOCOL_VERSION: string;
export interface ServerCard {
  $schema: string;
  name: string;
  version: string;
  title: string;
  description: string;
  websiteUrl: string;
  repository: { url: string; source: string };
  icons: { src: string; mimeType: string; sizes: string[] }[];
  remotes: { type: 'streamable-http'; url: string; supportedProtocolVersions: string[] }[];
}
export declare function serverCard(origin: string, sdkVersions: readonly string[]): ServerCard;
export declare const SKILL: { name: string; description: string };
export declare function agentSkillsIndex(skillDigest: string): {
  $schema: string;
  skills: { name: string; type: string; description: string; url: string; digest: string }[];
};
export interface AiCatalogEntry {
  identifier: string;
  displayName: string;
  type: string;
  url: string;
  description: string;
  tags: string[];
  capabilities?: string[];
  digest?: string;
  representativeQueries: string[];
}
export declare function aiCatalog(
  origin: string,
  options: { skillDigest: string },
): {
  specVersion: string;
  host: { displayName: string; identifier: string; documentationUrl: string; logoUrl: string };
  entries: AiCatalogEntry[];
};
export declare function poppy(origin: string): {
  protocol_version: string;
  organization: { name: string; domain: string; logo_uri: string };
  web: Record<string, never>;
  apis: { type: string; url: string; description: string }[];
};
export declare function searchPointers(origin: string): {
  instructions: string;
  endpoint: string;
  method: string;
  documentation: string;
};
