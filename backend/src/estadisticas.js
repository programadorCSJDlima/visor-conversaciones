import { pool } from './db.js';

// Periodos que ofrece el panel (días; 0 = todo el historial)
export const PERIODOS = [1, 7, 30, 90, 0];

const ZONA = 'America/Lima';
const DESPUES_DEL_DNI = [
  'ESPERANDO_ESPECIALIDADES', 'ESPERANDO_MEDICO', 'ESPERANDO_FECHA', 'ESPERANDO_HORA',
  'ESPERANDO_CONFIRMACION', 'CITA_SOLICITADA', 'CITA_REGISTRADA', 'VIENDO_CITAS',
  'PAGANDO', 'PAGO_PAGADA', 'PAGO_VENCIDA',
];
const ELIGIERON_HORARIO = ['ESPERANDO_CONFIRMACION', 'CITA_SOLICITADA', 'CITA_REGISTRADA'];
const TIPO_RESPUESTA = {
  text: 'Texto libre',
  button_reply: 'Botón',
  list_reply: 'Lista',
  flow_reply: 'Formulario',
};

// El bot confirma cada cita con un texto fijo ("Tu cita quedó registrada" + N°, especialidad, médico, precio)
const campo = (texto, re) => texto.match(re)?.[1]?.replace(/\*/g, '').trim() || null;

function leerConfirmaciones(filas) {
  const citas = new Map();
  for (const { telefono, texto, creado_en } of filas) {
    const numero = campo(texto, /N[°º]\s*de\s*cita:?\**\s*(\d+)/i);
    if (!numero || citas.has(numero)) continue;
    const precio = campo(texto, /Precio:?\**\s*S\/\s*([\d.,]+)/i);
    citas.set(numero, {
      telefono,
      creadoEn: creado_en,
      especialidad: campo(texto, /Especialidad:?\**\s*([^\n]+)/i) ?? 'Sin dato',
      medico: campo(texto, /M[ée]dico:?\**\s*([^\n]+)/i) ?? 'Sin dato',
      precio: precio ? Number(precio.replace(',', '')) : 0,
    });
  }
  return [...citas.values()];
}

async function citasRegistradas(desde, hasta) {
  const { rows } = await pool.query(
    `select telefono, texto, creado_en from chatbot_mensajes
     where direccion = 'OUT' and texto ilike '%cita quedó registrada%'
       and creado_en >= $1 and creado_en <= $2`,
    [desde, hasta],
  );
  return leerConfirmaciones(rows);
}

async function kpis(desde, hasta) {
  const [mensajes, respuesta, citas, pagos] = await Promise.all([
    pool.query(
      `select count(distinct telefono)::int as conversaciones,
              count(*) filter (where direccion = 'IN')::int as entrantes,
              count(*) filter (where direccion = 'OUT')::int as salientes,
              count(*) filter (where estado = 'ERROR')::int as errores
       from chatbot_mensajes where creado_en >= $1 and creado_en <= $2`,
      [desde, hasta],
    ),
    // Segundos entre cada mensaje del usuario y la siguiente respuesta del bot
    pool.query(
      `select percentile_cont(0.5) within group (order by seg) as p50,
              percentile_cont(0.95) within group (order by seg) as p95
       from (
         select extract(epoch from r.creado_en - m.creado_en) as seg
         from chatbot_mensajes m
         cross join lateral (
           select o.creado_en from chatbot_mensajes o
           where o.telefono = m.telefono and o.direccion = 'OUT' and o.creado_en >= m.creado_en
           order by o.creado_en limit 1
         ) r
         where m.direccion = 'IN' and m.creado_en >= $1 and m.creado_en <= $2
       ) t`,
      [desde, hasta],
    ),
    citasRegistradas(desde, hasta),
    pool.query(
      `select count(*)::int as links,
              count(*) filter (where o.estado = 'PAGADA')::int as pagadas,
              count(*) filter (where o.estado = 'VENCIDA')::int as vencidas,
              coalesce(sum(o.monto) filter (where o.estado = 'PAGADA'), 0)::float as recaudado,
              coalesce(sum(c.prefacturas), 0)::int as prefacturas,
              coalesce(sum(c.facturas), 0)::int as facturas,
              coalesce(sum(c.citas) filter (where o.estado = 'PAGADA'), 0)::int as citas_pagadas
       from orden_pago o
       left join (
         select external_id, count(*) as citas,
                count(*) filter (where prefactura_generada) as prefacturas,
                count(*) filter (where numero_factura is not null) as facturas
         from orden_pago_cita group by external_id
       ) c using (external_id)
       where o.creado_en >= $1 and o.creado_en <= $2`,
      [desde, hasta],
    ),
  ]);

  const m = mensajes.rows[0];
  const p = pagos.rows[0];
  return {
    ...m,
    citas: citas.length,
    conversacionesConCita: new Set(citas.map((c) => c.telefono)).size,
    valorCitas: citas.reduce((s, c) => s + c.precio, 0),
    respuestaP50: respuesta.rows[0].p50,
    respuestaP95: respuesta.rows[0].p95,
    pagos: {
      links: p.links,
      pagadas: p.pagadas,
      vencidas: p.vencidas,
      pendientes: p.links - p.pagadas - p.vencidas,
      recaudado: p.recaudado,
      citasPagadas: p.citas_pagadas,
      prefacturas: p.prefacturas,
      facturas: p.facturas,
    },
  };
}

