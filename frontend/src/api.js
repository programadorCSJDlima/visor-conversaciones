// Se llama cuando el backend responde 401 (sesión vencida o acceso retirado) para volver al login
let alExpirar = () => {};
export const siExpiraSesion = (fn) => {
  alExpirar = fn;
};

async function pedir(url, opciones) {
  const r = await fetch(url, opciones);
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => null);
    const error = new Error(cuerpo?.error ?? `Error ${r.status}`);
    error.status = r.status;
    if (r.status === 401 && url !== '/api/login') alExpirar(error.message);
    throw error;
  }
  return r.status === 204 ? null : r.json();
}

const get = (url) => pedir(url);
const conCuerpo = (method) => (url, datos) =>
  pedir(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos ?? {}),
  });
const post = conCuerpo('POST');
const patch = conCuerpo('PATCH');
const borrar = (url) => pedir(url, { method: 'DELETE' });

const usuarioVisor = (u) => `/api/configuracion/usuarios/${encodeURIComponent(u)}`;

const tel = (t) => encodeURIComponent(t);

const parametrosPeriodo = (periodo, extra = {}) =>
  new URLSearchParams({
    ...(periodo.desde ? { desde: periodo.desde, hasta: periodo.hasta } : { dias: periodo.dias }),
    ...extra,
  });

export const api = {
  sesion: () => get('/api/sesion'),
  login: (usuario, clave) => post('/api/login', { usuario, clave }),
  logout: () => post('/api/logout'),
  conversaciones: (q) => get(`/api/conversaciones${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  conversacion: (t) => get(`/api/conversaciones/${tel(t)}`),
  mensajes: (t, params = {}) =>
    get(`/api/conversaciones/${tel(t)}/mensajes?${new URLSearchParams(params)}`),
  mensaje: (id) => get(`/api/mensajes/${id}`),
  // periodo: { dias } o { desde, hasta } (yyyy-mm-dd)
  estadisticas: (periodo) => get(`/api/estadisticas?${parametrosPeriodo(periodo)}`),
  citas: (periodo, fresco) =>
    get(`/api/citas?${parametrosPeriodo(periodo, fresco ? { fresco: '1' } : {})}`),

  // Engranaje (solo administradores)
  configuracion: () => get('/api/configuracion'),
  usuariosVisor: () => get('/api/configuracion/usuarios'),
  buscarEnLolimsa: (q) => get(`/api/configuracion/usuarios/lolimsa?${new URLSearchParams({ q })}`),
  asignarUsuario: (usuario, rol) => post('/api/configuracion/usuarios', { usuario, rol }),
  cambiarUsuario: (usuario, cambios) => patch(usuarioVisor(usuario), cambios),
  quitarUsuario: (usuario) => borrar(usuarioVisor(usuario)),
};
