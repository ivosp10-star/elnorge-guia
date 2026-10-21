import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { aBase64, claveDeVersion, desdeBase64, hmacSha256Hex } from '../lib/cifrado.ts';
import {
  BAJAS_POR_MES,
  activar,
  claveParaVersion,
  desactivar,
  hashClave,
  insertarLicencia,
  webhookLemonSqueezy,
  type BaseDeDatos,
  type Dependencias,
  type Entorno,
  type Sentencia,
} from '../lib/licencias.ts';

/** D1 de mentira sobre node:sqlite (misma interfaz que usa lib/licencias). */
function baseEnMemoria(): BaseDeDatos & { sql: DatabaseSync } {
  const sql = new DatabaseSync(':memory:');
  const sentencia = (texto: string, valores: unknown[] = []): Sentencia => ({
    bind: (...v: unknown[]) => sentencia(texto, v),
    first: async <T,>() => ((sql.prepare(texto).get(...(valores as never[])) as T) ?? null),
    all: async <T,>() => ({ results: sql.prepare(texto).all(...(valores as never[])) as T[] }),
    run: async () => ({ meta: { changes: Number(sql.prepare(texto).run(...(valores as never[])).changes) } }),
  });
  return { sql, prepare: (t) => sentencia(t), batch: async (ss) => Promise.all(ss.map((s) => s.run())) };
}

const MAESTRA = aBase64(new Uint8Array(32).fill(7));
const TIENDA = '4242';

function entorno(extra: Partial<Entorno> = {}): Entorno & { DB: ReturnType<typeof baseEnMemoria> } {
  return {
    DB: baseEnMemoria(),
    CLAVE_MAESTRA: MAESTRA,
    LS_TIENDA: TIENDA,
    LS_PRODUCTOS: '100=app, 200=combo, 300=pdf',
    LS_WEBHOOK_SECRETO: 'secreto-de-prueba',
    ...extra,
  } as Entorno & { DB: ReturnType<typeof baseEnMemoria> };
}

/** Lemon Squeezy de mentira: claves conocidas → respuesta de /v1/licenses/validate. */
function lemon(claves: Record<string, { tienda?: string; producto?: number; estado?: string; valida?: boolean }>) {
  const llamadas: string[] = [];
  const f: Dependencias['fetch'] = async (url, init) => {
    llamadas.push(url);
    const clave = new URLSearchParams(String(init?.body)).get('license_key') ?? '';
    const c = claves[clave];
    if (!c) return new Response(JSON.stringify({ valid: false, error: 'license_key not found.', license_key: null, meta: null }), { status: 404 });
    return new Response(
      JSON.stringify({
        valid: c.valida ?? true,
        error: null,
        license_key: { id: 1, status: c.estado ?? 'inactive', key: clave, activation_limit: null, activation_usage: 0 },
        instance: null,
        meta: { store_id: Number(c.tienda ?? TIENDA), order_id: 9001, product_id: c.producto ?? 100, customer_email: 'cliente@example.com' },
      }),
      { status: 200 },
    );
  };
  return { fetch: f, llamadas };
}

const reloj = (inicio = '2026-10-21T10:00:00Z') => {
  let t = new Date(inicio).getTime();
  return { ahora: () => new Date(t), avanzar: (dias: number) => (t += dias * 864e5) };
};

const deps = (f: Dependencias['fetch'] = lemon({}).fetch, r = reloj()): Dependencias => ({ fetch: f, ahora: r.ahora });

async function manual(env: Entorno, clave: string, producto = 'app', estado = 'activa') {
  await activar(env, {}, deps()); // crea las tablas
  await insertarLicencia(env.DB!, {
    clave_hash: await hashClave(clave),
    pista: clave.slice(-4),
    proveedor: 'manual',
    producto,
    email: 'tester@example.com',
    pedido: null,
    estado,
    motivo: estado === 'activa' ? null : 'manual',
    limite: null,
    creada_el: '2026-10-21T00:00:00Z',
    actualizada_el: '2026-10-21T00:00:00Z',
    nota: 'prueba',
  });
}

const CLAVE = 'ELN-AAAAA-BBBBB-CCCCC-DDDDD';
const LS_CLAVE = '38b1460a-5104-4067-a91d-77b872934d51';

