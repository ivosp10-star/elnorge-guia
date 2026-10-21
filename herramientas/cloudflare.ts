// Acceso a Cloudflare desde la PC (sin wrangler): credenciales de ..\elnorge\.env, API REST y la base D1.
// Corre con Node 24 directo (node herramientas/x.ts), sin compilar.
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BaseDeDatos, Sentencia } from '../lib/licencias.ts';

export const RAIZ = resolve(import.meta.dirname, '..');
export const ARCHIVO_ENV = resolve(RAIZ, '..', 'elnorge', '.env');
export const PROYECTO = 'elnorge';
export const NOMBRE_BASE = 'elnorge-licencias';

export function leerEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(ARCHIVO_ENV)) return env;
  for (const linea of readFileSync(ARCHIVO_ENV, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

export function agregarAlEnv(nombre: string, valor: string, comentario: string) {
  const actual = existsSync(ARCHIVO_ENV) ? readFileSync(ARCHIVO_ENV, 'utf8') : '';
  appendFileSync(ARCHIVO_ENV, `${actual.endsWith('\n') || !actual ? '' : '\n'}# ${comentario}\n${nombre}=${valor}\n`);
}

export class ErrorCloudflare extends Error {
  estado: number;
  codigos: number[];
  constructor(mensaje: string, estado: number, codigos: number[]) {
    super(mensaje);
    this.estado = estado;
    this.codigos = codigos;
  }
  get sinPermiso() {
    return this.estado === 401 || this.estado === 403 || this.codigos.includes(10000);
  }
}

export function clienteCloudflare(env = leerEnv()) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const cuenta = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !cuenta) throw new Error(`Faltan CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID en ${ARCHIVO_ENV}`);
  return async function api<T = unknown>(ruta: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cuenta}${ruta}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { code: number; message: string }[] };
    if (!r.ok || j.success === false) {
      const errores = j.errors ?? [];
      throw new ErrorCloudflare(errores.map((e) => `${e.code}: ${e.message}`).join('; ') || `HTTP ${r.status}`, r.status, errores.map((e) => e.code));
    }
    return j.result as T;
  };
}

/** Id de la base D1 de licencias, o null si no existe. */
export async function idDeLaBase(api: ReturnType<typeof clienteCloudflare>): Promise<string | null> {
  const lista = await api<{ uuid: string; name: string }[]>(`/d1/database?name=${encodeURIComponent(NOMBRE_BASE)}`);
  return lista.find((d) => d.name === NOMBRE_BASE)?.uuid ?? null;
}

/** La base D1 en Cloudflare, por la API REST (cada sentencia es un pedido). */
export function baseRemota(api: ReturnType<typeof clienteCloudflare>, id: string): BaseDeDatos {
  const consulta = async (sql: string, params: unknown[]) => {
    const r = await api<{ results: Record<string, unknown>[]; meta: { changes?: number } }[]>(`/d1/database/${id}/query`, {
      method: 'POST',
      body: { sql, params },
    });
    return r[0];
  };
  const sentencia = (sql: string, valores: unknown[] = []): Sentencia => ({
    bind: (...v: unknown[]) => sentencia(sql, v),
    first: async <T,>() => ((await consulta(sql, valores)).results[0] as T) ?? null,
    all: async <T,>() => ({ results: (await consulta(sql, valores)).results as T[] }),
    run: async () => ({ meta: { changes: (await consulta(sql, valores)).meta?.changes ?? 0 } }),
  });
  return {
    prepare: (sql) => sentencia(sql),
    batch: async (ss) => {
      const out = [];
      for (const s of ss) out.push(await s.run());
      return out;
    },
  };
}

/** La base local de `wrangler pages dev` (.wrangler/state), para probar sin tocar la de verdad. */
export function baseLocal(): BaseDeDatos {
  const dir = join(RAIZ, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject');
  const archivo = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite') : undefined;
  if (!archivo) throw new Error('No hay base local: levantá primero la API con "npm run local" y hacé un pedido.');
  const db = new DatabaseSync(join(dir, archivo));
  const sentencia = (sql: string, valores: unknown[] = []): Sentencia => ({
    bind: (...v: unknown[]) => sentencia(sql, v),
    first: async <T,>() => ((db.prepare(sql).get(...(valores as never[])) as T) ?? null),
    all: async <T,>() => ({ results: db.prepare(sql).all(...(valores as never[])) as T[] }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(valores as never[])).changes) } }),
  });
  return { prepare: (sql) => sentencia(sql), batch: async (ss) => Promise.all(ss.map((s) => s.run())) };
}
