import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { accesoDe, lolimsaDisponible, normalizar, registrarIngreso, validarEnLolimsa } from './usuarios.js';

// Formas de entrar al visor:
// - Usuario (login o documento) y clave de Lolimsa, validados por api_csjd como en app-citas. Además, el
//   usuario debe tener acceso asignado en el engranaje (ver usuarios.js). Requiere CSJD_API_URL y USUARIOS_API_KEY.
// - Cuenta de respaldo VISOR_USUARIO / VISOR_CLAVE del .env (normalmente SOPORTETI) para cuando Lolimsa o
//   api_csjd no responden. Su rol es el que tenga asignado, como cualquier otro usuario.
// Sin ninguna de las dos, el visor queda abierto sin login (solo para desarrollo).
const RESPALDO_USUARIO = normalizar(process.env.VISOR_USUARIO);
const RESPALDO_CLAVE = process.env.VISOR_CLAVE ?? '';
const conRespaldo = Boolean(RESPALDO_USUARIO && RESPALDO_CLAVE);
export const loginActivo = conRespaldo || lolimsaDisponible;

// Sin VISOR_SECRETO se genera uno al arrancar: reiniciar el backend cierra las sesiones
const SECRETO = process.env.VISOR_SECRETO || randomBytes(32).toString('hex');
const COOKIE = 'visor_sesion';
const DURACION_MS = 12 * 60 * 60 * 1000;

const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;
const fallos = new Map(); // ip -> { n, hasta }

const SIN_LOGIN = { usuario: null, nombre: null, rol: null, conLogin: false, esAdmin: false };

const hash = (s) => createHash('sha256').update(s).digest();
const iguales = (a, b) => timingSafeEqual(hash(a), hash(b));
const firmar = (datos) => createHmac('sha256', SECRETO).update(datos).digest('base64url');

function crearToken(usuario) {
  const datos = Buffer.from(JSON.stringify({ u: usuario, exp: Date.now() + DURACION_MS })).toString('base64url');
  return `${datos}.${firmar(datos)}`;
}

function leerToken(token) {
  const [datos, firma] = (token ?? '').split('.');
  if (!datos || !firma || !iguales(firma, firmar(datos))) return null;
  const { u, exp } = JSON.parse(Buffer.from(datos, 'base64url').toString());
  return exp > Date.now() ? normalizar(u) : null;
}

function leerCookie(req) {
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const [nombre, ...valor] = parte.trim().split('=');
    if (nombre === COOKIE) return valor.join('=');
  }
  return null;
}

const datosSesion = ({ usuario, nombre, rol, permanente }) => ({
  usuario,
  nombre: nombre ?? null,
  rol,
  permanente: Boolean(permanente),
  conLogin: true,
  esAdmin: rol === 'ADMIN',
});

// La cookie solo dice quién es; el rol se vuelve a leer en cada petición, así que quitarle el acceso
// a alguien en el engranaje lo saca del visor aunque su cookie siga vigente.
export async function requiereSesion(req, res, next) {
  if (!loginActivo) return next();
  const usuario = leerToken(leerCookie(req));
  const acceso = usuario ? await accesoDe(usuario) : null;
  if (!acceso) {
    if (usuario) res.clearCookie(COOKIE, { path: '/' });
    return res.status(401).json({ error: usuario ? 'Tu acceso al visor fue retirado' : 'Sesión no iniciada o expirada' });
  }
  req.sesion = { usuario, ...acceso };
  next();
}

// Va después de requiereSesion. Sin login configurado no hay usuario, así que nadie es administrador.
export function requiereAdmin(req, res, next) {
  if (req.sesion?.rol === 'ADMIN') return next();
  res.status(403).json({ error: 'Solo los administradores del visor pueden entrar a la configuración' });
}

export const rutasAuth = express.Router();

rutasAuth.get('/api/sesion', requiereSesion, (req, res) => {
  res.json(loginActivo ? datosSesion(req.sesion) : SIN_LOGIN);
});

// Usuario y clave: primero la cuenta de respaldo (sin red) y luego Lolimsa.
// @returns { usuario, nombre?, documento? } o null si no coinciden
async function identificar(usuario, clave) {
  if (conRespaldo && iguales(normalizar(usuario), RESPALDO_USUARIO) && iguales(clave, RESPALDO_CLAVE)) {
    return { usuario: RESPALDO_USUARIO };
  }
  if (!lolimsaDisponible) return null;
  const datos = await validarEnLolimsa(usuario, clave);
  return datos ? { usuario: normalizar(datos.usuario), nombre: datos.nombre, documento: datos.documento } : null;
}

rutasAuth.post('/api/login', express.json(), async (req, res) => {
  if (!loginActivo) return res.json(SIN_LOGIN);

  const ahora = Date.now();
  const previo = fallos.get(req.ip);
  if (previo?.hasta > ahora) {
    const minutos = Math.ceil((previo.hasta - ahora) / 60000);
    return res.status(429).json({ error: `Demasiados intentos fallidos. Intenta de nuevo en ${minutos} min.` });
  }

  const usuario = String(req.body?.usuario ?? '').trim();
  const clave = String(req.body?.clave ?? '');
  if (!usuario || !clave) return res.status(400).json({ error: 'Escribe tu usuario y tu clave' });

  // Si Lolimsa no responde, identificar lanza un ErrorVisor 503 que no cuenta como intento fallido
  const identidad = await identificar(usuario, clave);
  if (!identidad) {
    const n = (previo?.n ?? 0) + 1;
    fallos.set(req.ip, n >= MAX_INTENTOS ? { n: 0, hasta: ahora + BLOQUEO_MS } : { n, hasta: 0 });
    return res.status(401).json({ error: 'Usuario o clave incorrectos' });
  }
  fallos.delete(req.ip);

  const acceso = await accesoDe(identidad.usuario);
  if (!acceso) {
    return res.status(403).json({
      error: `El usuario ${identidad.usuario} no tiene acceso al visor. Pídele a un administrador que te lo asigne.`,
    });
  }

  registrarIngreso(identidad).catch((e) => console.error('No se pudo registrar el ingreso:', e.message));
  res.cookie(COOKIE, crearToken(identidad.usuario), {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: DURACION_MS,
    path: '/',
  });
  res.json(datosSesion({ ...acceso, usuario: identidad.usuario, nombre: identidad.nombre ?? acceso.nombre }));
});

rutasAuth.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.status(204).end();
});
