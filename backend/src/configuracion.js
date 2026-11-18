// Configuración del visor (el engranaje del encabezado): solo usuarios con rol ADMIN.
// Va montado después de requiereSesion, que deja en req.sesion quién hace cada cambio.
import express from 'express';
import { requiereAdmin } from './auth.js';
import {
  actualizar,
  ADMIN_PERMANENTE,
  asignar,
  buscarEnLolimsa,
  listar,
  lolimsaDisponible,
  quitar,
  ROLES,
} from './usuarios.js';

export const rutasConfiguracion = express.Router();
rutasConfiguracion.use('/api/configuracion', requiereAdmin, express.json());

rutasConfiguracion.get('/api/configuracion', (req, res) => {
  res.json({ adminPermanente: ADMIN_PERMANENTE, roles: ROLES, busquedaLolimsa: lolimsaDisponible });
});

rutasConfiguracion.get('/api/configuracion/usuarios', async (req, res) => {
  res.json(await listar());
});

// ?q= login, documento o nombre de un usuario activo de Lolimsa
rutasConfiguracion.get('/api/configuracion/usuarios/lolimsa', async (req, res) => {
  res.json(await buscarEnLolimsa(req.query.q));
});

// { usuario: login o documento de Lolimsa, rol: ADMIN | USUARIO }
rutasConfiguracion.post('/api/configuracion/usuarios', async (req, res) => {
  res.status(201).json(await asignar(req.body?.usuario, req.body?.rol, req.sesion.usuario));
});

// { rol?, activo? }
rutasConfiguracion.patch('/api/configuracion/usuarios/:usuario', async (req, res) => {
  const { rol, activo } = req.body ?? {};
  res.json(await actualizar(req.params.usuario, { rol, activo }, req.sesion.usuario));
});

rutasConfiguracion.delete('/api/configuracion/usuarios/:usuario', async (req, res) => {
  await quitar(req.params.usuario, req.sesion.usuario);
  res.status(204).end();
});
