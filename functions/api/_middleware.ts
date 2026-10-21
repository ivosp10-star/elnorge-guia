// CORS para toda la API: la app llama desde https://localhost (Capacitor).
import { cabecerasCors, origenPermitido } from '../../lib/http.ts';
import type { Funcion } from '../../lib/pages.ts';

export const onRequest: Funcion = async ({ request, next }) => {
  const cors = cabecerasCors(origenPermitido(request.headers.get('origin')));
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const r = await next();
  const res = new Response(r.body, r);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
};
