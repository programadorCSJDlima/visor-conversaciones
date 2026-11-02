// Aplica el formato de WhatsApp: *negrita*, _cursiva_, ~tachado~ y ```monoespaciado```
const PATRON = /```([\s\S]+?)```|(?<![\p{L}\p{N}])([*_~])(?!\s)([^\n]+?)(?<!\s)\2(?![\p{L}\p{N}])/gu;
const ETIQUETA = { '*': 'strong', _: 'em', '~': 's' };

function formatear(texto, prefijo = '') {
  const partes = [];
  let ultimo = 0;
  for (const m of texto.matchAll(PATRON)) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index));
    const clave = `${prefijo}${m.index}`;
    if (m[1] !== undefined) {
      partes.push(<code key={clave}>{m[1]}</code>);
    } else {
      const Etiqueta = ETIQUETA[m[2]];
      partes.push(<Etiqueta key={clave}>{formatear(m[3], `${clave}-`)}</Etiqueta>);
    }
    ultimo = m.index + m[0].length;
  }
  partes.push(texto.slice(ultimo));
  return partes;
}

export default function TextoWhatsapp({ texto }) {
  return <div className="texto">{formatear(texto)}</div>;
}
