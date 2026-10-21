// Arma dist/ para Cloudflare Pages: la landing, _headers y, si hay, la última actualización cifrada del contenido
// (..\elnorge\actualizacion\, que genera `npm run actualizacion` en el repo de la app). Lo usan publicar.bat y `npm run local`.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RAIZ } from './cloudflare.ts';

const dist = join(RAIZ, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const x of ['index.html', '404.html', '_headers', 'assets']) cpSync(join(RAIZ, x), join(dist, x), { recursive: true });

const origen = resolve(RAIZ, '..', 'elnorge', 'actualizacion');
const manifest = join(origen, 'content-manifest.json');
if (existsSync(manifest)) {
  const m = JSON.parse(readFileSync(manifest, 'utf8'));
  if (m.cifrado !== 'aes-256-gcm') throw new Error(`${manifest} no está cifrado: no se publica.`);
  // Solo se publica la versión que dice content/version.txt (la que se commitea), no una de prueba.
  const vigente = readFileSync(resolve(RAIZ, '..', 'elnorge', 'content', 'version.txt'), 'utf8').trim();
  if (m.version !== vigente) throw new Error(`La actualización cifrada es ${m.version} pero content/version.txt dice ${vigente}: corré publicar-actualizacion.bat.`);
  const destino = join(dist, 'actualizaciones');
  mkdirSync(destino);
  const archivos = readdirSync(origen).filter((f) => f === 'content-manifest.json' || f.endsWith('.enc'));
  for (const f of archivos) cpSync(join(origen, f), join(destino, f));
  console.log(`✓ Actualización ${m.version}: ${archivos.length - 1} archivos cifrados.`);
} else console.log('  (sin actualización de contenido para publicar)');
console.log('✓ dist/ listo.');
