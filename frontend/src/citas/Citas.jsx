import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { fechaHora, telefono as fmtTelefono } from '../formato.js';
import '../panel/panel.css';
import './citas.css';

const PERIODOS = [
  { dias: 1, nombre: 'Hoy' },
  { dias: 7, nombre: '7 días' },
  { dias: 30, nombre: '30 días' },
  { dias: 90, nombre: '90 días' },
  { dias: 0, nombre: 'Todo' },
];
const REFRESCO_MS = 2 * 60 * 1000;

// Estado de cada cita, con ícono para no depender solo del color
const ESTADOS = {
  PENDIENTE: { nombre: 'Pendiente de pago', icono: '⏳', clase: 'aviso' },
  PAGADA: { nombre: 'Pagada', icono: '✓', clase: 'bueno' },
  ATENDIDA: { nombre: 'Atendida', icono: '✓', clase: 'info' },
  ANULADA: { nombre: 'Anulada', icono: '✕', clase: 'critico' },
};
const FILTROS = ['PENDIENTE', 'PAGADA', 'ATENDIDA', 'ANULADA'];

const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const fmtFechaCita = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const fmtHoraLima = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: 'numeric', minute: '2-digit' });
const fmtDiaMes = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: 'numeric', month: 'short' });
const momento = (f) => `${fmtDiaMes.format(new Date(f)).replace('.', '')}, ${fmtHoraLima.format(new Date(f))}`;
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
          <Insignia clase="bueno" icono="✓">
            Pagado
          </Insignia>
          <div className="tenue chico">{momento(pago.pagadoEn)}</div>
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
    return (
      <Insignia clase="critico" icono="✕" title="La cita ya no figura en Lolimsa">
        Anulada
      </Insignia>
    );
  }
  const yaPaso = fecha && fecha < hoyLima();
  return (
    <div className="insignias">
      {lolimsa.pagada ? (
        <Insignia clase="bueno" icono="✓">
          Pagada
        </Insignia>
      ) : (
        <Insignia clase="aviso" icono="⏳">
          Por pagar
        </Insignia>
      )}
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
  );
}

