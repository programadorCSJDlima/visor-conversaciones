// Usuarios del visor. Igual que en app-citas, cada persona entra con su usuario y clave de Lolimsa
// (los valida api_csjd contra lolimsa.usuarios; el visor nunca ve ni guarda claves), pero solo si un
// administrador le asignó acceso en el engranaje. Las asignaciones viven en juanita_db (tabla visor_usuarios).
//
// Roles:
//   ADMIN    ve el engranaje y asigna, cambia o quita usuarios
//   USUARIO  ve conversaciones, citas y panel
//
// VISOR_ADMIN (por defecto SOPORTETI) es administrador permanente: siempre puede entrar y no se le puede
// quitar el acceso, desactivar ni bajar de rol.

import { poolUsuarios } from './db.js';

export const ADMIN_PERMANENTE = (process.env.VISOR_ADMIN || 'SOPORTETI').trim().toUpperCase();
export const ROLES = ['ADMIN', 'USUARIO'];

const URL_API = process.env.CSJD_API_URL?.replace(/\/+$/, '');
const CLAVE_API = process.env.USUARIOS_API_KEY?.trim();
// Sin estas dos variables no se puede validar contra Lolimsa (solo queda la cuenta de respaldo del .env)
export const lolimsaDisponible = Boolean(URL_API && CLAVE_API);

// El rol se lee de la base en cada petición, con una memoria corta: quitar o desactivar a alguien desde el
// engranaje lo saca de inmediato (se borra su entrada); un cambio hecho a mano en la tabla tarda como máximo esto
const VIGENCIA_ACCESO_MS = 15 * 1000;
const accesos = new Map(); // usuario -> { hasta, promesa }

export class ErrorVisor extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

export const normalizar = (usuario) => String(usuario ?? '').trim().toUpperCase();

let tablaLista = null;

/** Crea la tabla si no existe y asegura que el administrador permanente esté activo y como ADMIN. */
export function prepararTabla() {
  tablaLista ??= (async () => {
    await poolUsuarios.query(`
      create table if not exists visor_usuarios (
        usuario         text primary key,
        nombre          text,
        documento       text,
        rol             text not null default 'USUARIO' check (rol in ('ADMIN', 'USUARIO')),
        activo          boolean not null default true,
        creado_en       timestamptz not null default now(),
        creado_por      text,
        actualizado_en  timestamptz,
        actualizado_por text,
        ultimo_ingreso  timestamptz
      )`);
    await poolUsuarios.query(
      `insert into visor_usuarios (usuario, rol, activo, creado_por) values ($1, 'ADMIN', true, 'sistema')
       on conflict (usuario) do update set rol = 'ADMIN', activo = true
       where visor_usuarios.rol <> 'ADMIN' or not visor_usuarios.activo`,
      [ADMIN_PERMANENTE],
    );
  })().catch((e) => {
    tablaLista = null; // se reintenta en la próxima petición
    throw e;
  });
  return tablaLista;
}

async function leerAcceso(usuario) {
  try {
    await prepararTabla();
    const { rows } = await poolUsuarios.query(
      'select rol, activo, nombre from visor_usuarios where usuario = $1',
      [usuario],
    );
    const fila = rows[0];
    if (usuario === ADMIN_PERMANENTE) return { rol: 'ADMIN', nombre: fila?.nombre ?? null, permanente: true };
    return fila?.activo ? { rol: fila.rol, nombre: fila.nombre, permanente: false } : null;
  } catch (e) {
    // El administrador permanente no depende de la tabla
    if (usuario === ADMIN_PERMANENTE) return { rol: 'ADMIN', nombre: null, permanente: true };
    throw e;
  }
}

