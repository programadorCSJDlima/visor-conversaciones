import { leerConfirmacion, leerRevision, PATRON_CONFIRMACION, PATRON_REVISION } from './confirmaciones.js';
import { pool } from './db.js';
import { consultarDocumentos, lolimsaConfigurado } from './lolimsa.js';

const ZONA = 'America/Lima';
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }); // yyyy-mm-dd

// Documentos que el paciente pudo usar en la conversación: el guardado por el bot y los que escribió o
// envió en formularios. El correcto es el que termina en los dígitos que muestra "Revisa tu cita".
function documentosCandidatos(datos, mensajesEntrantes) {
  const docs = [];
  const agregar = (d) => d && !docs.includes(d) && docs.push(d);
  agregar(datos?.documento);
  agregar(datos?.paciente?.numeroDocumento);
  for (const m of [...mensajesEntrantes].reverse()) {
    for (const texto of [m.texto ?? '', JSON.stringify(m.interactivo ?? '')]) {
      for (const [, d] of texto.matchAll(/\b(\d{8,12})\b/g)) agregar(d);
    }
  }
  return docs;
}

function elegirDocumento(candidatos, revision) {
  if (revision?.finDocumento) return candidatos.find((d) => d.endsWith(revision.finDocumento)) ?? null;
  return candidatos.length === 1 ? candidatos[0] : null;
}

function nombreCompleto(paciente) {
  return [paciente?.nombres, paciente?.apellidoPaterno, paciente?.apellidoMaterno].filter(Boolean).join(' ') || null;
}

// Pago con el link del bot: si alguna orden se pagó, esa; si no, la más reciente
function pagoConLink(ordenes) {
  if (!ordenes?.length) return { estado: 'SIN_LINK', links: 0 };
  const o = ordenes.find((x) => x.estado === 'PAGADA') ?? ordenes.at(-1);
  return {
    estado: o.estado,
    links: ordenes.length,
    pagadoEn: o.pagado_en,
    venceEn: o.vence_en,
    prefactura: o.numero_prefactura,
    factura: o.numero_factura,
  };
}

function estadoFinal(pago, lolimsa) {
  if (lolimsa?.consultada && !lolimsa.existe) return 'ANULADA';
  if (lolimsa?.atendida) return 'ATENDIDA';
  if (pago.estado === 'PAGADA' || lolimsa?.pagada) return 'PAGADA';
  return 'PENDIENTE';
}

