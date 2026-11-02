import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pool } from './db.js';
import { aMensaje } from './mensajes.js';

const app = express();
const PUERTO = Number(process.env.PUERTO || 3001);

// Usado por el healthcheck de Docker; va antes de la autenticación y no expone datos
app.get('/api/salud', async (req, res) => {
  await pool.query('select 1');
  res.json({ ok: true });
});

// Autenticación básica opcional: se activa si VISOR_USUARIO y VISOR_CLAVE están en el .env
const { VISOR_USUARIO, VISOR_CLAVE } = process.env;
if (VISOR_USUARIO && VISOR_CLAVE) {
  const hash = (s) => createHash('sha256').update(s).digest();
  const esperado = hash(`${VISOR_USUARIO}:${VISOR_CLAVE}`);
  app.use((req, res, next) => {
    const [esquema, cred] = (req.headers.authorization ?? '').split(' ');
    if (esquema === 'Basic' && cred) {
      const recibido = hash(Buffer.from(cred, 'base64').toString());
      if (timingSafeEqual(recibido, esperado)) return next();
    }
    res
      .set('WWW-Authenticate', 'Basic realm="Visor de conversaciones", charset="UTF-8"')
      .status(401)
      .send('Autenticación requerida');
  });
}

const comoLike = (q) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PUERTO, (err) => {
  if (err) throw err;
  console.log(`Visor de conversaciones en http://localhost:${PUERTO}`);
});
