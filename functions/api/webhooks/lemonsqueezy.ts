// POST /api/webhooks/lemonsqueezy: altas, bajas y reembolsos. Lemon Squeezy firma el cuerpo (X-Signature).
import { json } from '../../../lib/http.ts';
import { webhookLemonSqueezy } from '../../../lib/licencias.ts';
import { dependencias, type Funcion } from '../../../lib/pages.ts';

export const onRequestPost: Funcion = async ({ request, env }) => {
  const crudo = await request.text();
  if (crudo.length > 256 * 1024) return json({ ok: false, error: 'pedido-invalido' }, 413);
  const r = await webhookLemonSqueezy(env, crudo, request.headers.get('x-signature'), dependencias());
  return json(r.cuerpo, r.estado);
};