describe('activar', () => {
  it('sin base configurada → no-configurado (503)', async () => {
    const r = await activar({}, { clave: CLAVE, dispositivo: 'tel-00001' }, deps());
    expect(r).toMatchObject({ ok: false, error: 'no-configurado', estado: 503 });
  });

  it('clave con forma rara → clave-invalida', async () => {
    const r = await activar(entorno(), { clave: 'hola', dispositivo: 'tel-00001' }, deps());
    expect(r).toMatchObject({ ok: false, error: 'clave-invalida' });
  });

  it('licencia manual: activa, y el mismo teléfono dos veces cuenta una', async () => {
    const env = entorno();
    await manual(env, CLAVE);
    const a = await activar(env, { clave: CLAVE, dispositivo: 'tel-00001', nombre: 'Pixel 7' }, deps());
    expect(a).toMatchObject({ ok: true, producto: 'app', email: 'te•••@example.com', dispositivos: 1, limite: 3 });
    const b = await activar(env, { clave: ` ${CLAVE.toLowerCase()} `, dispositivo: 'tel-00001' }, deps());
    expect(b).toMatchObject({ ok: true, dispositivos: 1 });
  });

  it('límite de 3 teléfonos → el cuarto recibe "limite" con la lista', async () => {
    const env = entorno();
    await manual(env, CLAVE);
    for (const t of ['tel-00001', 'tel-00002', 'tel-00003']) expect((await activar(env, { clave: CLAVE, dispositivo: t }, deps())).ok).toBe(true);
    const r = await activar(env, { clave: CLAVE, dispositivo: 'tel-00004' }, deps());
    expect(r).toMatchObject({ ok: false, error: 'limite', estado: 409, limite: 3 });
    expect(r.ok === false && r.dispositivos?.map((d) => d.id)).toEqual(['tel-00001', 'tel-00002', 'tel-00003']);
  });

  it('LIMITE_DISPOSITIVOS cambia el límite', async () => {
    const env = entorno({ LIMITE_DISPOSITIVOS: '1' });
    await manual(env, CLAVE);
    expect((await activar(env, { clave: CLAVE, dispositivo: 'tel-00001' }, deps())).ok).toBe(true);
    expect(await activar(env, { clave: CLAVE, dispositivo: 'tel-00002' }, deps())).toMatchObject({ error: 'limite' });
  });

  it('revocada → revocada; del PDF → producto', async () => {
    const env = entorno();
    await manual(env, CLAVE, 'app', 'revocada');
    await manual(env, 'ELN-PDFPD-FPDFP-DFPDF-PDFPD', 'pdf');
    expect(await activar(env, { clave: CLAVE, dispositivo: 'tel-00001' }, deps())).toMatchObject({ error: 'revocada', estado: 403 });
    expect(await activar(env, { clave: 'ELN-PDFPD-FPDFP-DFPDF-PDFPD', dispositivo: 'tel-00001' }, deps())).toMatchObject({ error: 'producto' });
  });

  it('clave de Lemon Squeezy que no está en la base: se importa una sola vez', async () => {
    const env = entorno();
    const ls = lemon({ [LS_CLAVE]: {} });
    const a = await activar(env, { clave: LS_CLAVE, dispositivo: 'tel-00001' }, deps(ls.fetch));
    expect(a).toMatchObject({ ok: true, producto: 'app', email: 'cl•••@example.com' });
    const fila = env.DB.sql.prepare('SELECT proveedor, pedido, estado FROM licencias').get();
    expect(fila).toMatchObject({ proveedor: 'lemonsqueezy', pedido: '9001', estado: 'activa' });
    await activar(env, { clave: LS_CLAVE, dispositivo: 'tel-00002' }, deps(ls.fetch));
    expect(ls.llamadas).toHaveLength(1);
  });

  it('Lemon Squeezy: clave inexistente, de otra tienda o de un producto sin mapear', async () => {
    const env = entorno();
    const ls = lemon({ 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee': { tienda: '999' }, 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee': { producto: 555 } });
    expect(await activar(env, { clave: '00000000-0000-0000-0000-000000000000', dispositivo: 'tel-00001' }, deps(ls.fetch))).toMatchObject({ error: 'no-encontrada', estado: 404 });
    expect(await activar(env, { clave: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', dispositivo: 'tel-00001' }, deps(ls.fetch))).toMatchObject({ error: 'no-encontrada' });
    expect(await activar(env, { clave: 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee', dispositivo: 'tel-00001' }, deps(ls.fetch))).toMatchObject({ error: 'producto' });
    expect(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM licencias').get()).toMatchObject({ n: 0 });
  });

  it('Lemon Squeezy: clave deshabilitada (reembolso) → revocada y queda registrada', async () => {
    const env = entorno();
    const ls = lemon({ [LS_CLAVE]: { valida: false, estado: 'disabled' } });
    expect(await activar(env, { clave: LS_CLAVE, dispositivo: 'tel-00001' }, deps(ls.fetch))).toMatchObject({ error: 'revocada' });
    expect(env.DB.sql.prepare('SELECT estado, motivo FROM licencias').get()).toMatchObject({ estado: 'revocada', motivo: 'proveedor' });
  });

  it('Lemon Squeezy caído → proveedor (502), sin guardar nada', async () => {
    const env = entorno();
    const caido: Dependencias['fetch'] = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await activar(env, { clave: LS_CLAVE, dispositivo: 'tel-00001' }, deps(caido))).toMatchObject({ error: 'proveedor', estado: 502 });
    const error500: Dependencias['fetch'] = async () => new Response('x', { status: 500 });
    expect(await activar(env, { clave: LS_CLAVE, dispositivo: 'tel-00001' }, deps(error500))).toMatchObject({ error: 'proveedor' });
  });
});

describe('desactivar', () => {
  it('este teléfono libera su lugar', async () => {
    const env = entorno({ LIMITE_DISPOSITIVOS: '1' });
    await manual(env, CLAVE);
    await activar(env, { clave: CLAVE, dispositivo: 'tel-00001' }, deps());
    expect(await desactivar(env, { clave: CLAVE, dispositivo: 'tel-00001' }, deps())).toMatchObject({ ok: true, dispositivos: [] });
    expect((await activar(env, { clave: CLAVE, dispositivo: 'tel-00002' }, deps())).ok).toBe(true);
  });

  it(`quitar otro teléfono: hasta ${BAJAS_POR_MES} cada 30 días`, async () => {
    const env = entorno({ LIMITE_DISPOSITIVOS: '1' });
    const r = reloj();
    await manual(env, CLAVE);
    let actual = 'tel-00000';
    await activar(env, { clave: CLAVE, dispositivo: actual }, deps(undefined, r));
    for (let i = 1; i <= BAJAS_POR_MES; i++) {
      const nuevo = `tel-0000${i}`;
      expect(await activar(env, { clave: CLAVE, dispositivo: nuevo }, deps(undefined, r))).toMatchObject({ error: 'limite' });
      expect((await desactivar(env, { clave: CLAVE, dispositivo: nuevo, quitar: actual }, deps(undefined, r))).ok).toBe(true);
      expect((await activar(env, { clave: CLAVE, dispositivo: nuevo }, deps(undefined, r))).ok).toBe(true);
      actual = nuevo;
    }
    expect(await desactivar(env, { clave: CLAVE, dispositivo: 'tel-00009', quitar: actual }, deps(undefined, r))).toMatchObject({ error: 'bajas', estado: 429 });
    r.avanzar(31);
    expect((await desactivar(env, { clave: CLAVE, dispositivo: 'tel-00009', quitar: actual }, deps(undefined, r))).ok).toBe(true);
  });

  it('clave que no está en la base → no-encontrada', async () => {
    expect(await desactivar(entorno(), { clave: CLAVE, dispositivo: 'tel-00001' }, deps())).toMatchObject({ error: 'no-encontrada' });
  });
});

describe('clave de versión', () => {
  it('teléfono activado → la clave HKDF de esa versión; otra versión, otra clave', async () => {
    const env = entorno();
    await manual(env, CLAVE);
    await activar(env, { clave: CLAVE, dispositivo: 'tel-00001' }, deps());
    const a = await claveParaVersion(env, { clave: CLAVE, dispositivo: 'tel-00001', version: '2026-10-22.1' }, deps());
    const b = await claveParaVersion(env, { clave: CLAVE, dispositivo: 'tel-00001', version: '2026-10-22.2' }, deps());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.clave).toBe(aBase64(await claveDeVersion(MAESTRA, '2026-10-22.1')));
    expect(a.clave).not.toBe(b.clave);
    expect(desdeBase64(a.clave)).toHaveLength(32);
  });

  it('teléfono no activado, licencia revocada, versión rara o sin clave maestra → no hay clave', async () => {
    const env = entorno();
    await manual(env, CLAVE);
    expect(await claveParaVersion(env, { clave: CLAVE, dispositivo: 'tel-00001', version: '2026-10-22.1' }, deps())).toMatchObject({ error: 'dispositivo', estado: 403 });
    await activar(env, { clave: CLAVE, dispositivo: 'tel-00001' }, deps());
    expect(await claveParaVersion(env, { clave: CLAVE, dispositivo: 'tel-00001', version: '../x' }, deps())).toMatchObject({ error: 'version' });
    env.DB.sql.prepare("UPDATE licencias SET estado = 'revocada'").run();
    expect(await claveParaVersion(env, { clave: CLAVE, dispositivo: 'tel-00001', version: '2026-10-22.1' }, deps())).toMatchObject({ error: 'revocada' });
    expect(await claveParaVersion({ ...env, CLAVE_MAESTRA: undefined }, { clave: CLAVE, dispositivo: 'tel-00001', version: '2026-10-22.1' }, deps())).toMatchObject({ error: 'no-configurado' });
  });

  it('vector compartido con la app (elnorge/tests/licencia.test.ts)', async () => {
    const k = await claveDeVersion(aBase64(new Uint8Array(32)), '2026-10-22.1');
    expect([...k].map((b) => b.toString(16).padStart(2, '0')).join('')).toBe(VECTOR);
  });
});

// HKDF-SHA256(32 bytes en cero, sal "elnorge-actualizaciones-v1", info "2026-10-22.1").
const VECTOR = '473fdfe1f14b81f048d15fe4073e68e982bab23d152efa8d66ab32d1d7357052';

describe('webhook de Lemon Squeezy', () => {
  const evento = (event_name: string, data: Record<string, unknown>) => JSON.stringify({ meta: { event_name }, data });
  const alta = (attrs: Record<string, unknown> = {}) =>
    evento('license_key_created', {
      type: 'license-keys',
      id: '1',
      attributes: { key: LS_CLAVE, store_id: Number(TIENDA), product_id: 200, order_id: 9001, user_email: 'cliente@example.com', status: 'inactive', disabled: false, ...attrs },
    });
  const enviar = async (env: Entorno, cuerpo: string, firma?: string) =>
    webhookLemonSqueezy(env, cuerpo, firma ?? (await hmacSha256Hex('secreto-de-prueba', cuerpo)), deps());

  it('firma incorrecta o ausente → 401 y no guarda nada', async () => {
    const env = entorno();
    expect((await enviar(env, alta(), 'f'.repeat(64))).estado).toBe(401);
    expect((await webhookLemonSqueezy(env, alta(), null, deps())).estado).toBe(401);
    expect((await webhookLemonSqueezy({ ...env, LS_WEBHOOK_SECRETO: undefined }, alta(), 'x', deps())).estado).toBe(503);
  });

  it('alta → la licencia queda en la base y se activa sin preguntar a Lemon Squeezy', async () => {
    const env = entorno();
    expect(await enviar(env, alta())).toMatchObject({ estado: 200, cuerpo: { resultado: 'alta' } });
    const ls = lemon({});
    expect(await activar(env, { clave: LS_CLAVE, dispositivo: 'tel-00001' }, deps(ls.fetch))).toMatchObject({ ok: true, producto: 'combo' });
    expect(ls.llamadas).toHaveLength(0);
    // Reintento del mismo webhook: no duplica.
    expect(await enviar(env, alta())).toMatchObject({ cuerpo: { resultado: 'sin-cambios' } });
  });

  it('reembolso total → baja; parcial → sigue activa', async () => {
    const env = entorno();
    await enviar(env, alta());
    const reembolso = (status: string) => evento('order_refunded', { type: 'orders', id: '9001', attributes: { store_id: Number(TIENDA), status, refunded: status === 'refunded' } });
    expect(await enviar(env, reembolso('partial_refund'))).toMatchObject({ cuerpo: { resultado: 'reembolso-parcial' } });
    expect(env.DB.sql.prepare('SELECT estado FROM licencias').get()).toMatchObject({ estado: 'activa' });
    expect(await enviar(env, reembolso('refunded'))).toMatchObject({ cuerpo: { resultado: 'bajas:1' } });
    expect(env.DB.sql.prepare('SELECT estado, motivo FROM licencias').get()).toMatchObject({ estado: 'revocada', motivo: 'reembolso' });
  });

  it('clave deshabilitada y rehabilitada en Lemon Squeezy; una baja manual no se deshace', async () => {
    const env = entorno();
    await enviar(env, alta());
    const upd = (attrs: Record<string, unknown>) =>
      evento('license_key_updated', { type: 'license-keys', id: '1', attributes: { key: LS_CLAVE, store_id: Number(TIENDA), product_id: 200, order_id: 9001, ...attrs } });
    expect(await enviar(env, upd({ status: 'disabled', disabled: true }))).toMatchObject({ cuerpo: { resultado: 'baja' } });
    expect(await enviar(env, upd({ status: 'active', disabled: false }))).toMatchObject({ cuerpo: { resultado: 'rehabilitada' } });
    env.DB.sql.prepare("UPDATE licencias SET estado = 'revocada', motivo = 'manual'").run();
    expect(await enviar(env, upd({ status: 'active', disabled: false }))).toMatchObject({ cuerpo: { resultado: 'sin-cambios' } });
  });

  it('eventos de otra tienda o de un producto que no es nuestro se ignoran', async () => {
    const env = entorno();
    expect(await enviar(env, alta({ store_id: 1 }))).toMatchObject({ cuerpo: { resultado: 'otra-tienda' } });
    expect(await enviar(env, alta({ product_id: 777 }))).toMatchObject({ cuerpo: { resultado: 'otro-producto' } });
    expect(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM licencias').get()).toMatchObject({ n: 0 });
    expect(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM eventos').get()).toMatchObject({ n: 2 });
  });
});
