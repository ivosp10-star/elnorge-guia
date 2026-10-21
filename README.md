# elnorge — landing y API de licencias

Página de venta de la guía elnorge (app Android + guía en PDF), en 7 idiomas, y la API que guarda quién pagó. Está en **Cloudflare Pages**, proyecto `elnorge`: https://elnorge.pages.dev.

- **Landing:** `index.html` (con el CSS y el JS adentro) y `assets/`.
  - **Diseño:** basado en el prompt "Fastshot" de MotionSites (héroe con video de fondo y tarjeta de búsqueda). La tarjeta busca de verdad en una muestra del glosario de la app.
  - **Imágenes:** el fondo (fiordo con astillero) y su video se generaron con Higgsfield (GPT Image 2.5 y Kling 3.0). Las capturas de la app son reales (`assets/capturas/<idioma>-*.webp`).
  - **Textos:** `assets/textos.js` (un bloque por idioma). Datos del glosario y de los módulos: `assets/datos.js`, generado desde el contenido de la app (`herramientas/generar-datos.mjs`).
- **API de licencias** (Pages Functions, `functions/` + `lib/licencias.ts`), con la base **D1 `elnorge-licencias`**:
  - `POST /api/licencia/activar` y `POST /api/licencia/desactivar`: la app activa o quita teléfonos (hasta 3 por licencia).
  - `POST /api/clave`: la clave AES de una versión del contenido, solo para un teléfono activado de una licencia vigente.
  - `POST /api/webhooks/lemonsqueezy`: altas, bajas y reembolsos (firmados con `LS_WEBHOOK_SECRETO`).
- **Actualizaciones cifradas:** `publicar.bat` copia a `dist/actualizaciones/` la que haya preparado `publicar-actualizacion.bat` en `..\elnorge\actualizacion\`.

Cómo funciona la venta de punta a punta y qué hay que configurar en Lemon Squeezy: `..\elnorge\docs\venta.md`.

## Activar la venta

Arriba del `<script>` principal de `index.html` está `CONFIG`:

```js
const CONFIG = {
  comprarApp: '',   // link de pago de la app (Share del producto en Lemon Squeezy)
  comprarPdf: '',   // link de pago del PDF
  precioApp: '',    // por ejemplo '199 kr'
  precioPdf: '',
};
```

Mientras estén vacíos, los botones dicen "Disponible muy pronto". Con un link de Lemon Squeezy, el pago se abre encima de la página (lemon.js); con otro link, se abre normal.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm test` | Tests de la API de licencias (D1 simulada con `node:sqlite`) |
| `npm run configurar` | Genera los secretos que falten en `..\elnorge\.env`, crea la base D1 y carga base y variables en el proyecto de Pages. Necesita el permiso "Account · D1 · Edit" en el token |
| `npm run licencias -- <comando>` | Administrar licencias: `listar`, `ver`, `crear`, `revocar`, `reactivar`, `liberar`, `eventos` (`--local` para la base de prueba) |
| `npm run local` | Landing y API en http://localhost:8788 con una base D1 local, para probar sin tocar Cloudflare |
| `publicar.bat` | Tests, arma `dist/` y despliega |

Las credenciales salen de `..\elnorge\.env`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ELNORGE_CLAVE_MAESTRA`, `LS_WEBHOOK_SECRETO`, `LS_TIENDA` y `LS_PRODUCTOS`.

GitHub Pages ya no sirve la landing: la rama `gh-pages` solo redirige a elnorge.pages.dev, porque GitHub Pages no permite sitios de venta. El contenido de la guía nunca se sube a este repo, que es público: las actualizaciones cifradas se arman en `dist/`, que está ignorado.
