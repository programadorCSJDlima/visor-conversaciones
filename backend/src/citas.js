import {
  leerConfirmacion,
  leerLinkPago,
  leerRevision,
  PATRON_CONFIRMACION,
  PATRON_LINK_PAGO,
  PATRON_REVISION,
} from './confirmaciones.js';
import { pool } from './db.js';
import { anulacionesDeCitas, consultarDocumentos, fichasDePacientes, lolimsaConfigurado } from './lolimsa.js';

const ZONA = 'America/Lima';
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }); // yyyy-mm-dd

// Origen de cada cita de la lista
//   CHATBOT    el bot la agendó ("Tu cita quedó registrada")
//   PAGO_LINK  se reservó en otro canal (ventanilla, teléfono) y el paciente la pagó con un link del chatbot
const CHATBOT = 'CHATBOT';
const PAGO_LINK = 'PAGO_LINK';
// Órdenes que cuentan como pago con link: las vencidas son intentos sin pagar
const ORDENES_PAGADAS = ['PAGADA', 'REVISAR'];
const MAX_DOCUMENTOS_POR_PAGO = 3;

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

// Para una cita pagada con link no hay "Revisa tu cita": primero los documentos que el paciente escribió justo
// antes de pedir el link y luego el guardado por el bot. Se queda el que tenga la cita en Lolimsa.
function documentosDePago(datos, mensajesEntrantes, conversacion) {
  const propio = conversacion?.replace(/\D/g, '');
  const docs = documentosCandidatos(null, mensajesEntrantes).filter((d) => d !== propio);
  for (const d of [datos?.documento, datos?.paciente?.numeroDocumento]) if (d && !docs.includes(d)) docs.push(d);
  return docs.slice(0, MAX_DOCUMENTOS_POR_PAGO);
}

// Algunos pacientes tienen en Lolimsa como teléfono el identificador de WhatsApp de la conversación
// ("PE.1151…" guardado como 1151…), que no sirve para llamar: se descarta igual que cualquier valor
// con una cantidad de dígitos que no corresponde a un teléfono.
function telefonoUtil(valor, conversacion) {
  const digitos = valor?.replace(/\D/g, '') ?? '';
  if (digitos.length < 6 || digitos.length > 12) return null;
  if (conversacion && digitos === conversacion.replace(/\D/g, '')) return null;
  return valor.trim();
}

function nombreCompleto(paciente) {
  return [paciente?.nombres, paciente?.apellidoPaterno, paciente?.apellidoMaterno].filter(Boolean).join(' ') || null;
}

// Paciente de la cita con lo que guardó el bot en la conversación (solo si es el mismo documento)
function pacienteDe({ datos, documento, revision, telefono }) {
  const mismo = Boolean(documento) && datos?.paciente?.numeroDocumento === documento;
  return {
    nombre: (mismo && nombreCompleto(datos.paciente)) || revision?.nombre || null,
    tipoDocumento: revision?.tipoDocumento ?? (mismo ? datos.tipo_documento : null) ?? null,
    documento,
    historia: mismo ? datos.paciente.historia : null,
    // Número de WhatsApp de la conversación (los usuarios "PE.…" tienen el número oculto por WhatsApp)
    telefono: /^\d{6,15}$/.test(telefono ?? '') ? telefono : null,
    telefonoRegistrado: mismo ? telefonoUtil(datos.paciente.telefono, telefono) : null,
  };
}

// Pago con el link del bot: si alguna orden se pagó, esa; si no, la más reciente
function pagoConLink(ordenes) {
  if (!ordenes?.length) return { estado: 'SIN_LINK', links: 0 };
  const o = ordenes.find((x) => x.estado === 'PAGADA') ?? ordenes.at(-1);
  return {
    estado: o.estado,
    links: ordenes.length,
    monto: o.monto != null ? Number(o.monto) : null,
    pagadoEn: o.pagado_en,
    venceEn: o.vence_en,
    // Con este id la tesorería ubica el pago en el portal de Niubiz ("External Id de Orden")
    externalId: o.external_id,
    prefactura: o.numero_prefactura,
    factura: o.numero_factura,
  };
}

