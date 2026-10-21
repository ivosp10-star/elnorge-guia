// POST /api/licencia/desactivar {clave, dispositivo, quitar?} → desactiva este teléfono u otro de la licencia.
import { leerJson, responder } from '../../../lib/http.ts';
import { desactivar } from '../../../lib/licencias.ts';
import { dependencias, type Funcion } from '../../../lib/pages.ts';

export const onRequestPost: Funcion = async ({ request, env }) => {
  const cuerpo = await leerJson(request);
  if (!cuerpo) return responder({ ok: false, error: 'pedido-invalido', estado: 400 });
  return responder(await desactivar(env, cuerpo, dependencias()));
};
