// Clave AES-256-GCM de cada versión del contenido: HKDF-SHA256 de la clave maestra (CLAVE_MAESTRA, 32 bytes en base64).
// La app nunca tiene la maestra: pide a /api/clave la de la versión que quiere bajar.
// La misma derivación está en elnorge/src/lib/cifrado.ts y los tests de los dos repos usan el mismo vector.

const texto = new TextEncoder();
export const SAL = 'elnorge-actualizaciones-v1';

export function desdeBase64(s: string): Uint8Array {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function aBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export async function claveDeVersion(maestraB64: string, version: string): Promise<Uint8Array> {
  const maestra = desdeBase64(maestraB64);
  if (maestra.length !== 32) throw new Error('CLAVE_MAESTRA tiene que ser base64 de 32 bytes');
  const base = await crypto.subtle.importKey('raw', maestra as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: texto.encode(SAL), info: texto.encode(version) },
    base,
    256,
  );
  return new Uint8Array(bits);
}

export async function sha256Hex(datos: string | Uint8Array): Promise<string> {
  const bytes = typeof datos === 'string' ? texto.encode(datos) : datos;
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(secreto: string, datos: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', texto.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('HMAC', k, texto.encode(datos));
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compara sin cortar en el primer carácter distinto (para firmas). */
export function igualesSeguro(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}
