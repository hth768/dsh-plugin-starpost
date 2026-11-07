import { build } from 'esbuild';
import { copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).starpostCoreVersion;
await build({
  absWorkingDir: root, outfile: 'lib/core.mjs', bundle: true, platform: 'node',
  target: 'node22', format: 'esm',
  stdin: { resolveDir: root, contents: `export { StarpostWorld, STARPOST_TOOL_DECLS } from './core/src/world.ts';
    export { STARPOST_DEFAULTS } from './core/src/config.ts'; export const relayVersion = ${JSON.stringify(version)};` }
});
copyFileSync(new URL('./core/src/ENV_PROMPT.md', import.meta.url), new URL('./lib/ENV_PROMPT.md', import.meta.url));
