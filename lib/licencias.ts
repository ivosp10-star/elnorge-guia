// Licencias de elnorge: la base de datos propia (Cloudflare D1) de quién pagó.
//
// - Cada compra en Lemon Squeezy genera una clave de licencia. Lemon Squeezy la manda por mail y avisa por
//   webhook; acá se guarda (solo el hash de la clave, nunca la clave en claro) con el producto, el mail y el pedido.
// - Si el webhook no llegó, la licencia se importa la primera vez que alguien la activa (se verifica con la
//   API de licencias de Lemon Squeezy, que además dice de qué tienda y producto es).
// - Las licencias quedan acá aunque se cambie de procesador de pagos: quien pagó sigue recibiendo actualizaciones.
// - Cada licencia se activa en hasta LIMITE_DISPOSITIVOS teléfonos (3 por defecto).
// - Un reembolso (webhook order_refunded) o una clave deshabilitada en Lemon Squeezy la dan de baja.

import { aBase64, claveDeVersion, hmacSha256Hex, igualesSeguro, sha256Hex } from './cifrado.ts';

export interface Sentencia {
  bind(...valores: unknown[]): Sentencia;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}

/** Lo que se usa de D1 (lo implementan D1, node:sqlite en los tests y la API REST en herramientas/). */
export interface BaseDeDatos {
  prepare(sql: string): Sentencia;
  batch(sentencias: Sentencia[]): Promise<unknown[]>;
}

export interface Entorno {
  DB?: BaseDeDatos;
  /** Base64 de 32 bytes. Deriva la clave de cada versión del contenido. */
  CLAVE_MAESTRA?: string;
  /** Id de la tienda en Lemon Squeezy. */
  LS_TIENDA?: string;
  /** Productos de Lemon Squeezy: "id=app,id=combo,id=pdf". */
  LS_PRODUCTOS?: string;
  /** Secreto de firma del webhook (el mismo que se carga en Lemon Squeezy). */
  LS_WEBHOOK_SECRETO?: string;
  LIMITE_DISPOSITIVOS?: string;
}

export interface Dependencias {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  ahora: () => Date;
}

export type Producto = 'app' | 'combo' | 'pdf';
const PRODUCTOS: readonly string[] = ['app', 'combo', 'pdf'];
/** Productos que incluyen las actualizaciones de la app. */
const CON_ACTUALIZACIONES: readonly string[] = ['app', 'combo'];
const LIMITE_POR_DEFECTO = 3;
/** Teléfonos que se pueden quitar desde otro teléfono cada 30 días (cambio de teléfono, uno perdido). */
export const BAJAS_POR_MES = 3;

export const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS licencias (
    clave_hash TEXT PRIMARY KEY,
    pista TEXT NOT NULL,
    proveedor TEXT NOT NULL,
    producto TEXT NOT NULL,
    email TEXT,
    pedido TEXT,
    estado TEXT NOT NULL DEFAULT 'activa',
    motivo TEXT,
    limite INTEGER,
    creada_el TEXT NOT NULL,
    actualizada_el TEXT NOT NULL,
    nota TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS licencias_email ON licencias (email)',
  'CREATE INDEX IF NOT EXISTS licencias_pedido ON licencias (proveedor, pedido)',
  `CREATE TABLE IF NOT EXISTS dispositivos (
    clave_hash TEXT NOT NULL,
    id TEXT NOT NULL,
    nombre TEXT,
    activado_el TEXT NOT NULL,
    visto_el TEXT NOT NULL,
    PRIMARY KEY (clave_hash, id)
  )`,
  'CREATE TABLE IF NOT EXISTS bajas (clave_hash TEXT NOT NULL, el TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, el TEXT NOT NULL, tipo TEXT NOT NULL, detalle TEXT)',
];

export type Codigo =
  | 'pedido-invalido'
  | 'clave-invalida'
  | 'no-encontrada'
  | 'revocada'
  | 'producto'
  | 'limite'
  | 'dispositivo'
  | 'bajas'
  | 'version'
  | 'no-configurado'
  | 'proveedor';

const ESTADO_HTTP: Record<Codigo, number> = {
  'pedido-invalido': 400,
  'clave-invalida': 400,
  'no-encontrada': 404,
  revocada: 403,
  producto: 403,
  limite: 409,
  dispositivo: 403,
  bajas: 429,
  version: 400,
  'no-configurado': 503,
  proveedor: 502,
};

