import { useEffect, useRef, useState } from 'react';

// Las fechas se manejan como texto yyyy-mm-dd (días de Lima) y se calculan en UTC para no depender
// de la zona horaria del navegador.
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre',
  'Noviembre', 'Diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS_SEMANA = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
export const MAX_DIAS = 366;

const aFecha = (iso) => new Date(`${iso}T00:00:00Z`);
const aIso = (fecha) => fecha.toISOString().slice(0, 10);
const sumarDias = (iso, n) => aIso(new Date(aFecha(iso).getTime() + n * 864e5));
const primerDiaDelMes = (iso) => `${iso.slice(0, 7)}-01`;
const sumarMeses = (iso, n) => {
  const f = aFecha(primerDiaDelMes(iso));
  return aIso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + n, 1)));
};
export const hoyLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
export const diasEntre = (desde, hasta) => Math.round((aFecha(hasta) - aFecha(desde)) / 864e5) + 1;

// "3 nov" o "3 nov 2025" si no es del año actual
export function fechaCorta(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const anio = a === Number(hoyLima().slice(0, 4)) ? '' : ` ${a}`;
  return `${d} ${MESES_CORTOS[m - 1]}${anio}`;
}

export function textoRango(desde, hasta) {
  return desde === hasta ? fechaCorta(desde) : `${fechaCorta(desde)} – ${fechaCorta(hasta)}`;
}

// Ícono del botón "Personalizado" que abre este selector
export function IconoCalendario() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function rangosRapidos(hoy) {
  const diaSemana = (aFecha(hoy).getUTCDay() + 6) % 7; // 0 = lunes
  const lunes = sumarDias(hoy, -diaSemana);
  const inicioMes = primerDiaDelMes(hoy);
  const inicioMesPasado = sumarMeses(hoy, -1);
  return [
    { nombre: 'Ayer', desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) },
    { nombre: 'Esta semana', desde: lunes, hasta: hoy },
    { nombre: 'Semana pasada', desde: sumarDias(lunes, -7), hasta: sumarDias(lunes, -1) },
    { nombre: 'Este mes', desde: inicioMes, hasta: hoy },
    { nombre: 'Mes pasado', desde: inicioMesPasado, hasta: sumarDias(inicioMes, -1) },
  ];
}

