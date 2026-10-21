// API y landing en http://localhost:8788 con una base D1 local (.wrangler/state), para probar sin tocar Cloudflare.
// Usa la clave maestra del .env, así la app en modo desarrollo puede bajar y descifrar la actualización.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ, leerEnv } from './cloudflare.ts';

await import('./armar.ts');
const env = leerEnv();
const vars = {
  CLAVE_MAESTRA: env.ELNORGE_CLAVE_MAESTRA,
  LS_WEBHOOK_SECRETO: env.LS_WEBHOOK_SECRETO,
  LS_TIENDA: env.LS_TIENDA,
  LS_PRODUCTOS: env.LS_PRODUCTOS,
  LIMITE_DISPOSITIVOS: env.LIMITE_DISPOSITIVOS,
};
writeFileSync(
  join(RAIZ, '.dev.vars'),
  Object.entries(vars)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}\n`)
    .join(''),
);
const p = spawn('npx', ['--yes', 'wrangler@4', 'pages', 'dev', 'dist', '--d1', 'DB', '--port', '8788'], { cwd: RAIZ, stdio: 'inherit', shell: true });
p.on('exit', (c) => process.exit(c ?? 0));
