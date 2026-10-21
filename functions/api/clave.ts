// POST /api/clave {clave, dispositivo, version} → clave AES de esa versión del contenido (solo con licencia vigente).
import { leerJson, responder } from '../../lib/http.ts';
import { claveParaVersion } from '../../lib/licencias.ts';
import { dependencias, type Funcion } from '../../lib/pages.ts';

export const onRequestPost: Funcion = async ({ request, env }) => {
  const cuerpo = await leerJson(request);
  if (!cuerpo) return responder({ ok: false, error: 'pedido-invalido', estado: 400 });
  return responder(await claveParaVersion(env, cuerpo, dependencias()));
};
