// Respuestas JSON y CORS de la API. La app (APK) llama desde https://localhost (Capacitor).

const ORIGENES_APP = ['https://localhost', 'http://localhost', 'capacitor://localhost'];

export function origenPermitido(origen: string | null): string | null {
  if (!origen) return null;
  if (ORIGENES_APP.includes(origen)) return origen;
  // Desarrollo: vite y wrangler pages dev en la propia PC.
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(origen)) return origen;
  return null;
}

export function cabecerasCors(origen: string | null): Record<string, string> {
  if (!origen) return {};
  return {
    'access-control-allow-origin': origen,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Cuerpo JSON de un pedido, o null si no es un objeto JSON chico. */
export async function leerJson(request: Request, maxBytes = 4096): Promise<Record<string, unknown> | null> {
  try {
    const crudo = await request.text();
    if (crudo.length > maxBytes) return null;
    const x = JSON.parse(crudo);
    return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Convierte el resultado de lib/licencias en la respuesta HTTP (el código de estado no va en el cuerpo). */
export function responder(r: { ok: boolean; estado?: number } & Record<string, unknown>): Response {
  const { estado, ...cuerpo } = r;
  return json(cuerpo, r.ok ? 200 : (estado ?? 400));
}