export interface DispositivoPublico {
  id: string;
  nombre: string | null;
  activado_el: string;
  visto_el: string;
}

export type Falla = { ok: false; error: Codigo; estado: number; dispositivos?: DispositivoPublico[]; limite?: number };
export type Resultado<T> = ({ ok: true } & T) | Falla;

export interface FilaLicencia {
  clave_hash: string;
  pista: string;
  proveedor: string;
  producto: string;
  email: string | null;
  pedido: string | null;
  estado: string;
  motivo: string | null;
  limite: number | null;
  creada_el: string;
  actualizada_el: string;
  nota: string | null;
}

const falla = (error: Codigo, extra: Partial<Falla> = {}): Falla => ({ ok: false, error, estado: ESTADO_HTTP[error], ...extra });

/** La clave como la pegó la persona, sin espacios. Lemon Squeezy la compara tal cual. */
export function normalizarClave(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const c = x.replace(/\s+/g, '');
  return /^[A-Za-z0-9-]{16,64}$/.test(c) ? c : null;
}

/** El hash no distingue mayúsculas: la misma clave escrita distinto es la misma licencia. */
export const hashClave = (clave: string) => sha256Hex(clave.toUpperCase());
export const pistaClave = (clave: string) => clave.slice(-4).toUpperCase();

function idDispositivo(x: unknown): string | null {
  return typeof x === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(x) ? x : null;
}

function nombreDispositivo(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const n = x.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
  return n || null;
}

export function enmascararEmail(e: string | null | undefined): string | null {
  if (!e || !e.includes('@')) return null;
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}•••@${d}`;
}

const VERSION = /^\d{4}-\d{2}-\d{2}\.\d{1,4}$/;

const inicializadas = new WeakSet<object>();

/** La base con las tablas creadas (una vez por instancia). Sin base configurada: null. */
export async function abrir(env: Entorno): Promise<BaseDeDatos | null> {
  const db = env.DB;
  if (!db) return null;
  if (!inicializadas.has(db)) {
    await db.batch(ESQUEMA.map((s) => db.prepare(s)));
    inicializadas.add(db);
  }
  return db;
}

function mapaProductos(env: Entorno): Map<string, Producto> {
  const m = new Map<string, Producto>();
  for (const par of (env.LS_PRODUCTOS ?? '').split(',')) {
    const [id, p] = par.split('=').map((s) => s.trim());
    if (id && PRODUCTOS.includes(p)) m.set(id, p as Producto);
  }
  return m;
}

const limiteDe = (env: Entorno, fila: FilaLicencia) => {
  const n = fila.limite ?? Number(env.LIMITE_DISPOSITIVOS);
  return Number.isInteger(n) && n > 0 ? n : LIMITE_POR_DEFECTO;
};

async function registrar(db: BaseDeDatos, ahora: Date, tipo: string, detalle: Record<string, unknown>) {
  await db.prepare('INSERT INTO eventos (el, tipo, detalle) VALUES (?, ?, ?)').bind(ahora.toISOString(), tipo, JSON.stringify(detalle)).run();
}

const leerLicencia = (db: BaseDeDatos, hash: string) =>
  db.prepare('SELECT * FROM licencias WHERE clave_hash = ?').bind(hash).first<FilaLicencia>();

export async function insertarLicencia(db: BaseDeDatos, f: FilaLicencia): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT INTO licencias (clave_hash, pista, proveedor, producto, email, pedido, estado, motivo, limite, creada_el, actualizada_el, nota)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (clave_hash) DO NOTHING`,
    )
    .bind(f.clave_hash, f.pista, f.proveedor, f.producto, f.email, f.pedido, f.estado, f.motivo, f.limite, f.creada_el, f.actualizada_el, f.nota)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

type Verificacion =
  | { tipo: 'valida' | 'deshabilitada'; producto: Producto; email: string | null; pedido: string | null }
  | { tipo: 'no-encontrada' | 'otro-producto' | 'error' };

