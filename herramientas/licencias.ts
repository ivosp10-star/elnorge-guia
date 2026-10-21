// Administración de licencias (la base D1 de quién pagó).
//
//   npm run licencias -- crear --producto app --email persona@ejemplo.com --nota "tester"
//   npm run licencias -- ver <clave | email | últimos 4 de la clave>
//   npm run licencias -- revocar <clave | email> [--motivo "texto"]
//   npm run licencias -- reactivar <clave | email>
//   npm run licencias -- liberar <clave | email>      (borra sus teléfonos: para quien perdió el suyo)
//   npm run licencias -- listar [n]
//   npm run licencias -- eventos [n]
//
// Con --local trabaja sobre la base de `npm run local` (wrangler pages dev) en vez de la de Cloudflare.
import { randomBytes } from 'node:crypto';
import { abrir, hashClave, insertarLicencia, normalizarClave, pistaClave, type BaseDeDatos, type FilaLicencia } from '../lib/licencias.ts';
import { ErrorCloudflare, baseLocal, baseRemota, clienteCloudflare, idDeLaBase } from './cloudflare.ts';

const opciones: Record<string, string> = {};
const posicionales: string[] = [];
let local = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--local') local = true;
  else if (a.startsWith('--')) opciones[a.slice(2)] = process.argv[++i] ?? '';
  else posicionales.push(a);
}
const opcion = (n: string): string | undefined => opciones[n];
const [comando, objetivo] = posicionales;

async function conectar(): Promise<BaseDeDatos> {
  if (local) return (await abrir({ DB: baseLocal() }))!;
  const api = clienteCloudflare();
  let id: string | null;
  try {
    id = await idDeLaBase(api);
  } catch (e) {
    if (e instanceof ErrorCloudflare && e.sinPermiso) {
      throw new Error('El token de Cloudflare no tiene permiso para D1. Agregale "Account · D1 · Edit" (ver README).');
    }
    throw e;
  }
  if (!id) throw new Error('Todavía no existe la base: corré "npm run configurar".');
  return (await abrir({ DB: baseRemota(api, id) }))!;
}

/** Clave nueva: ELN- y 20 caracteres de base32 de Crockford (100 bits, sin I, L, O ni U). */
function claveNueva(): string {
  const abc = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const b = randomBytes(20);
  const c = [...b].map((x) => abc[x & 31]).join('');
  return `ELN-${c.slice(0, 5)}-${c.slice(5, 10)}-${c.slice(10, 15)}-${c.slice(15, 20)}`;
}

async function buscar(db: BaseDeDatos, q: string): Promise<FilaLicencia[]> {
  if (q.includes('@')) return (await db.prepare('SELECT * FROM licencias WHERE lower(email) = lower(?) ORDER BY creada_el').bind(q).all<FilaLicencia>()).results;
  if (q.length <= 6) return (await db.prepare('SELECT * FROM licencias WHERE pista = ? ORDER BY creada_el').bind(q.toUpperCase()).all<FilaLicencia>()).results;
  const clave = normalizarClave(q);
  if (!clave) return [];
  const f = await db.prepare('SELECT * FROM licencias WHERE clave_hash = ?').bind(await hashClave(clave)).first<FilaLicencia>();
  return f ? [f] : [];
}

const fila = (f: FilaLicencia, n?: number) =>
  `…${f.pista}  ${f.producto.padEnd(5)} ${f.estado.padEnd(8)} ${(f.email ?? '-').padEnd(30)} ${f.proveedor.padEnd(12)} ${f.creada_el.slice(0, 10)}` +
  (n === undefined ? '' : `  tel: ${n}`) +
  (f.motivo ? `  (${f.motivo})` : '') +
  (f.nota ? `  "${f.nota}"` : '');

async function unaSola(db: BaseDeDatos, q: string | undefined): Promise<FilaLicencia[]> {
  if (!q) throw new Error('Falta la clave o el email.');
  const r = await buscar(db, q);
  if (!r.length) throw new Error(`No hay licencias para "${q}".`);
  return r;
}