function contar(items, clave, limite) {
  const conteo = new Map();
  for (const it of items) conteo.set(it[clave], (conteo.get(it[clave]) ?? 0) + 1);
  return [...conteo]
    .map(([nombre, n]) => ({ nombre, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, limite);
}

export async function estadisticas(dias) {
  // Hoy se agrupa por hora; el resto, por día (siempre en hora de Lima)
  const tramo = dias === 1 ? 'hour' : 'day';
  const { rows: [r] } = await pool.query(
    `with base as (
       select now() as ahora,
              case when $1::int > 0
                then (date_trunc('day', now() at time zone '${ZONA}') - make_interval(days => $1::int - 1)) at time zone '${ZONA}'
              end as desde
     )
     select ahora as hasta, desde,
            desde - make_interval(days => $1::int) as desde_previo,
            ahora - make_interval(days => $1::int) as hasta_previo,
            coalesce(desde, (select min(creado_en) from chatbot_mensajes), ahora) as inicio_serie
     from base`,
    [dias],
  );
  const desde = r.desde ?? new Date(0);
  const { hasta } = r;

  const [actual, previo, serie, citas, embudo, respuestas, calor, botones, estados, errores] = await Promise.all([
    kpis(desde, hasta),
    r.desde ? kpis(r.desde_previo, r.hasta_previo) : null,
    pool.query(
      `with tramos as (
         select generate_series(
                  date_trunc($3, $1::timestamptz at time zone '${ZONA}'),
                  date_trunc($3, $2::timestamptz at time zone '${ZONA}'),
                  ('1 ' || $3)::interval) as t
       )
       select to_char(t.t, 'YYYY-MM-DD"T"HH24') as t,
              count(distinct m.telefono)::int as conversaciones,
              count(m.id) filter (where m.direccion = 'IN')::int as entrantes,
              count(m.id) filter (where m.direccion = 'OUT')::int as salientes
       from tramos t
       left join chatbot_mensajes m
         on m.creado_en >= t.t at time zone '${ZONA}'
        and m.creado_en < (t.t + ('1 ' || $3)::interval) at time zone '${ZONA}'
       group by t.t order by t.t`,
      [r.inicio_serie, hasta, tramo],
    ),
    citasRegistradas(desde, hasta),
    pool.query(
      `select count(distinct telefono)::int as iniciaron,
              count(distinct telefono) filter (where paso = any($3))::int as identificados,
              count(distinct telefono) filter (where paso = any($4))::int as eligieron,
              count(distinct telefono) filter (where paso = 'CITA_REGISTRADA')::int as registraron,
              count(distinct telefono) filter (where paso = 'PAGO_PAGADA')::int as pagaron
       from chatbot_mensajes where creado_en >= $1 and creado_en <= $2`,
      [desde, hasta, DESPUES_DEL_DNI, ELIGIERON_HORARIO],
    ),
    pool.query(
      `select tipo, count(*)::int as n from chatbot_mensajes
       where direccion = 'IN' and creado_en >= $1 and creado_en <= $2
       group by tipo order by n desc`,
      [desde, hasta],
    ),
    pool.query(
      `select extract(isodow from creado_en at time zone '${ZONA}')::int as dia,
              extract(hour from creado_en at time zone '${ZONA}')::int as hora,
              count(*)::int as n
       from chatbot_mensajes
       where direccion = 'IN' and creado_en >= $1 and creado_en <= $2
       group by 1, 2`,
      [desde, hasta],
    ),
    pool.query(
      `select payload #>> '{messages,0,interactive,button_reply,id}' as id,
              mode() within group (order by texto) as titulo,
              count(*)::int as n
       from chatbot_mensajes
       where tipo = 'button_reply' and creado_en >= $1 and creado_en <= $2
       group by 1 order by n desc limit 8`,
      [desde, hasta],
    ),
    pool.query(
      `select paso, count(*)::int as n from chatbot_conversaciones
       where actualizado_en >= $1 and actualizado_en <= $2
       group by paso order by n desc`,
      [desde, hasta],
    ),
    pool.query(
      `select id, telefono, tipo, creado_en, error from chatbot_mensajes
       where estado = 'ERROR' and creado_en >= $1 and creado_en <= $2
       order by id desc limit 8`,
      [desde, hasta],
    ),
  ]);

  // Citas por tramo de la serie, para el detalle del gráfico diario
  const fmtTramo = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  });
  const claveTramo = (f) => {
    const p = Object.fromEntries(fmtTramo.formatToParts(f).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${tramo === 'hour' ? p.hour : '00'}`;
  };
  const citasPorTramo = contar(citas.map((c) => ({ t: claveTramo(c.creadoEn) })), 't', Infinity);
  const citasEn = Object.fromEntries(citasPorTramo.map((c) => [c.nombre, c.n]));

  // Orden fijo de categorías: cada tipo conserva su color aunque cambie el periodo
  const porTipo = new Map([...new Set([...Object.values(TIPO_RESPUESTA), 'Otro'])].map((t) => [t, 0]));
  for (const x of respuestas.rows) {
    const tipo = TIPO_RESPUESTA[x.tipo] ?? 'Otro';
    porTipo.set(tipo, porTipo.get(tipo) + x.n);
  }

  const e = embudo.rows[0];
  return {
    periodo: { dias, tramo, desde: r.desde, hasta },
    kpis: actual,
    previo,
    serie: serie.rows.map((s) => ({ ...s, citas: citasEn[s.t] ?? 0 })),
    embudo: [
      { etapa: 'Iniciaron una conversación', n: e.iniciaron },
      { etapa: 'Se identificaron con su documento', n: e.identificados },
      { etapa: 'Eligieron fecha y hora', n: e.eligieron },
      { etapa: 'Registraron una cita', n: e.registraron },
      { etapa: 'Pagaron en línea', n: e.pagaron },
    ],
    respuestas: [...porTipo].map(([tipo, n]) => ({ tipo, n })),
    calor: calor.rows,
    especialidades: contar(citas, 'especialidad', 8),
    medicos: contar(citas, 'medico', 8),
    botones: botones.rows,
    estados: estados.rows,
    errores: errores.rows.map((x) => {
      let mensaje = x.error;
      try {
        mensaje = JSON.parse(x.error).message ?? x.error;
      } catch {
        // el error no siempre es JSON
      }
      return { id: x.id, telefono: x.telefono, tipo: x.tipo, creadoEn: x.creado_en, error: mensaje };
    }),
  };
}