function descargarCsv(citas) {
  const columnas = [
    'Estado', 'N° cita', 'Agendada', 'Paciente', 'Tipo doc.', 'Documento', 'Historia', 'Especialidad', 'Médico',
    'Fecha cita', 'Hora', 'Consultorio', 'Precio', 'Pago con link', 'Pagado el', 'En Lolimsa', 'Pagada en Lolimsa',
    'Atendida', 'Conversación',
  ];
  const filas = citas.map((c) => [
    ESTADOS[c.estado].nombre,
    c.numero,
    fechaHora(c.agendadaEn),
    c.paciente.nombre ?? '',
    c.paciente.tipoDocumento ?? '',
    c.paciente.documento ?? '',
    c.paciente.historia ?? '',
    titulo(c.cita.especialidad),
    titulo(c.cita.medico),
    c.cita.fecha ?? c.cita.fechaTexto ?? '',
    c.cita.hora ?? c.cita.horaTexto ?? '',
    c.cita.consultorio ?? '',
    c.cita.precio ?? '',
    c.pago.estado,
    c.pago.pagadoEn ? fechaHora(c.pago.pagadoEn) : '',
    !c.lolimsa.consultada ? 'Sin consultar' : c.lolimsa.existe ? 'Sí' : 'No (anulada)',
    c.lolimsa.existe ? (c.lolimsa.pagada ? 'Sí' : 'No') : '',
    c.lolimsa.existe ? (c.lolimsa.atendida ? 'Sí' : 'No') : '',
    c.telefono,
  ]);
  const celda = (v) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columnas, ...filas].map((f) => f.map(celda).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `citas-chatbot-${hoyLima()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Citas() {
  const [dias, setDias] = useState(30);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState('PENDIENTE');
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState('agendada');
  const [recarga, setRecarga] = useState(0);
  // "Actualizar" pide a Lolimsa datos frescos; el refresco automático puede usar los de hace unos minutos
  const forzar = useRef(false);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      api
        .citas(dias, forzar.current)
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
  }, [dias, recarga]);

  const actualizar = useCallback(() => {
    forzar.current = true;
    setRecarga((n) => n + 1);
  }, []);

  const resumen = useMemo(() => {
    const r = Object.fromEntries(['TODAS', ...FILTROS].map((k) => [k, { n: 0, monto: 0 }]));
    for (const c of datos?.citas ?? []) {
      for (const k of ['TODAS', c.estado]) {
        r[k].n += 1;
        r[k].monto += c.cita.precio ?? 0;
      }
    }
    return r;
  }, [datos]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = (datos?.citas ?? []).filter(
      (c) =>
        (filtro === 'TODAS' || c.estado === filtro) &&
        (!q ||
          [c.numero, c.paciente.nombre, c.paciente.documento, c.paciente.historia, c.cita.especialidad, c.cita.medico]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))),
    );
    if (orden === 'fecha') {
      const clave = (c) => (c.cita.fecha ? `${c.cita.fecha}T${c.cita.hora}` : '9999');
      return [...lista].sort((a, b) => clave(a).localeCompare(clave(b)));
    }
    return lista;
  }, [datos, filtro, busqueda, orden]);

  const lol = datos?.lolimsa;

  return (
    <div className="panel citas">
      <div className="panel-cabecera">
        <div>
          <h1>Citas agendadas</h1>
          <p className="tenue">
            Por el chatbot
            {lol?.configurado && lol.documentos > 0 && ` · Lolimsa consultado a las ${fmtHoraLima.format(new Date(lol.consultadoEn))}`}
          </p>
        </div>
        <div className="periodos" role="group" aria-label="Agendadas en">
          {PERIODOS.map((p) => (
            <button key={p.dias} aria-pressed={dias === p.dias} onClick={() => setDias(p.dias)}>
              {p.nombre}
            </button>
          ))}
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

      {datos && (
        <div className={`panel-cuerpo ${cargando ? 'recargando' : ''}`}>
          <section className="filtros-estado" aria-label="Filtrar por estado">
            {['TODAS', ...FILTROS].map((k) => (
              <button
                key={k}
                className={`filtro-estado ${k === 'TODAS' ? '' : ESTADOS[k].clase}`}
                aria-pressed={filtro === k}
                onClick={() => setFiltro(k)}
              >
                <span className="filtro-nombre">
                  {k !== 'TODAS' && <span aria-hidden="true">{ESTADOS[k].icono} </span>}
                  {k === 'TODAS' ? 'Todas' : ESTADOS[k].nombre}
                </span>
                <span className="filtro-n">{resumen[k].n}</span>
                <span className="tenue chico">{soles.format(resumen[k].monto)}</span>
              </button>
            ))}
          </section>

          <div className="tarjeta">
            <div className="barra-herramientas">
              <input
                type="search"
                placeholder="Buscar paciente, documento, N° de cita, especialidad o médico…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <label className="tenue chico">
                Ordenar por{' '}
                <select value={orden} onChange={(e) => setOrden(e.target.value)}>
                  <option value="agendada">Más recientes</option>
                  <option value="fecha">Fecha de la cita</option>
                </select>
              </label>
              <button className="boton-chico" onClick={actualizar} disabled={cargando}>
                {cargando ? 'Consultando…' : 'Actualizar'}
              </button>
              <button className="boton-chico" onClick={() => descargarCsv(visibles)} disabled={!visibles.length}>
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
                      <th>Estado</th>
                      <th>Cita</th>
                      <th>Paciente</th>
                      <th>Atención</th>
                      <th className="num">Precio</th>
                      <th>Pago con link</th>
                      <th>En Lolimsa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((c) => (
                      <tr key={c.numero}>
                        <td>
                          <Insignia clase={ESTADOS[c.estado].clase} icono={ESTADOS[c.estado].icono}>
                            {ESTADOS[c.estado].nombre}
                          </Insignia>
                        </td>
                        <td>
                          <div className="numero-cita">N° {c.numero}</div>
                          <div className="tenue chico">Agendada {momento(c.agendadaEn)}</div>
                        </td>
                        <td>
                          <div>{c.paciente.nombre ? titulo(c.paciente.nombre) : <span className="tenue">Sin nombre</span>}</div>
                          <div className="tenue chico">
                            {c.paciente.documento ? `${c.paciente.tipoDocumento ?? 'Doc.'} ${c.paciente.documento}` : 'Documento no identificado'}
                            {c.paciente.historia && ` · HC ${c.paciente.historia}`}
                          </div>
                          <a className="chico" href={`#/${c.telefono}`} title={fmtTelefono(c.telefono)}>
                            Ver conversación
                          </a>
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
          </div>
        </div>
      )}
    </div>
  );
}