export async function citasAgendadas(dias, { fresco = false } = {}) {
  const { rows: [r] } = await pool.query(
    `select case when $1::int > 0
       then (date_trunc('day', now() at time zone '${ZONA}') - make_interval(days => $1::int - 1)) at time zone '${ZONA}'
     end as desde`,
    [dias],
  );

  const { rows: confirmaciones } = await pool.query(
    `select id, telefono, texto, creado_en from chatbot_mensajes
     where direccion = 'OUT' and texto ilike $2 and creado_en >= $1
     order by id`,
    [r.desde ?? new Date(0), PATRON_CONFIRMACION],
  );

  // Una cita por número (si el bot reenvió la confirmación, vale la primera)
  const porNumero = new Map();
  for (const c of confirmaciones) {
    const datos = leerConfirmacion(c.texto);
    if (datos && !porNumero.has(datos.numero)) porNumero.set(datos.numero, { ...c, datos });
  }
  const citas = [...porNumero.values()];
  const telefonos = [...new Set(citas.map((c) => c.telefono))];
  const numeros = citas.map((c) => c.datos.numero);

  const [contexto, conversaciones, ordenes] = await Promise.all([
    pool.query(
      `select id, telefono, direccion, texto, payload #> '{messages,0,interactive}' as interactivo
       from chatbot_mensajes
       where telefono = any($1) and (direccion = 'IN' or texto ilike $2)
       order by id`,
      [telefonos, PATRON_REVISION],
    ),
    pool.query(`select telefono, datos from chatbot_conversaciones where telefono = any($1)`, [telefonos]),
    pool.query(
      `select c.numero_cita::text as numero, c.numero_prefactura, c.numero_factura,
              o.estado, o.creado_en, o.vence_en, o.pagado_en
       from orden_pago_cita c join orden_pago o using (external_id)
       where c.numero_cita = any($1::bigint[])
       order by o.creado_en`,
      [numeros],
    ),
  ]);

  const hilos = new Map();
  for (const m of contexto.rows) {
    if (!hilos.has(m.telefono)) hilos.set(m.telefono, []);
    hilos.get(m.telefono).push(m);
  }
  const datosDe = new Map(conversaciones.rows.map((c) => [c.telefono, c.datos]));
  const ordenesDe = new Map();
  for (const o of ordenes.rows) {
    if (!ordenesDe.has(o.numero)) ordenesDe.set(o.numero, []);
    ordenesDe.get(o.numero).push(o);
  }

  // Paciente de cada cita: lo que el bot mostró justo antes de confirmarla
  for (const c of citas) {
    const previos = (hilos.get(c.telefono) ?? []).filter((m) => Number(m.id) < Number(c.id));
    const revision = previos.filter((m) => m.direccion === 'OUT').map((m) => leerRevision(m.texto ?? '')).filter(Boolean).at(-1);
    const datos = datosDe.get(c.telefono);
    const documento = elegirDocumento(documentosCandidatos(datos, previos.filter((m) => m.direccion === 'IN')), revision);
    c.paciente = {
      nombre: (datos?.paciente?.numeroDocumento === documento && nombreCompleto(datos.paciente)) || revision?.nombre || null,
      tipoDocumento: revision?.tipoDocumento ?? datos?.tipo_documento ?? null,
      documento,
      historia: datos?.paciente?.numeroDocumento === documento ? datos.paciente.historia : null,
    };
  }

  // Lolimsa: una consulta por documento, desde el primer día en que se le agendó una cita
  const desdePorDoc = new Map();
  for (const c of citas) {
    if (!c.paciente.documento) continue;
    const dia = fmtDia.format(c.creado_en);
    const previo = desdePorDoc.get(c.paciente.documento);
    if (!previo || dia < previo) desdePorDoc.set(c.paciente.documento, dia);
  }
  const respuestas = lolimsaConfigurado
    ? await consultarDocumentos([...desdePorDoc].map(([documento, desde]) => ({ documento, desde })), { fresco })
    : new Map();

  const filas = citas.map((c) => {
    const respuesta = respuestas.get(c.paciente.documento);
    let lolimsa = { consultada: false, motivo: lolimsaConfigurado ? 'Sin documento del paciente' : 'Lolimsa no configurado' };
    if (respuesta?.error) lolimsa = { consultada: false, motivo: respuesta.error };
    else if (respuesta) {
      const enLolimsa = respuesta.citas.find((x) => String(x.numeroCita) === c.datos.numero);
      lolimsa = enLolimsa
        ? {
            consultada: true,
            existe: true,
            atendida: enLolimsa.atendida,
            pagada: enLolimsa.pagada,
            fecha: enLolimsa.fecha,
            hora: enLolimsa.hora,
            servicio: enLolimsa.servicio,
            medico: enLolimsa.medico,
            consultorio: enLolimsa.consultorio,
            historia: enLolimsa.historia,
            precio: enLolimsa.precio,
          }
        : { consultada: true, existe: false };
    }
    const pago = pagoConLink(ordenesDe.get(c.datos.numero));
    return {
      numero: c.datos.numero,
      agendadaEn: c.creado_en,
      telefono: c.telefono,
      paciente: { ...c.paciente, historia: lolimsa.historia ?? c.paciente.historia },
      cita: {
        especialidad: lolimsa.servicio ?? c.datos.especialidad,
        medico: lolimsa.medico ?? c.datos.medico,
        consultorio: lolimsa.consultorio ?? c.datos.consultorio,
        // De Lolimsa llega como fecha ISO y hora HH:mm; si no, el texto que envió el bot
        fecha: lolimsa.fecha ?? null,
        hora: lolimsa.hora ?? null,
        fechaTexto: c.datos.fecha,
        horaTexto: c.datos.hora,
        precio: lolimsa.precio ?? c.datos.precio,
      },
      pago,
      lolimsa,
      estado: estadoFinal(pago, lolimsa),
    };
  });

  const consultadas = [...respuestas.values()];
  return {
    periodo: { dias, desde: r.desde },
    lolimsa: {
      configurado: lolimsaConfigurado,
      consultadoEn: new Date(),
      documentos: consultadas.length,
      errores: consultadas.filter((x) => x.error).length,
      error: consultadas.find((x) => x.error)?.error ?? null,
    },
    citas: filas.reverse(),
  };
}
