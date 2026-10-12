import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
await mkdir('dist-pages', { recursive: true });
await cp('public', 'dist-pages', { recursive: true });
await build({entryPoints:['src/pages.ts'], bundle:true, format:'esm', platform:'browser', target:'es2022', outfile:'dist-pages/_worker.js', minify:true});
await writeFile('dist-pages/_routes.json', JSON.stringify({version:1,include:['/*'],exclude:[]}));