/** { rol, nombre, permanente } si el usuario puede entrar al visor; null si no está asignado o está desactivado. */
export function accesoDe(usuario) {
  const u = normalizar(usuario);
  const ahora = Date.now();
  const previo = accesos.get(u);
  if (previo && previo.hasta > ahora) return previo.promesa;

  for (const [k, v] of accesos) if (v.hasta <= ahora) accesos.delete(k);
  const promesa = leerAcceso(u);
  accesos.set(u, { hasta: ahora + VIGENCIA_ACCESO_MS, promesa });
  promesa.catch(() => accesos.delete(u));
  return promesa;
}

const olvidarAcceso = (usuario) => accesos.delete(usuario);

/**
 * Guarda la fecha del ingreso y refresca nombre y documento con lo que devolvió Lolimsa. Con la cuenta de
 * respaldo no hay datos de Lolimsa: se intentan leer aparte (se llama sin esperar, no frena el login).
 */
export async function registrarIngreso({ usuario, nombre, documento }) {
  if (!nombre && lolimsaDisponible) {
    const datos = await usuarioDeLolimsa(usuario).catch(() => null);
    ({ nombre, documento } = datos ?? {});
  }
  await poolUsuarios.query(
    `update visor_usuarios
        set ultimo_ingreso = now(), nombre = coalesce($2, nombre), documento = coalesce($3, documento)
      where usuario = $1`,
    [usuario, nombre ?? null, documento ?? null],
  );
}

// ---- api_csjd: /api/v1/usuarios-lolimsa (protegido con la cabecera X-Api-Key = USUARIOS_API_KEY)

