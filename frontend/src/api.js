// Se llama cuando el backend responde 401 (sesión vencida) para volver al login
let alExpirar = () => {};
export const siExpiraSesion = (fn) => {
  alExpirar = fn;
};

async function pedir(url, opciones) {
  const r = await fetch(url, opciones);
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => null);
    if (r.status === 401 && url !== '/api/login') alExpirar();
    const error = new Error(cuerpo?.error ?? `Error ${r.status}`);
    error.status = r.status;
    throw error;
  }
  return r.status === 204 ? null : r.json();
}

const get = (url) => pedir(url);
const post = (url, datos) =>
  pedir(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos ?? {}),
  });

const tel = (t) => encodeURIComponent(t);

export const api = {
  sesion: () => get('/api/sesion'),
  login: (usuario, clave) => post('/api/login', { usuario, clave }),
  logout: () => post('/api/logout'),
  conversaciones: (q) => get(`/api/conversaciones${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  conversacion: (t) => get(`/api/conversaciones/${tel(t)}`),
  mensajes: (t, params = {}) =>
    get(`/api/conversaciones/${tel(t)}/mensajes?${new URLSearchParams(params)}`),
  mensaje: (id) => get(`/api/mensajes/${id}`),
  estadisticas: (dias) => get(`/api/estadisticas?dias=${dias}`),
};
