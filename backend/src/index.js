import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loginActivo, requiereSesion, rutasAuth } from './auth.js';
import { citasAgendadas } from './citas.js';
import { rutasConfiguracion } from './configuracion.js';
import { pool } from './db.js';
import { estadisticas, MAX_DIAS_RANGO, PERIODOS } from './estadisticas.js';
import { aMensaje } from './mensajes.js';
import { lolimsaDisponible, prepararTabla } from './usuarios.js';

const app = express();
const PUERTO = Number(process.env.PUERTO || 3001);

// Detrás de nginx (Docker) la IP real del usuario llega en X-Forwarded-For;
// se usa para limitar los intentos de login por IP
if (process.env.DETRAS_DE_PROXY) app.set('trust proxy', 1);

// Usado por el healthcheck de Docker; va antes del login y no expone datos
app.get('/api/salud', async (req, res) => {
  await pool.query('select 1');
  res.json({ ok: true });
});

app.use(rutasAuth);
app.use('/api', requiereSesion);
app.use(rutasConfiguracion);

const comoLike = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

// yyyy-mm-dd que además sea una fecha real (descarta, p. ej., 2026-02-31)
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '') && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

// ?dias=1|7|30|90|0 (0 = todo el historial) o ?desde=yyyy-mm-dd&hasta=yyyy-mm-dd (ambas incluidas)
app.get('/api/estadisticas', async (req, res) => {
  const { desde, hasta } = req.query;
  if (desde || hasta) {
    if (!esFecha(desde) || !esFecha(hasta) || desde > hasta) {
      return res.status(400).json({ error: 'desde y hasta deben ser fechas yyyy-mm-dd, con desde <= hasta' });
    }
    if ((Date.parse(hasta) - Date.parse(desde)) / 864e5 + 1 > MAX_DIAS_RANGO) {
      return res.status(400).json({ error: `El rango puede tener como máximo ${MAX_DIAS_RANGO} días` });
    }
    return res.json(await estadisticas({ desde, hasta }));
  }
  const dias = Number(req.query.dias ?? 30);
  if (!PERIODOS.includes(dias)) return res.status(400).json({ error: `dias debe ser uno de: ${PERIODOS}` });
  res.json(await estadisticas({ dias }));
});

// Citas agendadas por el bot, con su pago por link y su estado en Lolimsa (mismos periodos que el panel)
app.get('/api/citas', async (req, res) => {
  const dias = Number(req.query.dias ?? 30);
  if (!PERIODOS.includes(dias)) return res.status(400).json({ error: `dias debe ser uno de: ${PERIODOS}` });
  // ?fresco=1 vuelve a consultar Lolimsa aunque haya una respuesta reciente en memoria
  res.json(await citasAgendadas(dias, { fresco: req.query.fresco === '1' }));
});

app.get('/api/conversaciones', async (req, res) => {
  const q = req.query.q?.trim();
  const limite = Math.min(Number(req.query.limite) || 100, 500);

  const { rows } = await pool.query(
    `with resumen as (
       select telefono,
              count(*)::int as total,
              count(*) filter (where estado = 'ERROR')::int as errores,
              min(creado_en) as primer_mensaje,
              max(creado_en) as ultimo_mensaje
       from chatbot_mensajes
       group by telefono
     ),
     ultimo as (
       select distinct on (telefono) telefono, direccion, tipo, texto
       from chatbot_mensajes
       order by telefono, id desc
     ),
     contacto as (
       select distinct on (telefono) telefono, payload #>> '{contacts,0,profile,name}' as nombre
       from chatbot_mensajes
       where direccion = 'IN' and payload #>> '{contacts,0,profile,name}' is not null
       order by telefono, id desc
     )
     select r.telefono,
            k.nombre as nombre_whatsapp,
            nullif(concat_ws(' ', c.datos #>> '{paciente,nombres}',
                                  c.datos #>> '{paciente,apellidoPaterno}',
                                  c.datos #>> '{paciente,apellidoMaterno}'), '') as paciente,
            c.paso,
            r.total, r.errores, r.primer_mensaje, r.ultimo_mensaje,
            u.direccion as ultimo_direccion, u.tipo as ultimo_tipo, u.texto as ultimo_texto
     from resumen r
     join ultimo u using (telefono)
     left join contacto k using (telefono)
     left join chatbot_conversaciones c using (telefono)
     where $1::text is null
        or r.telefono ilike $1
        or k.nombre ilike $1
        or c.datos::text ilike $1
        or exists (select 1 from chatbot_mensajes m where m.telefono = r.telefono and m.texto ilike $1)
     order by r.ultimo_mensaje desc
     limit $2`,
    [q ? comoLike(q) : null, limite],
  );
  res.json(rows);
});

