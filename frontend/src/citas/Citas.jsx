import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { fechaHora, telefono as fmtTelefono } from '../formato.js';
import SelectorFechas, { fechaCorta, IconoCalendario, textoRango } from '../panel/SelectorFechas.jsx';
import '../panel/panel.css';
import './citas.css';

const PERIODOS = [
  { dias: 1, nombre: 'Hoy', descripcion: 'Agendadas hoy' },
  { dias: 7, nombre: '7 días', descripcion: 'Agendadas en los últimos 7 días' },
  { dias: 30, nombre: '30 días', descripcion: 'Agendadas en los últimos 30 días' },
  { dias: 90, nombre: '90 días', descripcion: 'Agendadas en los últimos 90 días' },
  { dias: 0, nombre: 'Todo', descripcion: 'Todo el historial' },
];
const REFRESCO_MS = 2 * 60 * 1000;

// Estado de cada cita, con ícono para no depender solo del color
const ESTADOS = {
  PENDIENTE: { nombre: 'Pendiente de pago', icono: '⏳', clase: 'aviso' },
  // Una cita atendida también puede estar pagada, pero se cuenta en Atendida
  PAGADA: { nombre: 'Pagada, por atender', icono: '✓', clase: 'bueno' },
  ATENDIDA: { nombre: 'Atendida', icono: '✓', clase: 'info' },
  ANULADA: { nombre: 'Anulada', icono: '✕', clase: 'critico' },
};
const FILTROS = ['PENDIENTE', 'PAGADA', 'ATENDIDA', 'ANULADA'];

const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const fmtFechaCita = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const fmtHoraLima = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: 'numeric', minute: '2-digit' });
const fmtDiaMes = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: 'numeric', month: 'short' });
const momento = (f) => `${fmtDiaMes.format(new Date(f)).replace('.', '')}, ${fmtHoraLima.format(new Date(f))}`;
// Fecha y hora de Lima sin zona horaria (como las devuelve api_csjd): se muestran tal cual
const fmtDiaMesSinZona = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const fmtHoraSinZona = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
const momentoLocal = (f) => {
  const d = new Date(`${f}Z`);
  return `${fmtDiaMesSinZona.format(d).replace('.', '')}, ${fmtHoraSinZona.format(d)}`;
};
const hoyLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());

// "ORTOPEDIA-TRAUMATOLOGIA" -> "Ortopedia-Traumatologia"
const titulo = (s) => (s ? s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep, l) => sep + l.toUpperCase()) : '');

function fechaCita(c) {
  if (c.fecha) return `${fmtFechaCita.format(new Date(`${c.fecha}T00:00:00Z`)).replace(/\./g, '')} · ${c.hora}`;
  return [c.fechaTexto, c.horaTexto].filter(Boolean).join(' · ') || '—';
}

function Insignia({ clase, icono, children, title }) {
  return (
    <span className={`insignia ${clase}`} title={title}>
      <span aria-hidden="true">{icono}</span> {children}
    </span>
  );
}

function PagoConLink({ pago }) {
  switch (pago.estado) {
    case 'PAGADA':
      return (
        <>
          <Insignia clase="bueno" icono="✓" title="Pago confirmado por Niubiz">
            Pagado
          </Insignia>
          <div className="tenue chico">{momento(pago.pagadoEn)}</div>
          {pago.externalId && (
            <div className="id-niubiz" title="External Id de la orden en el portal de Niubiz">
              {pago.externalId}
            </div>
          )}
        </>
      );
    case 'PENDIENTE':
      return (
        <>
          <Insignia clase="aviso" icono="⏳">
            Link activo
          </Insignia>
          <div className="tenue chico">Vence {fmtHoraLima.format(new Date(pago.venceEn))}</div>
        </>
      );
    case 'VENCIDA':
      return (
        <Insignia clase="neutro" icono="✕" title={`${pago.links} link(s) generado(s)`}>
          Link vencido
        </Insignia>
      );
    case 'REVISAR':
      return (
        <Insignia clase="aviso" icono="!">
          En revisión
        </Insignia>
      );
    default:
      return <span className="tenue">Sin link</span>;
  }
}

