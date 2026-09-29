/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the FreshGuard read API, when it is NOT same-origin.
   *
   * Unset by default, and the default is a same-origin relative path: the dev
   * server and `vite preview` both proxy `/api` to the backend (see
   * `vite.config.ts`), so the page never needs to know where the service is.
   * Set this only for a genuinely separate API host.
   */
  readonly VITE_API_BASE_URL?: string;
  /**
   * Bearer token for administrator writes (`PUT .../thresholds`).
   *
   * Unset means this build is read-only, which is a supported configuration and
   * not a broken one: reads and the live feed need no credential. Read only by
   * `src/api/client.ts`, and only for that one method.
   */
  readonly VITE_ADMIN_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
