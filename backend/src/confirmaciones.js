// Textos fijos del bot de los que se sacan los datos de cada cita.
//
// Confirmación ("Tu cita quedó registrada"): N° de cita, especialidad, médico, consultorio, fecha, hora y precio.
// Revisión previa ("Revisa tu cita"): paciente y los últimos dígitos de su documento, p. ej. "Maria Luisa (DNI ••••8841)".
// Si cambian esos textos en el chatbot, hay que ajustar estas expresiones.

export const PATRON_CONFIRMACION = '%cita quedó registrada%';
export const PATRON_REVISION = '%Revisa tu cita%';

const campo = (texto, re) => texto.match(re)?.[1]?.replace(/\*/g, '').trim() || null;

export function leerConfirmacion(texto) {
  const numero = campo(texto, /N[°º]\s*de\s*cita:?\**\s*(\d+)/i);
  if (!numero) return null;
  const precio = campo(texto, /Precio:?\**\s*S\/\s*([\d.,]+)/i);
  return {
    numero,
    especialidad: campo(texto, /Especialidad:?\**\s*([^\n]+)/i),
    medico: campo(texto, /M[ée]dico:?\**\s*([^\n]+)/i),
    consultorio: campo(texto, /Consultorio:?\**\s*([^\n]+)/i),
    fecha: campo(texto, /Fecha:?\**\s*([^\n]+)/i),
    hora: campo(texto, /Hora:?\**\s*([^\n]+)/i),
    precio: precio ? Number(precio.replace(/,/g, '')) : null,
  };
}

export function leerRevision(texto) {
  const m = texto.match(/Paciente:?\**\s*([^(\n]+?)\s*\(([^•*\d)]+?)\s*[•*]+\s*(\w{3,4})\)/i);
  if (!m) return null;
  return { nombre: m[1].replace(/\*/g, '').trim(), tipoDocumento: m[2].trim(), finDocumento: m[3] };
}