function EnLolimsa({ lolimsa, fecha }) {
  if (!lolimsa.consultada) {
    return (
      <Insignia clase="neutro" icono="?" title={lolimsa.motivo}>
        Sin consultar
      </Insignia>
    );
  }
  if (!lolimsa.existe) {
    const a = lolimsa.anulacion;
    return (
      <>
        <Insignia clase="critico" icono="✕" title="La cita ya no figura en Lolimsa">
          Anulada
        </Insignia>
        {a && (
          <div className="anulacion chico" title={a.ip ? `IP ${a.ip}` : undefined}>
            <div>
              por {a.nombre ? titulo(a.nombre) : a.usuario}
              {a.nombre && <span className="tenue"> ({a.usuario})</span>}
            </div>
            <div className="tenue">
              {a.fecha && momentoLocal(a.fecha)}
              {a.equipo && ` · ${a.equipo}`}
            </div>
          </div>
        )}
      </>
    );
  }
  const yaPaso = fecha && fecha < hoyLima();
  return (
    <>
      <div className="insignias">
        <CobroEnCaja lolimsa={lolimsa} />
        {lolimsa.atendida ? (
          <Insignia clase="info" icono="✓">
            Atendida
          </Insignia>
        ) : (
          yaPaso && (
            <Insignia clase="serio" icono="!">
              Sin atender
            </Insignia>
          )
        )}
      </div>
      {lolimsa.cobro === 'COMPROBANTE' &&
        lolimsa.comprobantes.map((b) => (
          <div
            key={`${b.tipo}-${b.serie}-${b.numero}`}
            className="comprobante chico"
            title={[
              b.usuario && `Emitida por ${b.usuario}`,
              b.total != null && soles.format(b.total),
              b.medioPago && `Medio de pago en caja: ${b.medioPago}`,
              !b.cobrado && 'Sin cobrar',
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {textoComprobante(b)}
            <span className="tenue">
              {b.fecha && ` · ${momentoLocal(b.fecha)}`}
              {b.caja && ` · caja ${b.caja}`}
            </span>
          </div>
        ))}
      {lolimsa.cobro === 'FALTA_COMPROBANTE' && lolimsa.prefactura && (
        <div className="comprobante tenue chico">Prefactura {lolimsa.prefactura}</div>
      )}
    </>
  );
}

const EMITIDO = { BO: 'Boleta emitida', FA: 'Factura emitida' };
const textoComprobante = (b) => `${b.tipo ?? ''} ${b.serie ? `${b.serie}-` : ''}${b.numero}`.trim();
const textoComprobantes = (l) => (l.comprobantes ?? []).map(textoComprobante).join(' / ');

// "Pagada" en Lolimsa (citas.stapag_caj) también lo marca api_csjd al confirmarse el pago con link:
// lo que confirma el cobro en caja es la boleta de la prefactura
function CobroEnCaja({ lolimsa }) {
  switch (lolimsa.cobro) {
    case 'COMPROBANTE': {
      const tipos = [...new Set(lolimsa.comprobantes.map((b) => b.tipo))];
      const nombre = tipos.length === 1 ? (EMITIDO[tipos[0]] ?? 'Comprobante emitido') : 'Comprobantes emitidos';
      return (
        <Insignia clase="bueno" icono="✓" title="Caja ya emitió el comprobante de la prefactura">
          {nombre}
        </Insignia>
      );
    }
    case 'FALTA_COMPROBANTE':
      return (
        <Insignia
          clase="aviso"
          icono="!"
          title="Figura como pagada en Lolimsa, pero caja aún no emite la boleta de su prefactura"
        >
          Falta boleta
        </Insignia>
      );
    case 'MARCADA':
      return (
        <Insignia clase="bueno" icono="✓" title="Marcada como pagada en Lolimsa (sin datos de la boleta)">
          Pagada
        </Insignia>
      );
    default:
      return (
        <Insignia clase="aviso" icono="⏳">
          Por pagar
        </Insignia>
      );
  }
}

// Pagada con link (Niubiz) pero su prefactura aún no tiene boleta en caja
const faltaBoleta = (c) => c.estado !== 'ANULADA' && c.pago.estado === 'PAGADA' && c.lolimsa.cobro === 'FALTA_COMPROBANTE';

// Reservada en otro canal (ventanilla, teléfono) y pagada con un link del chatbot
const fueraDelChatbot = (c) => c.origen === 'PAGO_LINK';
const AYUDA_FUERA = 'Se reservó por otro canal (ventanilla o teléfono) y el paciente la pagó con un link del chatbot';

// WhatsApp desde el que agendó; si WhatsApp lo oculta, el registrado en Lolimsa
function Telefono({ paciente }) {
  if (paciente.telefono) {
    return (
      <>
        <div className="telefono">{fmtTelefono(paciente.telefono)}</div>
        <div className="tenue chico">WhatsApp</div>
      </>
    );
  }
  if (paciente.telefonoRegistrado) {
    return (
      <>
        <div className="telefono">{paciente.telefonoRegistrado}</div>
        <div className="tenue chico" title="WhatsApp oculta el número de este usuario">
          Registrado en Lolimsa
        </div>
      </>
    );
  }
  return (
    <span className="tenue" title="WhatsApp oculta el número y no hay uno registrado en Lolimsa">
      No disponible
    </span>
  );
}

// Texto del periodo elegido, como en el panel ("Del 3 nov al 10 nov")
function descripcionPeriodo(periodo) {
  if (periodo.desde) {
    return periodo.desde === periodo.hasta
      ? `Agendadas el ${fechaCorta(periodo.desde)}`
      : `Agendadas del ${fechaCorta(periodo.desde)} al ${fechaCorta(periodo.hasta)}`;
  }
  return PERIODOS.find((p) => p.dias === periodo.dias)?.descripcion;
}

function descargarCsv(citas, periodo) {
  const columnas = [
    'Estado', 'N° cita', 'Origen', 'Agendada', 'Paciente', 'Tipo doc.', 'Documento', 'Historia', 'Teléfono WhatsApp',
    'Teléfono registrado (Lolimsa)', 'Especialidad', 'Médico',
    'Fecha cita', 'Hora', 'Consultorio', 'Precio', 'Pago con link', 'Pagado el', 'External Id Niubiz', 'En Lolimsa',
    'Marcada pagada en Lolimsa', 'Prefactura', 'Boleta en caja', 'Atendida', 'Anulada por', 'Usuario Lolimsa',
    'Fecha de anulación', 'Equipo de anulación', 'Conversación',
  ];
  const filas = citas.map((c) => [
    ESTADOS[c.estado].nombre,
    c.numero,
    fueraDelChatbot(c) ? 'Reservada fuera del chatbot, pagada con link' : 'Agendada por el chatbot',
    fueraDelChatbot(c) ? '' : fechaHora(c.agendadaEn),
    c.paciente.nombre ?? '',
    c.paciente.tipoDocumento ?? '',
    c.paciente.documento ?? '',
    c.paciente.historia ?? '',
    c.paciente.telefono ?? '',
    c.paciente.telefonoRegistrado ?? '',
    titulo(c.cita.especialidad),
    titulo(c.cita.medico),
    c.cita.fecha ?? c.cita.fechaTexto ?? '',
    c.cita.hora ?? c.cita.horaTexto ?? '',
    c.cita.consultorio ?? '',
    c.cita.precio ?? '',
    c.pago.estado,
    c.pago.pagadoEn ? fechaHora(c.pago.pagadoEn) : '',
    c.pago.externalId ?? '',
    !c.lolimsa.consultada ? 'Sin consultar' : c.lolimsa.existe ? 'Sí' : 'No (anulada)',
    c.lolimsa.existe ? (c.lolimsa.pagada ? 'Sí' : 'No') : '',
    c.lolimsa.prefactura ?? '',
    !c.lolimsa.existe
      ? ''
      : c.lolimsa.cobro === 'COMPROBANTE'
        ? textoComprobantes(c.lolimsa)
        : c.lolimsa.cobro === 'FALTA_COMPROBANTE'
          ? 'Falta boleta'
          : c.lolimsa.cobro === 'MARCADA'
            ? 'Sin dato'
            : 'Por pagar',
    c.lolimsa.existe ? (c.lolimsa.atendida ? 'Sí' : 'No') : '',
    c.lolimsa.anulacion?.nombre ?? '',
    c.lolimsa.anulacion?.usuario ?? '',
    c.lolimsa.anulacion?.fecha?.replace('T', ' ') ?? '',
    c.lolimsa.anulacion?.equipo ?? '',
    c.telefono ?? '',
  ]);
  const celda = (v) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columnas, ...filas].map((f) => f.map(celda).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = periodo.desde
    ? `citas-chatbot-${periodo.desde}${periodo.hasta !== periodo.desde ? `_al_${periodo.hasta}` : ''}.csv`
    : `citas-chatbot-${hoyLima()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- Orden por columna ---------- */

const ORDEN_ESTADO = { PENDIENTE: 0, PAGADA: 1, ATENDIDA: 2, ANULADA: 3 };
const ORDEN_PAGO = { PAGADA: 0, PENDIENTE: 1, REVISAR: 2, VENCIDA: 3, SIN_LINK: 4 };
// Por cobrar primero, luego las que esperan boleta, las cobradas en caja, atendidas, anuladas y sin consultar
const ORDEN_COBRO = { POR_PAGAR: 0, FALTA_COMPROBANTE: 1, MARCADA: 2, COMPROBANTE: 2 };
const ordenLolimsa = (l) => (!l.consultada ? 5 : !l.existe ? 4 : l.atendida ? 3 : (ORDEN_COBRO[l.cobro] ?? 0));

// valor: lo que se compara al ordenar por esa columna (null va siempre al final)
const COLUMNAS = [
  { id: 'estado', nombre: 'Estado', valor: (c) => ORDEN_ESTADO[c.estado] },
  {
    id: 'cita',
    nombre: 'Cita',
    ayuda: 'Ordenar por fecha en que se agendó (las reservadas fuera del chatbot, por la fecha de su link de pago)',
    valor: (c) => c.agendadaEn,
  },
  { id: 'paciente', nombre: 'Paciente', valor: (c) => c.paciente.nombre?.toLowerCase() ?? null },
  { id: 'telefono', nombre: 'Teléfono', valor: (c) => c.paciente.telefono ?? c.paciente.telefonoRegistrado ?? null },
  {
    id: 'atencion',
    nombre: 'Atención',
    ayuda: 'Ordenar por fecha de la cita',
    valor: (c) => (c.cita.fecha ? `${c.cita.fecha}T${c.cita.hora ?? ''}` : null),
  },
  { id: 'precio', nombre: 'Precio', num: true, valor: (c) => c.cita.precio },
  { id: 'pago', nombre: 'Pago con link', valor: (c) => ORDEN_PAGO[c.pago.estado] ?? 9 },
  { id: 'lolimsa', nombre: 'En Lolimsa', valor: (c) => ordenLolimsa(c.lolimsa) },
];

function comparar(a, b) {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'es');
}

function ordenar(lista, { columna, dir }) {
  const { valor } = COLUMNAS.find((c) => c.id === columna);
  const signo = dir === 'asc' ? 1 : -1;
  return [...lista].sort((x, y) => {
    const a = valor(x);
    const b = valor(y);
    if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
    return signo * comparar(a, b);
  });
}

/* ---------- Paginado ---------- */

const TAMANOS = [10, 25, 50, 100];
const CLAVE_TAMANO = 'visor.citas.porPagina';

function tamanoGuardado() {
  try {
    const guardado = localStorage.getItem(CLAVE_TAMANO);
    if (guardado === null) return 10;
    const n = Number(guardado);
    return TAMANOS.includes(n) || n === 0 ? n : 10;
  } catch {
    return 10;
  }
}

// Primera, última y las vecinas de la actual; "…" donde se saltan páginas
function numerosDePagina(actual, total) {
  const set = [...new Set([1, actual - 1, actual, actual + 1, total])].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  return set.flatMap((p, i) => (i && p - set[i - 1] > 1 ? ['…', p] : [p]));
}

function Paginacion({ pagina, totalPaginas, total, porPagina, onPagina, onPorPagina }) {
  const desde = porPagina ? (pagina - 1) * porPagina + 1 : 1;
  const hasta = porPagina ? Math.min(pagina * porPagina, total) : total;
  return (
    <div className="paginacion">
      <span className="tenue">
        Mostrando {desde}–{hasta} de {total}
      </span>
      <label className="tenue">
        Filas por página{' '}
        <select value={porPagina} onChange={(e) => onPorPagina(Number(e.target.value))}>
          {TAMANOS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={0}>Todas</option>
        </select>
      </label>
      {totalPaginas > 1 && (
        <nav className="paginas" aria-label="Páginas">
          <button onClick={() => onPagina(pagina - 1)} disabled={pagina === 1} aria-label="Página anterior">
            ‹
          </button>
          {numerosDePagina(pagina, totalPaginas).map((p, i) =>
            p === '…' ? (
              <span key={`s${i}`} className="tenue">
                …
              </span>
            ) : (
              <button key={p} onClick={() => onPagina(p)} aria-current={p === pagina ? 'page' : undefined}>
                {p}
              </button>
            ),
          )}
          <button onClick={() => onPagina(pagina + 1)} disabled={pagina === totalPaginas} aria-label="Página siguiente">
            ›
          </button>
        </nav>
      )}
    </div>
  );
}

export default function Citas() {
  // { dias } para los periodos fijos o { desde, hasta } (yyyy-mm-dd) para un rango personalizado, como en el panel
  const [periodo, setPeriodo] = useState({ dias: 30 });
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const cerrarSelector = useCallback(() => setSelectorAbierto(false), []);
  const clavePeriodo = periodo.desde ? `${periodo.desde}|${periodo.hasta}` : String(periodo.dias);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState('PENDIENTE');
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState({ columna: 'cita', dir: 'desc' });
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(tamanoGuardado);
  const tablaRef = useRef(null);
  const [recarga, setRecarga] = useState(0);
  // "Actualizar" pide a Lolimsa datos frescos; el refresco automático puede usar los de hace unos minutos
  const forzar = useRef(false);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      api
        .citas(periodo, forzar.current)
        .then((d) => {
          if (!vivo) return;
          setDatos(d);
          setError(null);
        })
        .catch((e) => vivo && setError(e.message))
        .finally(() => vivo && setCargando(false));

    setCargando(true);
    cargar();
    forzar.current = false;
    const t = setInterval(cargar, REFRESCO_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
    // clavePeriodo resume el periodo: solo se recarga si cambia el rango, no por un objeto nuevo igual
  }, [clavePeriodo, recarga]);

  const elegirPeriodo = (p) => {
    setPeriodo(p);
    setSelectorAbierto(false);
    setPagina(1);
  };

  const actualizar = useCallback(() => {
    forzar.current = true;
    setRecarga((n) => n + 1);
  }, []);

  const resumen = useMemo(() => {
    const r = Object.fromEntries(['VIGENTES', ...FILTROS].map((k) => [k, { n: 0, monto: 0 }]));
    for (const c of datos?.citas ?? []) {
      // Las anuladas no suman al total: solo se cuentan en su propio filtro
      for (const k of c.estado === 'ANULADA' ? [c.estado] : ['VIGENTES', c.estado]) {
        r[k].n += 1;
        r[k].monto += c.cita.precio ?? 0;
      }
    }
    return r;
  }, [datos]);

  // Todas las pagadas, también las ya atendidas: con link (como cuenta el Panel) o en caja (según Lolimsa)
  const pagos = useMemo(() => {
    const pagadas = (datos?.citas ?? []).filter(
      (c) => c.estado !== 'ANULADA' && (c.pago.estado === 'PAGADA' || c.lolimsa.pagada),
    );
    return {
      total: pagadas.length,
      conLink: pagadas.filter((c) => c.pago.estado === 'PAGADA').length,
      enCaja: pagadas.filter((c) => c.pago.estado !== 'PAGADA').length,
      atendidas: pagadas.filter((c) => c.estado === 'ATENDIDA').length,
      sinBoleta: pagadas.filter(faltaBoleta).length,
      fueraDelChatbot: pagadas.filter(fueraDelChatbot).length,
    };
  }, [datos]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const enFiltro = (c) => {
      if (filtro === 'VIGENTES') return c.estado !== 'ANULADA';
      if (filtro === 'SIN_BOLETA') return faltaBoleta(c);
      if (filtro === 'FUERA_CHATBOT') return c.estado !== 'ANULADA' && fueraDelChatbot(c);
      return c.estado === filtro;
    };
    const lista = (datos?.citas ?? []).filter(
      (c) =>
        enFiltro(c) &&
        (!q ||
          [
            c.numero,
            c.paciente.nombre,
            c.paciente.documento,
            c.paciente.historia,
            c.paciente.telefono,
            c.paciente.telefonoRegistrado,
            c.cita.especialidad,
            c.cita.medico,
            c.lolimsa.anulacion?.nombre,
            c.lolimsa.anulacion?.usuario,
            c.pago.externalId,
            c.lolimsa.prefactura,
            textoComprobantes(c.lolimsa),
          ]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))),
    );
    return ordenar(lista, orden);
  }, [datos, filtro, busqueda, orden]);

  // Al filtrar, buscar u ordenar se vuelve a la primera página
  const filtrar = (k) => {
    setFiltro(k);
    setPagina(1);
  };
  const buscar = (texto) => {
    setBusqueda(texto);
    setPagina(1);
  };
  const ordenarPor = (columna) => {
    setOrden((o) => ({ columna, dir: o.columna === columna && o.dir === 'asc' ? 'desc' : 'asc' }));
    setPagina(1);
  };
  const cambiarTamano = (n) => {
    setPorPagina(n);
    setPagina(1);
    try {
      localStorage.setItem(CLAVE_TAMANO, String(n));
    } catch {
      // sin almacenamiento local se usa el tamaño por defecto la próxima vez
    }
  };
  const irAPagina = (p) => {
    setPagina(p);
    tablaRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  // Si el refresco automático trae menos citas, la página actual no puede quedar fuera de rango
  const totalPaginas = porPagina ? Math.max(1, Math.ceil(visibles.length / porPagina)) : 1;
  const paginaActual = Math.min(pagina, totalPaginas);
  const enPagina = porPagina ? visibles.slice((paginaActual - 1) * porPagina, paginaActual * porPagina) : visibles;

  const lol = datos?.lolimsa;

  return (
    <div className="panel citas">
      <div className="panel-cabecera">
        <div>
          <h1>Citas agendadas</h1>
          <p className="tenue">
            Por el chatbot o pagadas con su link · {descripcionPeriodo(periodo)}
            {lol?.configurado && lol.documentos > 0 && ` · Lolimsa consultado a las ${fmtHoraLima.format(new Date(lol.consultadoEn))}`}
          </p>
        </div>
        <div className="filtro-periodo">
          <div
            className="periodos"
            role="group"
            aria-label="Agendadas en"
            title="Según la fecha en que el bot agendó la cita (las reservadas fuera del chatbot, según su link de pago)"
          >
            {PERIODOS.map((p) => (
              <button key={p.dias} aria-pressed={!periodo.desde && periodo.dias === p.dias} onClick={() => elegirPeriodo({ dias: p.dias })}>
                {p.nombre}
              </button>
            ))}
            <button
              className="boton-rango"
              aria-pressed={Boolean(periodo.desde)}
              aria-expanded={selectorAbierto}
              onClick={() => setSelectorAbierto((v) => !v)}
            >
              <IconoCalendario />
              {periodo.desde ? textoRango(periodo.desde, periodo.hasta) : 'Personalizado'}
            </button>
          </div>
          {selectorAbierto && (
            <SelectorFechas
              desde={periodo.desde}
              hasta={periodo.hasta}
              onCerrar={cerrarSelector}
              onAplicar={(desde, hasta) => elegirPeriodo({ desde, hasta })}
            />
          )}
        </div>
      </div>

      {error && <p className="aviso-error">No se pudieron cargar las citas: {error}</p>}
      {lol && !lol.configurado && (
        <p className="aviso-error">
          Falta configurar CSJD_API_URL en el backend: no se puede consultar el estado de las citas en Lolimsa.
        </p>
      )}
      {lol?.errores > 0 && (
        <p className="aviso-error">
          No se pudo consultar Lolimsa para {lol.errores} de {lol.documentos} pacientes: {lol.error}
        </p>
      )}

      {!datos && cargando && !error && (
        <div className="cargando-citas" role="status">
          <span className="girador" aria-hidden="true" />
          Consultando las citas en Lolimsa…
        </div>
      )}

      {datos && (
        <div className={`panel-cuerpo ${cargando ? 'recargando' : ''}`}>
          <section className="filtros-estado" aria-label="Filtrar por estado">
            {['VIGENTES', ...FILTROS].map((k) => (
              <button
                key={k}
                className={`filtro-estado ${k === 'VIGENTES' ? '' : ESTADOS[k].clase}`}
                aria-pressed={filtro === k}
                onClick={() => filtrar(k)}
                title={k === 'VIGENTES' ? 'Todas las citas menos las anuladas' : undefined}
              >
                <span className="filtro-nombre">
                  {k !== 'VIGENTES' && <span aria-hidden="true">{ESTADOS[k].icono} </span>}
                  {k === 'VIGENTES' ? 'Vigentes' : ESTADOS[k].nombre}
                </span>
                <span className="filtro-n">{resumen[k].n}</span>
                <span className="tenue chico">{soles.format(resumen[k].monto)}</span>
              </button>
            ))}
          </section>

          {pagos.total > 0 && (
            <p className="resumen-pagos">
              <span aria-hidden="true">✓</span> <strong>{pagos.total}</strong> pagadas en total:{' '}
              <span className="tenue">
                {pagos.conLink} con link · {pagos.enCaja} en caja · {pagos.atendidas} ya atendidas
              </span>
              {pagos.sinBoleta > 0 && (
                <button
                  className="filtro-sin-boleta"
                  aria-pressed={filtro === 'SIN_BOLETA'}
                  onClick={() => filtrar(filtro === 'SIN_BOLETA' ? 'VIGENTES' : 'SIN_BOLETA')}
                  title="Pagadas con link cuya prefactura aún no tiene boleta en caja. Clic para ver solo esas."
                >
                  <span aria-hidden="true">!</span> {pagos.sinBoleta} con link sin boleta en caja
                </button>
              )}
              {pagos.fueraDelChatbot > 0 && (
                <button
                  className="filtro-sin-boleta fuera-chatbot"
                  aria-pressed={filtro === 'FUERA_CHATBOT'}
                  onClick={() => filtrar(filtro === 'FUERA_CHATBOT' ? 'VIGENTES' : 'FUERA_CHATBOT')}
                  title={`${AYUDA_FUERA}. Clic para ver solo esas.`}
                >
                  {pagos.fueraDelChatbot} reservadas fuera del chatbot
                </button>
              )}
            </p>
          )}

          <div className="tarjeta" ref={tablaRef}>
            <div className="barra-herramientas">
              <input
                type="search"
                placeholder="Buscar paciente, documento, teléfono, N° de cita, especialidad o médico…"
                value={busqueda}
                onChange={(e) => buscar(e.target.value)}
              />
              <button className="boton-chico" onClick={actualizar} disabled={cargando}>
                {cargando ? 'Consultando…' : 'Actualizar'}
              </button>
              <button className="boton-chico" onClick={() => descargarCsv(visibles, periodo)} disabled={!visibles.length}>
                Descargar CSV
              </button>
            </div>

            {visibles.length === 0 ? (
              <p className="vacio-grafico tenue">No hay citas con este filtro</p>
            ) : (
              <div className="tabla-citas-envoltura">
                <table className="tabla-citas">
                  <thead>
                    <tr>
                      {COLUMNAS.map((col) => {
                        const activa = orden.columna === col.id;
                        return (
                          <th
                            key={col.id}
                            className={col.num ? 'num' : ''}
                            aria-sort={activa ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                          >
                            <button
                              className="orden-columna"
                              onClick={() => ordenarPor(col.id)}
                              title={col.ayuda ?? `Ordenar por ${col.nombre.toLowerCase()}`}
                            >
                              {col.nombre}
                              <span className="flecha" aria-hidden="true">
                                {activa ? (orden.dir === 'asc' ? '▲' : '▼') : '▲▼'}
                              </span>
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {enPagina.map((c) => (
                      <tr key={c.numero}>
                        <td>
                          <Insignia clase={ESTADOS[c.estado].clase} icono={ESTADOS[c.estado].icono}>
                            {ESTADOS[c.estado].nombre}
                          </Insignia>
                        </td>
                        <td>
                          <div className="numero-cita">N° {c.numero}</div>
                          {fueraDelChatbot(c) ? (
                            <div className="origen-cita">
                              <Insignia clase="info" icono="↗" title={AYUDA_FUERA}>
                                Reservada fuera del chatbot
                              </Insignia>
                            </div>
                          ) : (
                            <div className="tenue chico">Agendada {momento(c.agendadaEn)}</div>
                          )}
                        </td>
                        <td>
                          <div>{c.paciente.nombre ? titulo(c.paciente.nombre) : <span className="tenue">Sin nombre</span>}</div>
                          <div className="tenue chico">
                            {c.paciente.documento ? `${c.paciente.tipoDocumento ?? 'Doc.'} ${c.paciente.documento}` : 'Documento no identificado'}
                            {c.paciente.historia && ` · HC ${c.paciente.historia}`}
                          </div>
                          {c.telefono && (
                            <a className="chico" href={`#/${c.telefono}`} title={fmtTelefono(c.telefono)}>
                              Ver conversación
                            </a>
                          )}
                        </td>
                        <td>
                          <Telefono paciente={c.paciente} />
                        </td>
                        <td>
                          <div>{titulo(c.cita.especialidad)}</div>
                          <div className="tenue chico">{titulo(c.cita.medico)}</div>
                          <div className="chico">
                            {fechaCita(c.cita)}
                            {c.cita.consultorio && <span className="tenue"> · {titulo(c.cita.consultorio)}</span>}
                          </div>
                        </td>
                        <td className="num">{c.cita.precio != null ? soles.format(c.cita.precio) : '—'}</td>
                        <td>
                          <PagoConLink pago={c.pago} />
                        </td>
                        <td>
                          <EnLolimsa lolimsa={c.lolimsa} fecha={c.cita.fecha} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {visibles.length > 0 && (
              <Paginacion
                pagina={paginaActual}
                totalPaginas={totalPaginas}
                total={visibles.length}
                porPagina={porPagina}
                onPagina={irAPagina}
                onPorPagina={cambiarTamano}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
