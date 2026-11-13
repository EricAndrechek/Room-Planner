/** Virtual module emitted by @vite-pwa/astro (the package's own typings are not directly resolvable under pnpm). */
declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisteredSW?: (
      swScriptUrl: string,
      registration: ServiceWorkerRegistration | undefined,
    ) => void;
    onRegisterError?: (error: unknown) => void;
  }
  /** Returns `updateSW(reloadPage?)`: activate the waiting worker (and reload when true). */
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
