const ZONA = 'America/Lima';

const fmtHora = new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, hour: 'numeric', minute: '2-digit' });
const fmtDia = new Intl.DateTimeFormat('es-PE', {
  timeZone: ZONA,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const fmtCorta = new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: '2-digit' });
const fmtCompleta = new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, dateStyle: 'medium', timeStyle: 'medium' });
const fmtClave = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }); // yyyy-mm-dd

const mayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const claveDia = (f) => fmtClave.format(new Date(f));
export const hora = (f) => fmtHora.format(new Date(f));
export const fechaHora = (f) => (f ? fmtCompleta.format(new Date(f)) : '—');

function haceDias(f) {
  const dia = claveDia(f);
  if (dia === claveDia(Date.now())) return 0;
  if (dia === claveDia(Date.now() - 864e5)) return 1;
  return null;
}

export function fechaLista(f) {
  const d = haceDias(f);
  if (d === 0) return hora(f);
  if (d === 1) return 'Ayer';
  return fmtCorta.format(new Date(f));
}

export function etiquetaDia(f) {
  const d = haceDias(f);
  if (d === 0) return 'Hoy';
  if (d === 1) return 'Ayer';
  return mayuscula(fmtDia.format(new Date(f)));
}

export function telefono(t) {
  if (/^51\d{9}$/.test(t)) return `+51 ${t.slice(2, 5)} ${t.slice(5, 8)} ${t.slice(8)}`;
  return `+${t}`;
}

// ESPERANDO_DNI -> "Esperando DNI"
export function paso(p) {
  if (!p) return 'Sin paso';
  return mayuscula(p.toLowerCase().replace(/_/g, ' ')).replace(/\bdni\b/g, 'DNI');
}

// medico_nombre -> "Medico nombre", fechaNacimiento -> "Fecha nacimiento"
export function etiquetaCampo(k) {
  return mayuscula(k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
}

export function nombrePaciente(datos) {
  const p = datos?.paciente;
  if (!p) return datos?.nombre ?? null;
  return [p.nombres, p.apellidoPaterno, p.apellidoMaterno].filter(Boolean).join(' ') || null;
}

export function iniciales(nombre) {
  const partes = (nombre ?? '').split(/\s+/).filter((p) => /^\p{L}/u.test(p));
  return (partes[0]?.[0] ?? '#') + (partes[1]?.[0] ?? '');
}
