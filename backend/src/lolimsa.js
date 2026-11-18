// Datos de Lolimsa consultados a través de api_csjd (la API del chatbot, que tiene acceso a Oracle):
// - GET /api/v1/citas?numeroDocumento=&desde= devuelve las citas del paciente con sus marcas de
//   atendida (citas.statte) y pagada en caja (citas.stapag_caj). Una cita anulada en Lolimsa deja de
//   existir en lolimsa.citas, así que ya no aparece en esa lista.
// - GET /api/v1/pacientes/documento/{numero} devuelve la ficha del paciente (teléfono registrado, etc.).
// - GET /api/v1/citas/anuladas?numeros= devuelve quién anuló cada cita y cuándo (auditoría SIG_AUD_CITAS).

const URL_API = process.env.CSJD_API_URL?.replace(/\/+$/, '');
export const lolimsaConfigurado = Boolean(URL_API);

const VIGENCIA_CITAS_MS = 2 * 60 * 1000;
const VIGENCIA_PACIENTES_MS = 10 * 60 * 1000;
const VIGENCIA_ANULACIONES_MS = 10 * 60 * 1000;
const MAX_NUMEROS_POR_CONSULTA = 200;
const PARALELAS = 4;
const cache = new Map(); // ruta -> { hasta, promesa }

// GET a api_csjd guardando la respuesta en memoria; sinDatos es lo que vale un 404
function pedir(ruta, { vigencia, fresco, sinDatos }) {
  const ahora = Date.now();
  const previo = cache.get(ruta);
  if (!fresco && previo && previo.hasta > ahora) return previo.promesa;

  for (const [k, v] of cache) if (v.hasta <= ahora) cache.delete(k);
  const promesa = fetch(`${URL_API}${ruta}`, { signal: AbortSignal.timeout(15000) }).then(async (r) => {
    const cuerpo = await r.json().catch(() => null);
    if (r.status === 404) return sinDatos;
    if (!r.ok) throw new Error(cuerpo?.descripcion ?? `api_csjd respondió ${r.status}`);
    return cuerpo?.data ?? sinDatos;
  });
  cache.set(ruta, { hasta: ahora + vigencia, promesa });
  promesa.catch(() => cache.delete(ruta));
  return promesa;
}

function mensajeDeError(e) {
  if (e.name === 'TimeoutError') return 'api_csjd no respondió a tiempo';
  if (e.cause) return `No se pudo conectar con api_csjd (${e.cause.code ?? e.cause.message})`;
  return e.message;
}

// Ejecuta fn sobre cada elemento, como máximo PARALELAS a la vez
async function enParalelo(items, fn) {
  let siguiente = 0;
  const trabajar = async () => {
    while (siguiente < items.length) await fn(items[siguiente++]);
  };
  await Promise.all(Array.from({ length: Math.min(PARALELAS, items.length) }, trabajar));
}

/**
 * @param consultas [{ documento, desde: 'yyyy-mm-dd' }]
 * @param fresco    true: no usa las respuestas guardadas en memoria
 * @returns Map documento -> { citas } | { error }
 */
export async function consultarDocumentos(consultas, { fresco = false } = {}) {
  const resultado = new Map();
  await enParalelo(consultas, async ({ documento, desde }) => {
    const ruta = `/api/v1/citas?${new URLSearchParams({ numeroDocumento: documento, desde })}`;
    try {
      resultado.set(documento, { citas: await pedir(ruta, { vigencia: VIGENCIA_CITAS_MS, fresco, sinDatos: [] }) });
    } catch (e) {
      resultado.set(documento, { error: mensajeDeError(e) });
    }
  });
  return resultado;
}

/**
 * Quién anuló cada cita y cuándo. Igual que el teléfono, es un dato complementario: si api_csjd no lo tiene
 * (versión sin ese endpoint) o falla, las citas se muestran sin él.
 * @returns Map número de cita -> { fecha, usuario, nombre, equipo, ip }
 */
export async function anulacionesDeCitas(numeros) {
  const resultado = new Map();
  const lotes = [];
  for (let i = 0; i < numeros.length; i += MAX_NUMEROS_POR_CONSULTA) {
    lotes.push(numeros.slice(i, i + MAX_NUMEROS_POR_CONSULTA));
  }
  await enParalelo(lotes, async (lote) => {
    try {
      const ruta = `/api/v1/citas/anuladas?numeros=${[...lote].sort().join(',')}`;
      for (const a of await pedir(ruta, { vigencia: VIGENCIA_ANULACIONES_MS, sinDatos: [] })) {
        resultado.set(String(a.numeroCita), {
          fecha: a.fechaAnulacion,
          usuario: a.usuario,
          nombre: a.nombreUsuario,
          equipo: a.equipo,
          ip: a.ip,
        });
      }
    } catch {
      // sin datos de anulación para este lote
    }
  });
  return resultado;
}

/**
 * Teléfono registrado en Lolimsa de cada documento. Si no se pudo consultar, el documento no aparece:
 * es un dato complementario y no debe impedir mostrar las citas.
 * @returns Map documento -> teléfono
 */
export async function telefonosRegistrados(documentos) {
  const resultado = new Map();
  await enParalelo(documentos, async (documento) => {
    try {
      const ruta = `/api/v1/pacientes/documento/${encodeURIComponent(documento)}`;
      const paciente = await pedir(ruta, { vigencia: VIGENCIA_PACIENTES_MS, sinDatos: null });
      // nuevo: el documento no está registrado en Lolimsa (los datos vienen de RENIEC)
      const telefono = paciente && !paciente.nuevo ? paciente.telefono?.trim() : null;
      if (telefono) resultado.set(documento, telefono);
    } catch {
      // sin teléfono registrado para este documento
    }
  });
  return resultado;
}
