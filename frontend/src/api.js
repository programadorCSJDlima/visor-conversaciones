async function get(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => null);
    throw new Error(cuerpo?.error ?? `Error ${r.status}`);
  }
  return r.json();
}

const tel = (t) => encodeURIComponent(t);

export const api = {
  conversaciones: (q) => get(`/api/conversaciones${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  conversacion: (t) => get(`/api/conversaciones/${tel(t)}`),
  mensajes: (t, params = {}) =>
    get(`/api/conversaciones/${tel(t)}/mensajes?${new URLSearchParams(params)}`),
  mensaje: (id) => get(`/api/mensajes/${id}`),
};
