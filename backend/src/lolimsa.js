// Estado de las citas en Lolimsa, consultado a través de api_csjd (la API del chatbot, que tiene
// acceso a Oracle): GET /api/v1/citas?numeroDocumento=&desde= devuelve las citas del paciente con
// sus marcas de atendida (citas.statte) y pagada en caja (citas.stapag_caj).
// Una cita anulada en Lolimsa deja de existir en lolimsa.citas, así que ya no aparece en esa lista.

const URL_API = process.env.CSJD_API_URL?.replace(/\/+$/, '');
export const lolimsaConfigurado = Boolean(URL_API);

const VIGENCIA_MS = 2 * 60 * 1000;
const PARALELAS = 4;
const cache = new Map(); // "documento|desde" -> { hasta, promesa }

function citasPorDocumento(documento, desde, fresco) {
  const ahora = Date.now();
  const clave = `${documento}|${desde}`;
  const previo = cache.get(clave);
  if (!fresco && previo && previo.hasta > ahora) return previo.promesa;

  for (const [k, v] of cache) if (v.hasta <= ahora) cache.delete(k);
  const url = `${URL_API}/api/v1/citas?${new URLSearchParams({ numeroDocumento: documento, desde })}`;
  const promesa = fetch(url, { signal: AbortSignal.timeout(15000) }).then(async (r) => {
    const cuerpo = await r.json().catch(() => null);
    // 404: no hay paciente con ese documento, así que tampoco citas
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(cuerpo?.descripcion ?? `api_csjd respondió ${r.status}`);
    return cuerpo?.data ?? [];
  });
  cache.set(clave, { hasta: ahora + VIGENCIA_MS, promesa });
  promesa.catch(() => cache.delete(clave));
  return promesa;
}

/**
 * @param consultas [{ documento, desde: 'yyyy-mm-dd' }]
 * @param fresco    true: no usa las respuestas guardadas en memoria
 * @returns Map documento -> { citas } | { error }
 */
export async function consultarDocumentos(consultas, { fresco = false } = {}) {
  const resultado = new Map();
  let siguiente = 0;
  const trabajar = async () => {
    while (siguiente < consultas.length) {
      const { documento, desde } = consultas[siguiente++];
      try {
        resultado.set(documento, { citas: await citasPorDocumento(documento, desde, fresco) });
      } catch (e) {
        let error = e.message;
        if (e.name === 'TimeoutError') error = 'api_csjd no respondió a tiempo';
        else if (e.cause) error = `No se pudo conectar con api_csjd (${e.cause.code ?? e.cause.message})`;
        resultado.set(documento, { error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALELAS, consultas.length) }, trabajar));
  return resultado;
}
