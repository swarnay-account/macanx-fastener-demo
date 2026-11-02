// Turns the `--mode artifact` build into the shape a Claude artifact expects:
// the page body as a fragment (Claude adds the <html>/<head>/<body> wrapper),
// plus the list of supporting files to publish beside it.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist');
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const pick = (re) => [...html.matchAll(re)].map(m => m[0]);

const title = '<title>Fastener ERP Demo</title>';
const fonts = pick(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g);
const css = pick(/<link[^>]+rel="stylesheet"[^>]+href="\.\/assets\/[^"]+"[^>]*>/g);
const js = pick(/<script[^>]+src="\.\/assets\/[^"]+"[^>]*><\/script>/g);

const page = [
  title,
  '<meta name="robots" content="noindex, nofollow, noarchive">',
  ...fonts, ...css,
  '<div id="root"></div>',
  ...js,
  '',
].join('\n');
writeFileSync(path.join(dist, 'artifact.html'), page);

const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else {
      const rel = path.relative(dist, full).split(path.sep).join('/');
      if (rel.startsWith('assets/') || (rel.startsWith('img/') && !rel.endsWith('.png') && !rel.endsWith('.ico'))) files[rel] = full.split(path.sep).join('/');
    }
  }
};
walk(dist);
writeFileSync(path.join(dist, 'artifact-files.json'), JSON.stringify(files, null, 2));
console.log(`artifact.html written, ${Object.keys(files).length} supporting files`);