/** Pregunta a la API de licencias de Lemon Squeezy (pública, sin clave de API) si la clave existe y de qué es. */
async function verificarEnLemonSqueezy(env: Entorno, clave: string, deps: Dependencias): Promise<Verificacion> {
  if (!env.LS_TIENDA) return { tipo: 'no-encontrada' };
  let r: Response;
  try {
    r = await deps.fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ license_key: clave }).toString(),
    });
  } catch {
    return { tipo: 'error' };
  }
  if (r.status === 429 || r.status >= 500) return { tipo: 'error' };
  let d: { valid?: boolean; license_key?: { status?: string }; meta?: Record<string, unknown> };
  try {
    d = await r.json();
  } catch {
    return { tipo: 'error' };
  }
  const meta = d?.meta;
  // Una clave de otra tienda de Lemon Squeezy es, para nosotros, una clave que no existe.
  if (!meta || !d.license_key || String(meta.store_id) !== String(env.LS_TIENDA)) return { tipo: 'no-encontrada' };
  const producto = mapaProductos(env).get(String(meta.product_id));
  if (!producto) return { tipo: 'otro-producto' };
  const datos = {
    producto,
    email: typeof meta.customer_email === 'string' ? meta.customer_email : null,
    pedido: meta.order_id != null ? String(meta.order_id) : null,
  };
  if (d.valid === true) return { tipo: 'valida', ...datos };
  if (d.license_key.status === 'disabled' || d.license_key.status === 'expired') return { tipo: 'deshabilitada', ...datos };
  return { tipo: 'no-encontrada' };
}

/** La licencia de la base; si no está, la importa de Lemon Squeezy. */
async function obtenerLicencia(env: Entorno, db: BaseDeDatos, clave: string, deps: Dependencias): Promise<FilaLicencia | Codigo> {
  const hash = await hashClave(clave);
  const fila = await leerLicencia(db, hash);
  if (fila) return fila;
  const v = await verificarEnLemonSqueezy(env, clave, deps);
  if (v.tipo === 'error') return 'proveedor';
  if (v.tipo === 'no-encontrada') return 'no-encontrada';
  if (v.tipo === 'otro-producto') return 'producto';
  const ahora = deps.ahora().toISOString();
  await insertarLicencia(db, {
    clave_hash: hash,
    pista: pistaClave(clave),
    proveedor: 'lemonsqueezy',
    producto: v.producto,
    email: v.email,
    pedido: v.pedido,
    estado: v.tipo === 'valida' ? 'activa' : 'revocada',
    motivo: v.tipo === 'valida' ? null : 'proveedor',
    limite: null,
    creada_el: ahora,
    actualizada_el: ahora,
    nota: 'importada al activar',
  });
  await registrar(db, deps.ahora(), 'importada', { pedido: v.pedido, producto: v.producto, resultado: v.tipo });
  return (await leerLicencia(db, hash)) ?? 'no-encontrada';
}

function impedimento(f: FilaLicencia): Codigo | null {
  if (f.estado !== 'activa') return 'revocada';
  if (!CON_ACTUALIZACIONES.includes(f.producto)) return 'producto';
  return null;
}

async function dispositivosDe(db: BaseDeDatos, hash: string): Promise<DispositivoPublico[]> {
  const r = await db
    .prepare('SELECT id, nombre, activado_el, visto_el FROM dispositivos WHERE clave_hash = ? ORDER BY activado_el')
    .bind(hash)
    .all<DispositivoPublico>();
  return r.results.map((d) => ({ id: d.id, nombre: d.nombre, activado_el: d.activado_el, visto_el: d.visto_el }));
}

export interface Activada {
  producto: string;
  email: string | null;
  dispositivos: number;
  limite: number;
}

/** Activa la licencia en este teléfono. Si ya estaba activado, solo lo actualiza. */
export async function activar(env: Entorno, cuerpo: Record<string, unknown>, deps: Dependencias): Promise<Resultado<Activada>> {
  const db = await abrir(env);
  if (!db) return falla('no-configurado');
  const clave = normalizarClave(cuerpo.clave);
  if (!clave) return falla('clave-invalida');
  const disp = idDispositivo(cuerpo.dispositivo);
  if (!disp) return falla('pedido-invalido');
  const lic = await obtenerLicencia(env, db, clave, deps);
  if (typeof lic === 'string') return falla(lic);
  const imp = impedimento(lic);
  if (imp) return falla(imp);

  const limite = limiteDe(env, lic);
  const ahora = deps.ahora().toISOString();
  const nombre = nombreDispositivo(cuerpo.nombre);
  const ya = await db
    .prepare('UPDATE dispositivos SET visto_el = ?, nombre = COALESCE(?, nombre) WHERE clave_hash = ? AND id = ?')
    .bind(ahora, nombre, lic.clave_hash, disp)
    .run();
  if (!ya.meta.changes) {
    // Inserta solo si hay lugar (en una sola sentencia: dos activaciones a la vez no pasan el límite).
    const nuevo = await db
      .prepare(
        `INSERT INTO dispositivos (clave_hash, id, nombre, activado_el, visto_el)
         SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM dispositivos WHERE clave_hash = ?) < ?`,
      )
      .bind(lic.clave_hash, disp, nombre, ahora, ahora, lic.clave_hash, limite)
      .run();
    if (!nuevo.meta.changes) return falla('limite', { dispositivos: await dispositivosDe(db, lic.clave_hash), limite });
  }
  const n = (await dispositivosDe(db, lic.clave_hash)).length;
  return { ok: true, producto: lic.producto, email: enmascararEmail(lic.email), dispositivos: n, limite };
}

