import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fechaHora, paso, telefono as fmtTelefono } from '../formato.js';
import {
  BarraApilada,
  BarrasH,
  FilaTip,
  fmtNum,
  fmtPct,
  GraficoArea,
  Indicador,
  MapaCalor,
  Medidor,
  Tarjeta,
} from './graficos.jsx';
import './panel.css';

const PERIODOS = [
  { dias: 1, nombre: 'Hoy' },
  { dias: 7, nombre: '7 días' },
  { dias: 30, nombre: '30 días' },
  { dias: 90, nombre: '90 días' },
  { dias: 0, nombre: 'Todo' },
];
const REFRESCO_MS = 60000;

// Cada tipo de respuesta conserva su color (el color sigue a la categoría, no a su posición)
const COLOR_RESPUESTA = {
  'Texto libre': 'var(--serie-1)',
  Botón: 'var(--serie-2)',
  Lista: 'var(--serie-3)',
  Formulario: 'var(--serie-4)',
  Otro: 'var(--otro)',
};
const COLOR_EMBUDO = ['#104281', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef'];

const soles = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const ZONA = 'America/Lima';
const fmtDia = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const fmtDiaLargo = new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const fmtFechaCorta = new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, day: 'numeric', month: 'short' });
const fmtHoraLima = new Intl.DateTimeFormat('es-PE', { timeZone: ZONA, hour: 'numeric', minute: '2-digit' });

// t llega como "2026-10-15T00" (hora de Lima); se interpreta como UTC solo para darle formato
const fechaTramo = (t) => new Date(`${t}:00:00Z`);
const etiquetaTramo = (tramo) => (p) =>
  tramo === 'hour' ? `${Number(p.t.slice(11))} h` : fmtDia.format(fechaTramo(p.t)).replace('.', '');
const tituloTramo = (tramo, t) =>
  tramo === 'hour'
    ? `${Number(t.slice(11))}:00 – ${Number(t.slice(11)) + 1}:00`
    : fmtDiaLargo.format(fechaTramo(t)).replace(/^./, (c) => c.toUpperCase());

function segundos(s) {
  if (s == null) return '—';
  return s < 60 ? `${s.toFixed(1)} s` : `${(s / 60).toFixed(1)} min`;
}

// Variación vs el periodo anterior. El color indica si el cambio es bueno, con ícono para no depender del color
function variacion(actual, previo, { mejorSiSube = true, puntos = false } = {}) {
  if (previo == null || actual == null) return null;
  if (actual === previo) return { texto: 'Sin cambio', tono: 'neutro' };
  const sube = actual > previo;
  const tono = sube === mejorSiSube ? 'bueno' : 'malo';
  const icono = sube ? '▲' : '▼';
  if (puntos) return { texto: `${Math.abs(Math.round((actual - previo) * 100))} pts`, tono, icono };
  if (previo === 0) return { texto: 'Nuevo', tono, icono };
  return { texto: fmtPct(Math.abs(actual - previo) / previo), tono, icono };
}

const conversion = (k) => (k.conversaciones ? k.conversacionesConCita / k.conversaciones : null);

function descripcionPeriodo({ dias, desde, hasta }, primerTramo) {
  const actualizado = `actualizado ${fmtHoraLima.format(new Date(hasta))}`;
  if (dias === 1) return `Hoy · ${actualizado}`;
  if (!desde) return `Todo el historial${primerTramo ? ` desde el ${fmtDia.format(fechaTramo(primerTramo))}` : ''} · ${actualizado}`;
  return `Del ${fmtFechaCorta.format(new Date(desde))} al ${fmtFechaCorta.format(new Date(hasta))} · ${actualizado}`;
}

function ListaErrores({ errores }) {
  if (!errores.length) {
    return (
      <p className="sin-errores">
        <span className="icono-ok" aria-hidden="true">
          ✓
        </span>{' '}
        Sin errores de envío en este periodo
      </p>
    );
  }
  return (
    <ul className="errores">
      {errores.map((e) => (
        <li key={e.id}>
          <div className="error-cabecera">
            <span className="estado-critico">
              <span aria-hidden="true">⚠</span> Error de envío
            </span>
            <span className="tenue">{fechaHora(e.creadoEn)}</span>
          </div>
          <a href={`#/${e.telefono}`}>{fmtTelefono(e.telefono)}</a>
          <div className="error-detalle">{e.error}</div>
        </li>
      ))}
    </ul>
  );
}