app.get('/api/conversaciones/:telefono', async (req, res) => {
  const { rows } = await pool.query(
    `select telefono, paso, datos, actualizado_en, privacidad_aceptada_en
     from chatbot_conversaciones where telefono = $1`,
    [req.params.telefono],
  );
  res.json(rows[0] ?? null);
});

// ?antes=<id> pagina hacia atrás; ?despues=<id> trae solo lo nuevo (para el refresco automático)
app.get('/api/conversaciones/:telefono/mensajes', async (req, res) => {
  const { telefono } = req.params;
  const columnas = 'id, direccion, tipo, texto, payload, paso, creado_en, estado, error';

  if (req.query.despues) {
    const { rows } = await pool.query(
      `select ${columnas} from chatbot_mensajes
       where telefono = $1 and id > $2 order by id limit 500`,
      [telefono, req.query.despues],
    );
    return res.json({ mensajes: rows.map(aMensaje), hayAnteriores: false });
  }

  const limite = Math.min(Number(req.query.limite) || 150, 500);
  const { rows } = await pool.query(
    `select ${columnas} from chatbot_mensajes
     where telefono = $1 and ($2::bigint is null or id < $2)
     order by id desc limit $3`,
    [telefono, req.query.antes ?? null, limite + 1],
  );
  const hayAnteriores = rows.length > limite;
  res.json({ mensajes: rows.slice(0, limite).reverse().map(aMensaje), hayAnteriores });
});

app.get('/api/mensajes/:id', async (req, res) => {
  const { rows } = await pool.query(
    `select id, telefono, direccion, tipo, texto, payload, wa_message_id, paso, creado_en, estado, error
     from chatbot_mensajes where id = $1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Mensaje no encontrado' });
  res.json(rows[0]);
});

// Opcional: servir el build del frontend desde este mismo proceso (FRONTEND_DIST=../frontend/dist)
if (process.env.FRONTEND_DIST) {
  const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dist = path.resolve(raiz, process.env.FRONTEND_DIST);
  if (!existsSync(path.join(dist, 'index.html'))) {
    throw new Error(`FRONTEND_DIST no contiene un build: ${dist} (ejecutar npm run build en frontend/)`);
  }
  app.use(express.static(dist));
  app.get('/{*ruta}', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Los ErrorVisor (usuarios.js) y los errores de express.json traen su propio status
app.use((err, req, res, next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message });
});

app.listen(PUERTO, (err) => {
  if (err) throw err;
  console.log(`Visor de conversaciones en http://localhost:${PUERTO}`);
  if (!loginActivo) console.warn('Sin login: define CSJD_API_URL y USUARIOS_API_KEY (o VISOR_USUARIO y VISOR_CLAVE)');
  else if (!lolimsaDisponible) console.warn('Login solo con la cuenta de respaldo: falta USUARIOS_API_KEY para validar en Lolimsa');
  if (loginActivo) {
    prepararTabla().then(
      () => console.log('Tabla visor_usuarios lista'),
      (e) => console.error('No se pudo preparar la tabla visor_usuarios:', e.message),
    );
  }
});