/** Desactiva este teléfono o, con `quitar`, otro de la misma licencia (hasta BAJAS_POR_MES cada 30 días). */
export async function desactivar(
  env: Entorno,
  cuerpo: Record<string, unknown>,
  deps: Dependencias,
): Promise<Resultado<{ dispositivos: DispositivoPublico[] }>> {
  const db = await abrir(env);
  if (!db) return falla('no-configurado');
  const clave = normalizarClave(cuerpo.clave);
  if (!clave) return falla('clave-invalida');
  const disp = idDispositivo(cuerpo.dispositivo);
  const objetivo = cuerpo.quitar === undefined ? disp : idDispositivo(cuerpo.quitar);
  if (!disp || !objetivo) return falla('pedido-invalido');
  const lic = await leerLicencia(db, await hashClave(clave));
  if (!lic) return falla('no-encontrada');

  const ahora = deps.ahora();
  const otro = objetivo !== disp;
  if (otro) {
    const desde = new Date(ahora.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    const c = await db
      .prepare('SELECT COUNT(*) AS n FROM bajas WHERE clave_hash = ? AND el > ?')
      .bind(lic.clave_hash, desde)
      .first<{ n: number }>();
    if ((c?.n ?? 0) >= BAJAS_POR_MES) return falla('bajas', { dispositivos: await dispositivosDe(db, lic.clave_hash) });
  }
  const r = await db.prepare('DELETE FROM dispositivos WHERE clave_hash = ? AND id = ?').bind(lic.clave_hash, objetivo).run();
  if (otro && r.meta.changes) {
    await db.prepare('INSERT INTO bajas (clave_hash, el) VALUES (?, ?)').bind(lic.clave_hash, ahora.toISOString()).run();
  }
  return { ok: true, dispositivos: await dispositivosDe(db, lic.clave_hash) };
}

/** La clave AES de una versión del contenido, para un teléfono activado de una licencia vigente. */
export async function claveParaVersion(
  env: Entorno,
  cuerpo: Record<string, unknown>,
  deps: Dependencias,
): Promise<Resultado<{ clave: string }>> {
  const db = await abrir(env);
  if (!db || !env.CLAVE_MAESTRA) return falla('no-configurado');
  const clave = normalizarClave(cuerpo.clave);
  if (!clave) return falla('clave-invalida');
  const disp = idDispositivo(cuerpo.dispositivo);
  if (!disp) return falla('pedido-invalido');
  if (typeof cuerpo.version !== 'string' || !VERSION.test(cuerpo.version)) return falla('version');
  const lic = await leerLicencia(db, await hashClave(clave));
  if (!lic) return falla('no-encontrada');
  const imp = impedimento(lic);
  if (imp) return falla(imp);
  const visto = await db
    .prepare('UPDATE dispositivos SET visto_el = ? WHERE clave_hash = ? AND id = ?')
    .bind(deps.ahora().toISOString(), lic.clave_hash, disp)
    .run();
  if (!visto.meta.changes) return falla('dispositivo');
  return { ok: true, clave: aBase64(await claveDeVersion(env.CLAVE_MAESTRA, cuerpo.version)) };
}

// ---- Webhook de Lemon Squeezy ----

interface AtributosLicencia {
  key?: string;
  store_id?: number | string;
  product_id?: number | string;
  order_id?: number | string;
  user_email?: string;
  status?: string;
  disabled?: boolean;
}

const deshabilitada = (a: AtributosLicencia) => a.disabled === true || a.status === 'disabled' || a.status === 'expired';

/**
 * Procesa un webhook firmado. Eventos: license_key_created y license_key_updated (alta, baja o rehabilitación
 * de una clave) y order_refunded (reembolso total → baja de las licencias del pedido).
 */
export async function webhookLemonSqueezy(
  env: Entorno,
  crudo: string,
  firma: string | null,
  deps: Dependencias,
): Promise<{ estado: number; cuerpo: Record<string, unknown> }> {
  if (!env.LS_WEBHOOK_SECRETO || !env.DB) return { estado: 503, cuerpo: { ok: false, error: 'no-configurado' } };
  if (!firma || !igualesSeguro(await hmacSha256Hex(env.LS_WEBHOOK_SECRETO, crudo), firma.trim().toLowerCase())) {
    return { estado: 401, cuerpo: { ok: false, error: 'firma' } };
  }
  let d: { meta?: { event_name?: string }; data?: { id?: string | number; attributes?: Record<string, unknown> } };
  try {
    d = JSON.parse(crudo);
  } catch {
    return { estado: 400, cuerpo: { ok: false, error: 'pedido-invalido' } };
  }
  const db = (await abrir(env))!;
  const evento = d.meta?.event_name ?? '';
  const a = (d.data?.attributes ?? {}) as AtributosLicencia & Record<string, unknown>;
  const ahora = deps.ahora();
  const iso = ahora.toISOString();
  const nuestra = String(a.store_id) === String(env.LS_TIENDA ?? '');

  let resultado = 'ignorado';
  if ((evento === 'license_key_created' || evento === 'license_key_updated') && nuestra) {
    const clave = normalizarClave(a.key);
    const producto = mapaProductos(env).get(String(a.product_id));
    if (!clave) resultado = 'sin-clave';
    else if (!producto) resultado = 'otro-producto';
    else {
      const hash = await hashClave(clave);
      const baja = deshabilitada(a);
      const nueva = await insertarLicencia(db, {
        clave_hash: hash,
        pista: pistaClave(clave),
        proveedor: 'lemonsqueezy',
        producto,
        email: typeof a.user_email === 'string' ? a.user_email : null,
        pedido: a.order_id != null ? String(a.order_id) : null,
        estado: baja ? 'revocada' : 'activa',
        motivo: baja ? 'proveedor' : null,
        limite: null,
        creada_el: iso,
        actualizada_el: iso,
        nota: null,
      });
      if (nueva) resultado = baja ? 'alta-revocada' : 'alta';
      else if (baja) {
        const r = await db
          .prepare("UPDATE licencias SET estado = 'revocada', motivo = 'proveedor', actualizada_el = ? WHERE clave_hash = ? AND estado = 'activa'")
          .bind(iso, hash)
          .run();
        resultado = r.meta.changes ? 'baja' : 'sin-cambios';
      } else {
        // Rehabilitada en Lemon Squeezy. Una baja hecha a mano (motivo 'manual') no se deshace sola.
        const r = await db
          .prepare(
            "UPDATE licencias SET estado = 'activa', motivo = NULL, actualizada_el = ? WHERE clave_hash = ? AND estado = 'revocada' AND motivo IN ('proveedor', 'reembolso')",
          )
          .bind(iso, hash)
          .run();
        resultado = r.meta.changes ? 'rehabilitada' : 'sin-cambios';
      }
    }
  } else if (evento === 'order_refunded' && nuestra) {
    // Solo el reembolso total; uno parcial (status 'partial_refund') no da de baja.
    if (a.status === 'refunded' && d.data?.id != null) {
      const r = await db
        .prepare(
          "UPDATE licencias SET estado = 'revocada', motivo = 'reembolso', actualizada_el = ? WHERE proveedor = 'lemonsqueezy' AND pedido = ? AND estado = 'activa'",
        )
        .bind(iso, String(d.data.id))
        .run();
      resultado = `bajas:${r.meta.changes ?? 0}`;
    } else resultado = 'reembolso-parcial';
  } else if (!nuestra && evento) resultado = 'otra-tienda';

  await registrar(db, ahora, `ls:${evento || 'sin-evento'}`, { pedido: a.order_id ?? d.data?.id ?? null, resultado });
  return { estado: 200, cuerpo: { ok: true, resultado } };
}