export default function Panel() {
  const [dias, setDias] = useState(30);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      api
        .estadisticas(dias)
        .then((d) => {
          if (!vivo) return;
          setDatos(d);
          setError(null);
        })
        .catch((e) => vivo && setError(e.message))
        .finally(() => vivo && setCargando(false));

    setCargando(true);
    cargar();
    const t = setInterval(cargar, REFRESCO_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [dias]);

  const k = datos?.kpis;
  const prev = datos?.previo;
  const tramo = datos?.periodo.tramo;
  const textoPrevio = dias === 1 ? 'ayer hasta la misma hora' : `los ${dias} días previos`;

  return (
    <div className="panel">
      <div className="panel-cabecera">
        <div>
          <h1>Panel</h1>
          <p className="tenue">{datos ? descripcionPeriodo(datos.periodo, datos.serie[0]?.t) : 'Cargando…'}</p>
        </div>
        <div className="periodos" role="group" aria-label="Periodo">
          {PERIODOS.map((p) => (
            <button key={p.dias} aria-pressed={dias === p.dias} onClick={() => setDias(p.dias)}>
              {p.nombre}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="aviso-error">No se pudieron cargar las estadísticas: {error}</p>}

      {datos && (
        <div className={`panel-cuerpo ${cargando ? 'recargando' : ''}`}>
          <section className="indicadores" aria-label="Indicadores">
            <Indicador
              periodoPrevio={textoPrevio}
              etiqueta="Conversaciones"
              valor={fmtNum.format(k.conversaciones)}
              detalle={`${fmtNum.format(k.entrantes)} mensajes recibidos`}
              variacion={variacion(k.conversaciones, prev?.conversaciones)}
            />
            <Indicador
              periodoPrevio={textoPrevio}
              etiqueta="Citas registradas"
              valor={fmtNum.format(k.citas)}
              detalle={`Valor ${soles.format(k.valorCitas)}`}
              variacion={variacion(k.citas, prev?.citas)}
            />
            <Indicador
              periodoPrevio={textoPrevio}
              etiqueta="Conversión a cita"
              valor={conversion(k) == null ? '—' : fmtPct(conversion(k))}
              detalle={`${fmtNum.format(k.conversacionesConCita)} de ${fmtNum.format(k.conversaciones)} conversaciones`}
              variacion={variacion(conversion(k), prev && conversion(prev), { puntos: true })}
            />
            <Indicador
              periodoPrevio={textoPrevio}
              etiqueta="Recaudado en línea"
              valor={soles.format(k.pagos.recaudado)}
              detalle={`${fmtNum.format(k.pagos.pagadas)} de ${fmtNum.format(k.pagos.links)} links pagados`}
              variacion={variacion(k.pagos.recaudado, prev?.pagos.recaudado)}
            />
            <Indicador
              periodoPrevio={textoPrevio}
              etiqueta="Respuesta del bot"
              valor={segundos(k.respuestaP50)}
              detalle={k.respuestaP95 == null ? 'Mediana' : `Mediana · 95 % en menos de ${segundos(k.respuestaP95)}`}
              variacion={variacion(k.respuestaP50, prev?.respuestaP50, { mejorSiSube: false })}
            />
            <Indicador
              periodoPrevio={textoPrevio}
              etiqueta="Errores de envío"
              valor={fmtNum.format(k.errores)}
              detalle={`de ${fmtNum.format(k.salientes)} mensajes enviados`}
              variacion={variacion(k.errores, prev?.errores, { mejorSiSube: false })}
            />
          </section>

          <div className="rejilla">
            <Tarjeta
              className="ancho-8"
              titulo={tramo === 'hour' ? 'Actividad por hora' : 'Actividad por día'}
              subtitulo="Conversaciones activas (personas distintas que escribieron)"
              tabla={{
                columnas: [tramo === 'hour' ? 'Hora' : 'Día', 'Conversaciones', 'Mensajes recibidos', 'Respuestas', 'Citas'],
                filas: datos.serie.map((s) => [tituloTramo(tramo, s.t), s.conversaciones, s.entrantes, s.salientes, s.citas]),
              }}
            >
              <GraficoArea
                puntos={datos.serie}
                valor={(s) => s.conversaciones}
                etiquetaX={etiquetaTramo(tramo)}
                tooltip={(s) => (
                  <>
                    <div className="tip-titulo">{tituloTramo(tramo, s.t)}</div>
                    <FilaTip color="var(--serie-1)" valor={fmtNum.format(s.conversaciones)} etiqueta="conversaciones" />
                    <FilaTip valor={fmtNum.format(s.entrantes)} etiqueta="mensajes recibidos" />
                    <FilaTip valor={fmtNum.format(s.salientes)} etiqueta="respuestas del bot" />
                    <FilaTip valor={fmtNum.format(s.citas)} etiqueta="citas registradas" />
                  </>
                )}
              />
            </Tarjeta>

            <Tarjeta
              className="ancho-4"
              titulo="Embudo de citas"
              subtitulo="Personas que llegaron a cada etapa"
              tabla={{
                columnas: ['Etapa', 'Personas', '% del inicio'],
                filas: datos.embudo.map((e) => [e.etapa, e.n, datos.embudo[0].n ? fmtPct(e.n / datos.embudo[0].n) : '—']),
              }}
            >
              <BarrasH
                unidad="personas"
                filas={datos.embudo.map((e, i) => ({
                  etiqueta: e.etapa,
                  n: e.n,
                  color: COLOR_EMBUDO[i],
                  extra: i > 0 && datos.embudo[0].n ? fmtPct(e.n / datos.embudo[0].n) : null,
                }))}
              />
            </Tarjeta>

            <Tarjeta
              className="ancho-8"
              titulo="¿Cuándo escriben los pacientes?"
              subtitulo="Mensajes recibidos por día de la semana y hora"
              tabla={{
                columnas: ['Día', 'Hora', 'Mensajes'],
                filas: [...datos.calor]
                  .sort((a, b) => a.dia - b.dia || a.hora - b.hora)
                  .map((c) => [['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'][c.dia - 1], `${c.hora}:00`, c.n]),
              }}
            >
              <MapaCalor celdas={datos.calor} unidad="mensajes" />
            </Tarjeta>

            <Tarjeta
              className="ancho-4"
              titulo="Cómo responden los usuarios"
              subtitulo="Tipo de mensaje que envían"
              tabla={{
                columnas: ['Tipo', 'Mensajes'],
                filas: datos.respuestas.map((r) => [r.tipo, r.n]),
              }}
            >
              <BarraApilada
                unidad="mensajes"
                segmentos={datos.respuestas.map((r) => ({ etiqueta: r.tipo, n: r.n, color: COLOR_RESPUESTA[r.tipo] }))}
              />
            </Tarjeta>

            <Tarjeta
              className="ancho-4"
              titulo="Citas por especialidad"
              tabla={{ columnas: ['Especialidad', 'Citas'], filas: datos.especialidades.map((e) => [e.nombre, e.n]) }}
            >
              <BarrasH unidad="citas" filas={datos.especialidades.map((e) => ({ etiqueta: e.nombre, n: e.n }))} />
            </Tarjeta>

            <Tarjeta
              className="ancho-4"
              titulo="Médicos más solicitados"
              tabla={{ columnas: ['Médico', 'Citas'], filas: datos.medicos.map((m) => [m.nombre, m.n]) }}
            >
              <BarrasH unidad="citas" filas={datos.medicos.map((m) => ({ etiqueta: m.nombre, n: m.n }))} />
            </Tarjeta>

            <Tarjeta className="ancho-4" titulo="Pagos en línea" subtitulo="Links de pago generados en el periodo">
              {k.pagos.links ? (
                <>
                  <Medidor etiqueta="Links pagados" valor={k.pagos.pagadas} total={k.pagos.links} />
                  <dl className="cifras">
                    <div>
                      <dt>Recaudado</dt>
                      <dd>{soles.format(k.pagos.recaudado)}</dd>
                    </div>
                    <div>
                      <dt>Citas pagadas</dt>
                      <dd>{fmtNum.format(k.pagos.citasPagadas)}</dd>
                    </div>
                    <div>
                      <dt>Vencidos</dt>
                      <dd>{fmtNum.format(k.pagos.vencidas)}</dd>
                    </div>
                    <div>
                      <dt>Pendientes</dt>
                      <dd>{fmtNum.format(k.pagos.pendientes)}</dd>
                    </div>
                    <div>
                      <dt>Prefacturas</dt>
                      <dd>{fmtNum.format(k.pagos.prefacturas)}</dd>
                    </div>
                    <div>
                      <dt>Facturas</dt>
                      <dd>{fmtNum.format(k.pagos.facturas)}</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="vacio-grafico tenue">Sin links de pago en este periodo</p>
              )}
            </Tarjeta>

            <Tarjeta
              className="ancho-4"
              titulo="Botones más usados"
              tabla={{ columnas: ['Botón', 'Veces'], filas: datos.botones.map((b) => [b.titulo, b.n]) }}
            >
              <BarrasH unidad="veces" filas={datos.botones.map((b) => ({ etiqueta: b.titulo, n: b.n }))} />
            </Tarjeta>

            <Tarjeta
              className="ancho-4"
              titulo="Dónde quedaron las conversaciones"
              subtitulo="Último paso del bot en cada conversación"
              tabla={{ columnas: ['Paso', 'Conversaciones'], filas: datos.estados.map((e) => [paso(e.paso), e.n]) }}
            >
              <BarrasH unidad="conversaciones" filas={datos.estados.map((e) => ({ etiqueta: paso(e.paso), n: e.n }))} />
            </Tarjeta>

            <Tarjeta className="ancho-4" titulo="Errores de envío" subtitulo="Los más recientes del periodo">
              <ListaErrores errores={datos.errores} />
            </Tarjeta>
          </div>
        </div>
      )}
    </div>
  );
}