async function llamarApi(ruta, { metodo = 'GET', cuerpo } = {}) {
  if (!lolimsaDisponible) {
    throw new ErrorVisor(503, 'Falta configurar CSJD_API_URL y USUARIOS_API_KEY en el .env del visor');
  }
  let r;
  try {
    r = await fetch(`${URL_API}/api/v1/usuarios-lolimsa${ruta}`, {
      method: metodo,
      headers: { 'X-Api-Key': CLAVE_API, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error('api_csjd (usuarios):', e.cause ?? e);
    throw new ErrorVisor(
      503,
      e.name === 'TimeoutError' ? 'Lolimsa no respondió a tiempo. Intenta de nuevo.' : 'No se pudo conectar con api_csjd para validar el usuario.',
    );
  }
  return { status: r.status, datos: await r.json().catch(() => null) };
}

function errorDeApi(status, datos) {
  if (status === 403) {
    return new ErrorVisor(503, 'api_csjd rechazó al visor: USUARIOS_API_KEY debe ser igual en ambos .env');
  }
  return new ErrorVisor(503, datos?.descripcion ?? `api_csjd respondió ${status}`);
}

/** Datos del usuario de Lolimsa ({ usuario, nombre, documento, grupo }) si el usuario y la clave son correctos; si no, null. */
export async function validarEnLolimsa(usuario, clave) {
  const { status, datos } = await llamarApi('/validar', { metodo: 'POST', cuerpo: { usuario, clave } });
  if (status === 200) return datos.data;
  if (status === 401) return null;
  if (status === 404) throw new ErrorVisor(503, 'api_csjd no tiene la validación de usuarios: hay que desplegar su versión nueva');
  throw errorDeApi(status, datos);
}

/** Usuario activo de Lolimsa por login o documento; null si no existe o está inactivo. */
async function usuarioDeLolimsa(codigo) {
  const { status, datos } = await llamarApi(`/${encodeURIComponent(codigo)}`);
  if (status === 200) return datos.data;
  if (status === 404) return null;
  throw errorDeApi(status, datos);
}

/** Búsqueda de usuarios activos en Lolimsa para el engranaje (máximo 30). */
export async function buscarEnLolimsa(texto) {
  const q = String(texto ?? '').trim();
  if (q.length < 2) throw new ErrorVisor(400, 'Escribe al menos 2 caracteres para buscar');
  const { status, datos } = await llamarApi(`?${new URLSearchParams({ q })}`);
  if (status !== 200) throw errorDeApi(status, datos);
  return datos.data ?? [];
}

// ---- Administración (engranaje)

const COLUMNAS = `usuario, nombre, documento, rol, activo, creado_en, creado_por,
                  actualizado_en, actualizado_por, ultimo_ingreso`;

const conMarca = (fila) => ({ ...fila, permanente: fila.usuario === ADMIN_PERMANENTE });

export async function listar() {
  await prepararTabla();
  const { rows } = await poolUsuarios.query(
    `select ${COLUMNAS} from visor_usuarios
      order by usuario = $1 desc, rol, coalesce(nombre, usuario)`,
    [ADMIN_PERMANENTE],
  );
  return rows.map(conMarca);
}

function validarCambio(usuario, por) {
  if (usuario === ADMIN_PERMANENTE) {
    throw new ErrorVisor(409, `${ADMIN_PERMANENTE} es administrador permanente: su acceso no se puede cambiar`);
  }
  if (usuario === normalizar(por)) {
    throw new ErrorVisor(409, 'No puedes cambiar tu propio acceso; pídeselo a otro administrador');
  }
}

/** Da acceso al visor a un usuario activo de Lolimsa (por login o documento). */
export async function asignar(codigo, rol, por) {
  const texto = String(codigo ?? '').trim();
  if (!texto) throw new ErrorVisor(400, 'Falta el usuario de Lolimsa');
  if (!ROLES.includes(rol)) throw new ErrorVisor(400, `rol debe ser uno de: ${ROLES.join(', ')}`);

  const datos = await usuarioDeLolimsa(texto);
  if (!datos) throw new ErrorVisor(404, `No hay un usuario activo en Lolimsa con el login o documento ${texto}`);
  const usuario = normalizar(datos.usuario);
  validarCambio(usuario, por);

  await prepararTabla();
  const { rows } = await poolUsuarios.query(
    `insert into visor_usuarios (usuario, nombre, documento, rol, creado_por) values ($1, $2, $3, $4, $5)
     on conflict (usuario) do nothing
     returning ${COLUMNAS}`,
    [usuario, datos.nombre ?? null, datos.documento ?? null, rol, normalizar(por)],
  );
  if (!rows[0]) throw new ErrorVisor(409, `${usuario} ya tiene acceso al visor`);
  olvidarAcceso(usuario);
  return conMarca(rows[0]);
}

/** Cambia el rol y/o activa o desactiva el acceso. */
export async function actualizar(usuarioParam, { rol, activo } = {}, por) {
  const usuario = normalizar(usuarioParam);
  validarCambio(usuario, por);
  if (rol !== undefined && !ROLES.includes(rol)) throw new ErrorVisor(400, `rol debe ser uno de: ${ROLES.join(', ')}`);
  if (activo !== undefined && typeof activo !== 'boolean') throw new ErrorVisor(400, 'activo debe ser true o false');
  if (rol === undefined && activo === undefined) throw new ErrorVisor(400, 'Indica rol o activo');

  await prepararTabla();
  const { rows } = await poolUsuarios.query(
    `update visor_usuarios
        set rol = coalesce($2, rol), activo = coalesce($3, activo), actualizado_en = now(), actualizado_por = $4
      where usuario = $1
      returning ${COLUMNAS}`,
    [usuario, rol ?? null, activo ?? null, normalizar(por)],
  );
  if (!rows[0]) throw new ErrorVisor(404, `${usuario} no tiene acceso asignado`);
  olvidarAcceso(usuario);
  return conMarca(rows[0]);
}

/** Quita el acceso (borra la asignación; el usuario de Lolimsa no se toca). */
export async function quitar(usuarioParam, por) {
  const usuario = normalizar(usuarioParam);
  validarCambio(usuario, por);
  await prepararTabla();
  const { rowCount } = await poolUsuarios.query('delete from visor_usuarios where usuario = $1', [usuario]);
  if (!rowCount) throw new ErrorVisor(404, `${usuario} no tiene acceso asignado`);
  olvidarAcceso(usuario);
}
