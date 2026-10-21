// Genera assets/datos.js (muestra del glosario y títulos de módulos) desde el contenido compilado de la app.
// Uso: node herramientas/generar-datos.mjs [ruta del repo elnorge]   (antes: npm run contenido en elnorge)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const app = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..', 'elnorge'));
const IDIOMAS = ['es', 'en', 'de', 'fr', 'it', 'pl', 'sr'];
const leer = (l) => JSON.parse(readFileSync(join(app, 'src', 'generated', l === 'es' ? 'content.json' : `content.${l}.json`), 'utf8'));
const C = Object.fromEntries(IDIOMAS.map((l) => [l, leer(l)]));

// Muestra: las categorías del vocabulario básico de obra más una selección de términos de otros temas.
const CATEGORIAS = ['electrotecnia', 'protecciones-maquinas', 'cables-montaje', 'seguridad'];
const EXTRA = ['kursfortegnelse', 'sikringsskap', 'tavle', 'samsvarserklaering', 'stjerne-trekant', 'frekvensomformer-vfd', 'kontaktor', 'motorvern', 'hovedtavle-om-bord-msb', 'nodtavle-esb', 'landstrom', 'skott', 'trappebryter', 'nodlys', 'varme-arbeider', 'brannvakt', 'presstang', 'momentnokkel', 'enlinjeskjema', 'kabelliste', 'revisjon', 'avvik', 'fagbrev', 'tommestokk', 'stillas', 'vernebriller', 'jordingsleder', 'skjerm', 'merkeskilt', 'igangkjoring', 'rekkeklemme', 'endehylse', 'kabelsko', 'tiltrekkingsmoment', 'kabelgjennomforing-mct', 'skrutrekker', 'tangamperemeter', 'multimeter', 'isolasjonstester', 'stromtransformator-ct', 'termografikamera', 'lysarmatur', 'lysbryter', 'koblingsboks-jb', 'hovedjordskinne', 'jordspyd', 'isolasjonsovervaking-imd', 'automatisk-drift'];
const slug = (s) => s.toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const ids = new Set([...C.es.glosario.filter((g) => CATEGORIAS.includes(g.categoria)).map((g) => g.id), ...EXTRA]);
const glosario = [];
for (const id of ids) {
  const e = C.es.glosario.find((g) => g.id === id);
  if (!e) continue;
  const base = slug(e.no);
  // La sigla va al final del id (jordfeilbryter-rcd → RCD).
  const ab = id.startsWith(base + '-') ? id.slice(base.length + 1).toUpperCase().replace(/-/g, ' ') : '';
  const o = { no: e.no, en: e.en, ab, t: {} };
  for (const l of IDIOMAS) {
    const g = C[l].glosario.find((x) => x.id === id);
    o.t[l] = [g.es, g.definicion];
  }
  glosario.push(o);
}
const modulos = Object.fromEntries(IDIOMAS.map((l) => [l, [...C[l].modulos].sort((a, b) => a.orden - b.orden).map((m) => [m.titulo, m.titulo_no])]));
const destino = join(import.meta.dirname, '..', 'assets', 'datos.js');
writeFileSync(destino, 'window.DATOS=' + JSON.stringify({ glosario, modulos }) + ';\n');
console.log(`${glosario.length} términos, ${(readFileSync(destino).length / 1024).toFixed(0)} KB`);
