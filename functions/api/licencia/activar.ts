// POST /api/licencia/activar {clave, dispositivo, nombre?} → activa la licencia en este teléfono.
import { leerJson, responder } from '../../../lib/http.ts';
import { activar } from '../../../lib/licencias.ts';
import { dependencias, type Funcion } from '../../../lib/pages.ts';

export const onRequestPost: Funcion = async ({ request, env }) => {
  const cuerpo = await leerJson(request);
  if (!cuerpo) return responder({ ok: false, error: 'pedido-invalido', estado: 400 });
  return responder(await activar(env, cuerpo, dependencias()));
};
