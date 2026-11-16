// Builds a shareable copy of the game into dist/preview/: exactly what is in
// web/ (there is no bundler; the modules run as they are), plus fragment.html,
// the page without <html>/<head>/<body>, for a host that supplies its own
// document shell. Put the folder on any static host and open index.html.
//   node tools/build-preview.mjs
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const OUT = fileURLToPath(new URL('../dist/preview/', import.meta.url));

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(WEB, OUT, { recursive: true });

const html = await readFile(`${WEB}index.html`, 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
await writeFile(`${OUT}fragment.html`, `<title>Oddments</title>
<link rel="stylesheet" href="css/style.css">
${body.trim()}
`);
console.log('preview written to dist/preview/');