// Cobro en caja según Lolimsa. citas.stapag_caj ("pagada") lo marca también api_csjd apenas Niubiz confirma un
// pago con link, antes de que caja emita la boleta: lo que confirma el cobro en caja es el comprobante (boleta o
// factura) de la prefactura de la cita.
//   COMPROBANTE        caja ya emitió boleta o factura
//   FALTA_COMPROBANTE  marcada pagada, pero su prefactura aún no tiene boleta (típico de los pagos con link)
//   POR_PAGAR          sin marca de pagada ni comprobante
//   MARCADA            marcada pagada; api_csjd no informó comprobantes (versión anterior o error al consultarlos)
function cobroEnCaja({ pagada, comprobantes }) {
  if (comprobantes?.length) return 'COMPROBANTE';
  if (!pagada) return 'POR_PAGAR';
  return Array.isArray(comprobantes) ? 'FALTA_COMPROBANTE' : 'MARCADA';
}

function estadoFinal(pago, lolimsa) {
  if (lolimsa?.consultada && !lolimsa.existe) return 'ANULADA';
  if (lolimsa?.atendida) return 'ATENDIDA';
  if (pago.estado === 'PAGADA' || lolimsa?.pagada || lolimsa?.cobro === 'COMPROBANTE') return 'PAGADA';
  return 'PENDIENTE';
}

/**
 * Citas que el bot no agendó pero que el paciente pagó con un link del chatbot en el período (flujo
 * "Pagar mis citas"). La conversación se ubica por el mensaje del link pagado.
 * @param agendadas números de las citas que el bot agendó en el período
 */
async function pagadasConLinkSinAgendar(desde, hasta, agendadas) {
  // El período se cuenta desde el primer link pagado de la cita
  const { rows: pagos } = await pool.query(
    `select c.numero_cita::text as numero, min(o.creado_en) as link_en
     from orden_pago_cita c join orden_pago o using (external_id)
     where o.estado = any($3)
     group by c.numero_cita
     having min(o.creado_en) >= $1 and min(o.creado_en) < coalesce($2::timestamptz, 'infinity')`,
    [desde, hasta, ORDENES_PAGADAS],
  );
  const sueltas = pagos.filter((p) => !agendadas.has(p.numero));
  if (!sueltas.length) return [];

  // Los números son solo dígitos: se pueden unir en una expresión regular sin escaparlos
  const numeros = sueltas.map((p) => p.numero).join('|');
  const [anteriores, links] = await Promise.all([
    pool.query(`select texto from chatbot_mensajes where direccion = 'OUT' and texto ilike $1 and texto ~ $2`, [
      PATRON_CONFIRMACION,
      numeros,
    ]),
    pool.query(
      `select id, telefono, texto, creado_en from chatbot_mensajes
       where direccion = 'OUT' and texto ilike $1 and texto ~ $2
       order by id`,
      [PATRON_LINK_PAGO, numeros],
    ),
  ]);
  // Agendadas por el bot antes del período: no son de otro canal, solo quedan fuera del período elegido
  const agendadasAntes = new Set(anteriores.rows.map((m) => leerConfirmacion(m.texto)?.numero).filter(Boolean));

  return sueltas
    .filter((p) => !agendadasAntes.has(p.numero))
    .map((p) => {
      // El mensaje del link pagado es el que salió más cerca de la creación de su orden
      const cerca = (m) => Math.abs(m.creado_en - p.link_en);
      const mensaje = links.rows
        .filter((m) => leerLinkPago(m.texto).includes(p.numero))
        .sort((a, b) => cerca(a) - cerca(b))[0];
      return {
        id: mensaje?.id ?? null,
        telefono: mensaje?.telefono ?? null,
        creado_en: p.link_en,
        datos: { numero: p.numero },
        origen: PAGO_LINK,
      };
    });
}

