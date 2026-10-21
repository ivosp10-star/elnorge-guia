// Tipos mínimos de Cloudflare Pages Functions (sin depender de @cloudflare/workers-types).
import type { Entorno } from './licencias.ts';

export interface Contexto {
  request: Request;
  env: Entorno;
  next: () => Promise<Response>;
}

export type Funcion = (c: Contexto) => Promise<Response> | Response;

export const dependencias = () => ({
  // fetch envuelto: llamado como método de otro objeto, el de Workers puede fallar ("Illegal invocation").
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
  ahora: () => new Date(),
});
