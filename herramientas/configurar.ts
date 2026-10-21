// Deja lista la venta en Cloudflare (se puede correr las veces que haga falta):
//  1. Genera en ..\elnorge\.env la clave maestra de las actualizaciones y el secreto del webhook, si faltan.
//  2. Crea la base D1 "elnorge-licencias" (hace falta el permiso "Account · D1 · Edit" en el token).
//  3. Carga en el proyecto de Pages la base (binding DB) y las variables: CLAVE_MAESTRA, LS_WEBHOOK_SECRETO,
//     LS_TIENDA, LS_PRODUCTOS y LIMITE_DISPOSITIVOS (las que estén en el .env).
// Los cambios valen desde el próximo despliegue: después correr publicar.bat.
import { randomBytes } from 'node:crypto';
import { ARCHIVO_ENV, ErrorCloudflare, NOMBRE_BASE, PROYECTO, agregarAlEnv, clienteCloudflare, idDeLaBase, leerEnv } from './cloudflare.ts';

const SECRETOS: [variableEnv: string, variablePages: string, comentario: string][] = [
  ['ELNORGE_CLAVE_MAESTRA', 'CLAVE_MAESTRA', 'Clave maestra de las actualizaciones cifradas (no cambiarla: invalida las publicadas)'],
  ['LS_WEBHOOK_SECRETO', 'LS_WEBHOOK_SECRETO', 'Secreto de firma del webhook de Lemon Squeezy (se pega igual en Lemon Squeezy)'],
];
const VARIABLES = ['LS_TIENDA', 'LS_PRODUCTOS', 'LIMITE_DISPOSITIVOS'];

async function main() {
  let env = leerEnv();
  for (const [nombre, , comentario] of SECRETOS) {
    if (!env[nombre]) {
      const valor = nombre === 'ELNORGE_CLAVE_MAESTRA' ? randomBytes(32).toString('base64') : randomBytes(24).toString('base64url');
      agregarAlEnv(nombre, valor, comentario);
      console.log(`✓ ${nombre} generado y guardado en ${ARCHIVO_ENV}`);
    }
  }
  env = leerEnv();
  const api = clienteCloudflare(env);

  let idBase: string | null = null;
  try {
    idBase = await idDeLaBase(api);
    if (!idBase) {
      idBase = (await api<{ uuid: string }>('/d1/database', { method: 'POST', body: { name: NOMBRE_BASE } })).uuid;
      console.log(`✓ Base D1 "${NOMBRE_BASE}" creada.`);
    } else console.log(`✓ Base D1 "${NOMBRE_BASE}" ya existe.`);
  } catch (e) {
    if (!(e instanceof ErrorCloudflare && e.sinPermiso)) throw e;
    console.log(
      '✗ El token de Cloudflare no tiene permiso para D1: las licencias no van a funcionar hasta agregarlo.\n' +
        '  dash.cloudflare.com → Mi perfil → Tokens de API → editar el token → agregar "Cuenta · D1 · Editar" → guardar.\n' +
        '  Después volvé a correr: npm run configurar',
    );
  }

  const env_vars: Record<string, { type: 'secret_text' | 'plain_text'; value: string }> = {};
  for (const [nombre, pages] of SECRETOS) env_vars[pages] = { type: 'secret_text', value: env[nombre] };
  const faltan: string[] = [];
  for (const v of VARIABLES) {
    if (env[v]) env_vars[v] = { type: 'plain_text', value: env[v] };
    else if (v !== 'LIMITE_DISPOSITIVOS') faltan.push(v);
  }
  const production: Record<string, unknown> = { env_vars };
  if (idBase) production.d1_databases = { DB: { id: idBase } };
  await api(`/pages/projects/${PROYECTO}`, { method: 'PATCH', body: { deployment_configs: { production } } });
  console.log(`✓ Proyecto de Pages "${PROYECTO}": ${Object.keys(env_vars).join(', ')}${idBase ? ' y la base (DB)' : ''}.`);

  if (faltan.length) {
    console.log(
      `\nFaltan en el .env (salen de Lemon Squeezy): ${faltan.join(', ')}.\n` +
        '  LS_TIENDA=<id de la tienda>   LS_PRODUCTOS=<id>=app,<id>=pdf   (ver docs\\venta.md en el repo de la app)',
    );
  }
  console.log('\nPara que tome los cambios: publicar.bat');
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
