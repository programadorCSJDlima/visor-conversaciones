import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';

// El login se activa si VISOR_USUARIO y VISOR_CLAVE están en el .env
const { VISOR_USUARIO, VISOR_CLAVE } = process.env;
export const loginActivo = Boolean(VISOR_USUARIO && VISOR_CLAVE);

// Sin VISOR_SECRETO se genera uno al arrancar: reiniciar el backend cierra las sesiones
const SECRETO = process.env.VISOR_SECRETO || randomBytes(32).toString('hex');
const COOKIE = 'visor_sesion';
const DURACION_MS = 12 * 60 * 60 * 1000;

const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;
const fallos = new Map(); // ip -> { n, hasta }

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
  return exp > Date.now() ? u : null;
}

function leerCookie(req) {
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const [nombre, ...valor] = parte.trim().split('=');
    if (nombre === COOKIE) return valor.join('=');
  }
  return null;
}

const usuarioDe = (req) => leerToken(leerCookie(req));

export function requiereSesion(req, res, next) {
  if (!loginActivo || usuarioDe(req)) return next();
  res.status(401).json({ error: 'Sesión no iniciada o expirada' });
}

export const rutasAuth = express.Router();

rutasAuth.get('/api/sesion', (req, res) => {
  if (!loginActivo) return res.json({ usuario: null, conLogin: false });
  const usuario = usuarioDe(req);
  if (!usuario) return res.status(401).json({ error: 'Sesión no iniciada o expirada' });
  res.json({ usuario, conLogin: true });
});

rutasAuth.post('/api/login', express.json(), (req, res) => {
  if (!loginActivo) return res.json({ usuario: null, conLogin: false });

  const ahora = Date.now();
  const previo = fallos.get(req.ip);
  if (previo?.hasta > ahora) {
    const minutos = Math.ceil((previo.hasta - ahora) / 60000);
    return res.status(429).json({ error: `Demasiados intentos fallidos. Intenta de nuevo en ${minutos} min.` });
  }

  const usuarioOk = iguales(String(req.body?.usuario ?? ''), VISOR_USUARIO);
  const claveOk = iguales(String(req.body?.clave ?? ''), VISOR_CLAVE);
  if (!usuarioOk || !claveOk) {
    const n = (previo?.n ?? 0) + 1;
    fallos.set(req.ip, n >= MAX_INTENTOS ? { n: 0, hasta: ahora + BLOQUEO_MS } : { n, hasta: 0 });
    return res.status(401).json({ error: 'Usuario o clave incorrectos' });
  }

  fallos.delete(req.ip);
  res.cookie(COOKIE, crearToken(VISOR_USUARIO), {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: DURACION_MS,
    path: '/',
  });
  res.json({ usuario: VISOR_USUARIO, conLogin: true });
});

rutasAuth.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE, { path: '/' });
  res.status(204).end();
});