async function main() {
  if (!comando || comando === 'ayuda') {
    console.log('Comandos: crear, ver, revocar, reactivar, liberar, listar, eventos (con --local para la base de prueba).');
    return;
  }
  const db = await conectar();
  const ahora = new Date().toISOString();

  if (comando === 'crear') {
    const producto = opcion('producto') ?? 'app';
    if (!['app', 'combo', 'pdf'].includes(producto)) throw new Error('--producto tiene que ser app, combo o pdf.');
    const limite = opcion('limite') ? Number(opcion('limite')) : null;
    const clave = claveNueva();
    await insertarLicencia(db, {
      clave_hash: await hashClave(clave),
      pista: pistaClave(clave),
      proveedor: 'manual',
      producto,
      email: opcion('email') ?? null,
      pedido: null,
      estado: 'activa',
      motivo: null,
      limite,
      creada_el: ahora,
      actualizada_el: ahora,
      nota: opcion('nota') ?? null,
    });
    console.log(`Licencia creada (${producto}). Esta clave no se guarda en ningún lado: copiala ahora.\n\n  ${clave}\n`);
  } else if (comando === 'ver') {
    for (const f of await unaSola(db, objetivo)) {
      const d = (await db.prepare('SELECT * FROM dispositivos WHERE clave_hash = ? ORDER BY activado_el').bind(f.clave_hash).all<Record<string, string>>()).results;
      console.log(fila(f, d.length) + (f.pedido ? `  pedido ${f.pedido}` : ''));
      for (const x of d) console.log(`    · ${x.nombre ?? 'sin nombre'}  activado ${x.activado_el.slice(0, 10)}, visto ${x.visto_el.slice(0, 10)}`);
    }
  } else if (comando === 'revocar' || comando === 'reactivar') {
    const baja = comando === 'revocar';
    for (const f of await unaSola(db, objetivo)) {
      await db
        .prepare('UPDATE licencias SET estado = ?, motivo = ?, actualizada_el = ? WHERE clave_hash = ?')
        .bind(baja ? 'revocada' : 'activa', baja ? (opcion('motivo') ? `manual: ${opcion('motivo')}` : 'manual') : null, ahora, f.clave_hash)
        .run();
      console.log(`${baja ? 'Revocada' : 'Reactivada'}: …${f.pista} (${f.email ?? 'sin email'})`);
    }
  } else if (comando === 'liberar') {
    for (const f of await unaSola(db, objetivo)) {
      const r = await db.prepare('DELETE FROM dispositivos WHERE clave_hash = ?').bind(f.clave_hash).run();
      console.log(`…${f.pista}: ${r.meta.changes ?? 0} teléfono(s) desactivado(s).`);
    }
  } else if (comando === 'listar') {
    const n = Number(objetivo ?? 30);
    const t = await db
      .prepare("SELECT COUNT(*) AS total, SUM(estado = 'activa') AS activas FROM licencias")
      .first<{ total: number; activas: number }>();
    console.log(`${t?.total ?? 0} licencias, ${t?.activas ?? 0} activas. Últimas ${n}:`);
    const r = await db
      .prepare('SELECT l.*, (SELECT COUNT(*) FROM dispositivos d WHERE d.clave_hash = l.clave_hash) AS n FROM licencias l ORDER BY creada_el DESC LIMIT ?')
      .bind(n)
      .all<FilaLicencia & { n: number }>();
    for (const f of r.results) console.log(fila(f, f.n));
  } else if (comando === 'eventos') {
    const r = await db.prepare('SELECT * FROM eventos ORDER BY id DESC LIMIT ?').bind(Number(objetivo ?? 30)).all<Record<string, string>>();
    for (const e of r.results) console.log(`${e.el.slice(0, 19)}  ${e.tipo.padEnd(28)} ${e.detalle}`);
  } else throw new Error(`Comando desconocido: ${comando}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