function Mes({ mes, hoy, inicio, fin, previo, onElegir, onPasar }) {
  const f = aFecha(mes);
  const desfase = (f.getUTCDay() + 6) % 7;
  const diasDelMes = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate();
  // Mientras se elige el fin, el rango se previsualiza hasta el día bajo el cursor
  const finVisible = fin ?? previo;
  const [a, b] = inicio && finVisible && finVisible < inicio ? [finVisible, inicio] : [inicio, finVisible];

  return (
    <div className="calendario-mes">
      <div className="calendario-titulo">
        {MESES[f.getUTCMonth()]} {f.getUTCFullYear()}
      </div>
      <div className="calendario-grilla" role="grid">
        {DIAS_SEMANA.map((d) => (
          <span key={d} className="calendario-dia-semana" aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: desfase }, (_, i) => (
          <span key={`v${i}`} />
        ))}
        {Array.from({ length: diasDelMes }, (_, i) => {
          const iso = `${mes.slice(0, 8)}${String(i + 1).padStart(2, '0')}`;
          const futuro = iso > hoy;
          const extremo = iso === a || iso === b;
          const dentro = a && b && iso > a && iso < b;
          const clases = [
            'calendario-dia',
            extremo && 'extremo',
            iso === a && b && a !== b && 'inicio',
            iso === b && a && a !== b && 'fin',
            dentro && 'dentro',
            iso === hoy && 'hoy',
          ].filter(Boolean);
          return (
            <button
              key={iso}
              type="button"
              className={clases.join(' ')}
              disabled={futuro}
              aria-pressed={extremo || dentro}
              aria-label={`${i + 1} de ${MESES[f.getUTCMonth()].toLowerCase()} de ${f.getUTCFullYear()}`}
              onClick={() => onElegir(iso)}
              onMouseEnter={() => onPasar(iso)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Selector de rango de fechas: dos meses, rangos rápidos y vista previa del rango mientras se elige.
 * Los días futuros no se pueden elegir; el rango puede tener hasta MAX_DIAS días.
 */
export default function SelectorFechas({ desde, hasta, onAplicar, onCerrar }) {
  const hoy = hoyLima();
  const [inicio, setInicio] = useState(desde ?? null);
  const [fin, setFin] = useState(hasta ?? null);
  const [previo, setPrevio] = useState(null);
  // Se muestran dos meses; el de la derecha es el del fin del rango (o el actual)
  const [mes, setMes] = useState(sumarMeses(hasta ?? hoy, -1));
  const ref = useRef(null);

  useEffect(() => {
    const alPresionar = (e) => e.key === 'Escape' && onCerrar();
    const alClic = (e) => ref.current && !ref.current.contains(e.target) && !e.target.closest('.boton-rango') && onCerrar();
    window.addEventListener('keydown', alPresionar);
    window.addEventListener('mousedown', alClic);
    return () => {
      window.removeEventListener('keydown', alPresionar);
      window.removeEventListener('mousedown', alClic);
    };
  }, [onCerrar]);

  const elegir = (iso) => {
    if (!inicio || fin) {
      setInicio(iso);
      setFin(null);
    } else if (iso < inicio) {
      setFin(inicio);
      setInicio(iso);
    } else {
      setFin(iso);
    }
  };

  const elegirRapido = (r) => {
    setInicio(r.desde);
    setFin(r.hasta);
    setMes(sumarMeses(r.hasta, -1));
  };

  const rangoFinal = inicio ? [inicio, fin ?? inicio] : null;
  const largo = rangoFinal ? diasEntre(...rangoFinal) : 0;
  const muyLargo = largo > MAX_DIAS;
  const siguienteMes = sumarMeses(mes, 1);

  return (
    <div className="selector-fechas" ref={ref} role="dialog" aria-label="Elegir rango de fechas">
      <div className="selector-rapidos">
        {rangosRapidos(hoy).map((r) => {
          const elegido = inicio === r.desde && (fin ?? inicio) === r.hasta;
          return (
            <button key={r.nombre} type="button" aria-pressed={elegido} onClick={() => elegirRapido(r)}>
              {r.nombre}
            </button>
          );
        })}
      </div>

      <div className="selector-calendarios" onMouseLeave={() => setPrevio(null)}>
        <button type="button" className="calendario-nav anterior" aria-label="Mes anterior" onClick={() => setMes(sumarMeses(mes, -1))}>
          ‹
        </button>
        <button
          type="button"
          className="calendario-nav siguiente"
          aria-label="Mes siguiente"
          disabled={siguienteMes >= primerDiaDelMes(hoy)}
          onClick={() => setMes(siguienteMes)}
        >
          ›
        </button>
        {[mes, siguienteMes].map((m, i) => (
          <div key={m} className={i === 0 ? 'mes-izquierdo' : 'mes-derecho'}>
            <Mes
              mes={m}
              hoy={hoy}
              inicio={inicio}
              fin={fin}
              previo={inicio && !fin ? previo : null}
              onElegir={elegir}
              onPasar={setPrevio}
            />
          </div>
        ))}
      </div>

      <div className="selector-pie">
        <span className={muyLargo ? 'selector-error' : 'tenue'}>
          {!rangoFinal && 'Elige el día de inicio'}
          {rangoFinal && !fin && `${fechaCorta(inicio)} · elige el día final`}
          {rangoFinal && fin && `${textoRango(...rangoFinal)} · ${largo} ${largo === 1 ? 'día' : 'días'}`}
          {muyLargo && ` (máximo ${MAX_DIAS})`}
        </span>
        <div className="selector-acciones">
          <button type="button" className="boton-chico" onClick={onCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className="boton-primario"
            disabled={!rangoFinal || muyLargo}
            onClick={() => onAplicar(...rangoFinal)}
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
