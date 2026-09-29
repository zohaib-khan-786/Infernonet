/**
 * The version shown in the sidebar brand block (guide §4).
 *
 * A literal, not an import of `package.json`. The two alternatives both cost
 * more than the value:
 *
 *   - `import { version } from '../../package.json'` needs `resolveJsonModule`
 *     and a `rootDir` that reaches outside `src`, and the project's tsconfig
 *     has neither on purpose.
 *   - `import.meta.env.VITE_APP_VERSION` needs a `vite.config.ts` `define` or a
 *     typed env entry, and neither file is in this pass's ownership.
 *
 * So it is written down, once, here. Keep it in step with `package.json`; that
 * is the whole maintenance cost, and it is one line in one file.
 */
export const APP_VERSION = '0.1.0';