/**
 * @param periodo { dias } (los últimos n días; 0 = todo el historial) o { desde, hasta } (yyyy-mm-dd, días de
 *                Lima, ambos incluidos), igual que el panel. Cuenta la fecha en que el bot agendó la cita.
 */
export async function citasAgendadas({ dias = 0, desde: desdeDia = null, hasta: hastaDia = null }, { fresco = false } = {}) {
  const { rows: [r] } = await pool.query(
    `with dias as (
       select coalesce($1::date, case when $3::int > 0 then (now() at time zone '${ZONA}')::date - ($3::int - 1) end) as desde_dia,
              $2::date as hasta_dia
     )
     select to_char(desde_dia, 'YYYY-MM-DD') as desde_dia, to_char(hasta_dia, 'YYYY-MM-DD') as hasta_dia,
            desde_dia::timestamp at time zone '${ZONA}' as desde,
            -- Hasta el final del último día (sin límite en los periodos de "últimos n días")
            (hasta_dia + 1)::timestamp at time zone '${ZONA}' as hasta
     from dias`,
    [desdeDia, hastaDia, dias],
  );
  const desde = r.desde ?? new Date(0);
  const { hasta } = r;

  const { rows: confirmaciones } = await pool.query(
    `select id, telefono, texto, creado_en from chatbot_mensajes
     where direccion = 'OUT' and texto ilike $3 and creado_en >= $1 and creado_en < coalesce($2::timestamptz, 'infinity')
     order by id`,
    [desde, hasta, PATRON_CONFIRMACION],
  );

  // Una cita por número (si el bot reenvió la confirmación, vale la primera)
  const porNumero = new Map();
  for (const c of confirmaciones) {
    const datos = leerConfirmacion(c.texto);
    if (datos && !porNumero.has(datos.numero)) porNumero.set(datos.numero, { ...c, datos, origen: CHATBOT });
  }
  const citas = [...porNumero.values(), ...(await pagadasConLinkSinAgendar(desde, hasta, porNumero))].sort(
    (a, b) => a.creado_en - b.creado_en,
  );
  const telefonos = [...new Set(citas.map((c) => c.telefono).filter(Boolean))];
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
      `select c.numero_cita::text as numero, c.numero_prefactura, c.numero_factura, c.monto,
              o.external_id, o.estado, o.creado_en, o.vence_en, o.pagado_en
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

  // Paciente de cada cita: lo que el bot mostró justo antes de confirmarla. Las pagadas con link quedan con sus
  // documentos candidatos hasta consultar Lolimsa.
  for (const c of citas) {
    const previos = (hilos.get(c.telefono) ?? []).filter((m) => c.id != null && Number(m.id) < Number(c.id));
    const entrantes = previos.filter((m) => m.direccion === 'IN');
    const datos = datosDe.get(c.telefono);
    if (c.origen === PAGO_LINK) {
      c.documentos = documentosDePago(datos, entrantes, c.telefono);
      continue;
    }
    const revision = previos.filter((m) => m.direccion === 'OUT').map((m) => leerRevision(m.texto ?? '')).filter(Boolean).at(-1);
    const documento = elegirDocumento(documentosCandidatos(datos, entrantes), revision);
    c.paciente = pacienteDe({ datos, documento, revision, telefono: c.telefono });
  }

  // Lolimsa: una consulta por documento, desde el primer día en que se le agendó (o pagó con link) una cita
  const desdePorDoc = new Map();
  for (const c of citas) {
    const dia = fmtDia.format(c.creado_en);
    for (const documento of c.documentos ?? [c.paciente.documento]) {
      if (!documento) continue;
      const previo = desdePorDoc.get(documento);
      if (!previo || dia < previo) desdePorDoc.set(documento, dia);
    }
  }
  // Sin número de WhatsApp ni teléfono en la conversación, se busca el registrado en Lolimsa
  const sinTelefono = [
    ...new Set(
      citas
        .filter((c) => c.paciente && !c.paciente.telefono && !c.paciente.telefonoRegistrado && c.paciente.documento)
        .map((c) => c.paciente.documento),
    ),
  ];
  const [respuestas, fichas] = lolimsaConfigurado
    ? await Promise.all([
        consultarDocumentos([...desdePorDoc].map(([documento, d]) => ({ documento, desde: d })), { fresco }),
        fichasDePacientes(sinTelefono),
      ])
    : [new Map(), new Map()];

  // Pagadas con link: el paciente es el documento que tiene la cita en Lolimsa; si ninguno la tiene (anulada o
  // no se pudo consultar), el último que escribió en la conversación
  const pagadas = citas.filter((c) => c.origen === PAGO_LINK);
  for (const c of pagadas) {
    const tieneLaCita = (d) => respuestas.get(d)?.citas?.some((x) => String(x.numeroCita) === c.datos.numero);
    const documento = c.documentos.find(tieneLaCita) ?? c.documentos[0] ?? null;
    c.paciente = pacienteDe({ datos: datosDe.get(c.telefono), documento, telefono: c.telefono });
  }
  // Sin "Revisa tu cita" el nombre (y a veces el teléfono) sale de la ficha de Lolimsa
  const faltan = [
    ...new Set(
      pagadas
        .filter((c) => c.paciente.documento && (!c.paciente.nombre || (!c.paciente.telefono && !c.paciente.telefonoRegistrado)))
        .map((c) => c.paciente.documento)
        .filter((d) => !fichas.has(d)),
    ),
  ];
  if (lolimsaConfigurado && faltan.length) for (const [d, f] of await fichasDePacientes(faltan)) fichas.set(d, f);
  for (const c of pagadas) {
    const ficha = fichas.get(c.paciente.documento);
    c.paciente.nombre ??= ficha?.nombre ?? null;
    c.paciente.tipoDocumento ??= ficha?.tipoDocumento ?? null;
  }

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
            prefactura: enLolimsa.prefactura ?? null,
            // null: api_csjd no los informó; [] : la prefactura aún no tiene boleta
            comprobantes: enLolimsa.comprobantes ?? null,
            cobro: cobroEnCaja(enLolimsa),
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
      origen: c.origen,
      // Pagadas con link: cuándo se generó su primer link pagado
      agendadaEn: c.creado_en,
      telefono: c.telefono,
      paciente: {
        ...c.paciente,
        historia: lolimsa.historia ?? c.paciente.historia,
        telefonoRegistrado:
          c.paciente.telefonoRegistrado ?? telefonoUtil(fichas.get(c.paciente.documento)?.telefono, c.telefono),
      },
      cita: {
        especialidad: lolimsa.servicio ?? c.datos.especialidad ?? null,
        medico: lolimsa.medico ?? c.datos.medico ?? null,
        consultorio: lolimsa.consultorio ?? c.datos.consultorio ?? null,
        // De Lolimsa llega como fecha ISO y hora HH:mm; si no, el texto que envió el bot
        fecha: lolimsa.fecha ?? null,
        hora: lolimsa.hora ?? null,
        fechaTexto: c.datos.fecha ?? null,
        horaTexto: c.datos.hora ?? null,
        precio: lolimsa.precio ?? c.datos.precio ?? pago.monto ?? null,
      },
      pago,
      lolimsa,
      estado: estadoFinal(pago, lolimsa),
    };
  });

  // Quién anuló las que ya no están en Lolimsa
  const anuladas = filas.filter((f) => f.estado === 'ANULADA');
  if (anuladas.length) {
    const anulaciones = await anulacionesDeCitas(anuladas.map((f) => f.numero));
    for (const f of anuladas) f.lolimsa.anulacion = anulaciones.get(f.numero) ?? null;
  }

  const consultadas = [...respuestas.values()];
  return {
    periodo: { dias: r.hasta_dia ? null : dias, desde: r.desde, desdeDia: r.desde_dia, hastaDia: r.hasta_dia },
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
