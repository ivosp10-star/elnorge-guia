# elnorge — landing

Página de venta de la guía elnorge (app Android + guía en PDF), en 7 idiomas. Es un sitio estático: `index.html` con el CSS y el JS adentro, y `assets/`.

- **Diseño:** basado en el prompt "Fastshot" de MotionSites (héroe con video de fondo y tarjeta de búsqueda). La tarjeta busca de verdad en una muestra de 50 términos del glosario de la app.
- **Imágenes:** el fondo (fiordo con astillero) y su video se generaron con Higgsfield (GPT Image 2.5 y Kling 3.0). Las capturas de la app son reales (`assets/capturas/<idioma>-*.webp`).
- **Textos:** `assets/textos.js` (un bloque por idioma). Datos del glosario y de los módulos: `assets/datos.js`, generado desde el contenido de la app.

## Activar la venta

Arriba del `<script>` principal de `index.html` está `CONFIG`:

```js
const CONFIG = {
  comprarApp: '',   // link de pago de la app
  comprarPdf: '',   // link de pago del PDF
  precioApp: '',    // por ejemplo '149 kr'
  precioPdf: '',
};
```

Mientras estén vacíos, los botones dicen "Disponible muy pronto". Con un link (Gumroad, Lemon Squeezy, Stripe Payment Links…) pasan a "Comprar".

## Publicar

Está en GitHub Pages (rama `main`, carpeta raíz). Cada `git push` publica en unos minutos. Para probar en local: cualquier servidor estático en esta carpeta.
