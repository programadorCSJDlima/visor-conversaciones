import { useLayoutEffect, useRef, useState } from 'react';

export const fmtNum = new Intl.NumberFormat('es-PE');
const fmtCompacto = new Intl.NumberFormat('es-PE', { notation: 'compact', maximumFractionDigits: 1 });
export const fmtPct = (x) => `${Math.round(x * 100)} %`;

// Tooltip compartido por cada gráfico: se posiciona relativo a su contenedor
function useTooltip() {
  const ref = useRef(null);
  const [tip, setTip] = useState(null);

  const mostrarEn = (x, y, contenido) => setTip({ x, y, contenido, ancho: ref.current?.clientWidth ?? 0 });
  const mostrar = (e, contenido) => {
    const caja = ref.current.getBoundingClientRect();
    if (e.type.startsWith('pointer')) return mostrarEn(e.clientX - caja.left, e.clientY - caja.top, contenido);
    const r = e.currentTarget.getBoundingClientRect();
    mostrarEn(r.left + r.width / 2 - caja.left, r.top - caja.top, contenido);
  };
  const ocultar = () => setTip(null);

  const elemento = tip && (
    <div
      className="tooltip"
      role="status"
      style={{ left: Math.min(Math.max(tip.x, 90), Math.max(tip.ancho - 90, 90)), top: tip.y }}
    >
      {tip.contenido}
    </div>
  );
  return { ref, mostrar, mostrarEn, ocultar, elemento };
}

function useAncho(ref) {
  const [ancho, setAncho] = useState(0);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setAncho(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return ancho;
}

// Filas del tooltip: el valor primero, la etiqueta después; la clave de color es un trazo corto
export function FilaTip({ color, valor, etiqueta }) {
  return (
    <div className="tip-fila">
      {color && <span className="tip-clave" style={{ background: color }} />}
      <strong>{valor}</strong>
      <span>{etiqueta}</span>
    </div>
  );
}

function pasoLimpio(max) {
  const bruto = max / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto || 1));
  return [1, 2, 5, 10].map((m) => m * potencia).find((p) => p >= bruto) ?? potencia * 10;
}

/* ---------- Contenedor ---------- */

function TablaDatos({ columnas, filas }) {
  return (
    <div className="tabla-envoltura">
      <table className="tabla-datos">
        <thead>
          <tr>
            {columnas.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>
              {f.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tarjeta({ titulo, subtitulo, tabla, className = '', children }) {
  const [verTabla, setVerTabla] = useState(false);
  return (
    <figure className={`tarjeta ${className}`}>
      <header className="tarjeta-cabecera">
        <div>
          <h2>{titulo}</h2>
          {subtitulo && <p className="tenue">{subtitulo}</p>}
        </div>
        {tabla && (
          <button className="boton-chico" onClick={() => setVerTabla((v) => !v)} aria-pressed={verTabla}>
            {verTabla ? 'Gráfico' : 'Tabla'}
          </button>
        )}
      </header>
      {verTabla ? <TablaDatos {...tabla} /> : children}
    </figure>
  );
}

/* ---------- Indicador (stat tile) ---------- */

export function Indicador({ etiqueta, valor, detalle, variacion, periodoPrevio }) {
  return (
    <div className="indicador">
      <div className="indicador-etiqueta">{etiqueta}</div>
      <div className="indicador-valor">{valor}</div>
      {variacion && (
        <div className={`variacion ${variacion.tono}`} title={`Comparado con ${periodoPrevio}`}>
          {variacion.icono && <span aria-hidden="true">{variacion.icono} </span>}
          {variacion.texto}
          <span className="tenue"> vs anterior</span>
        </div>
      )}
      {detalle && <div className="indicador-detalle tenue">{detalle}</div>}
    </div>
  );
}

/* ---------- Área con cursor (tendencia en el tiempo) ---------- */

export function GraficoArea({ puntos, valor, etiquetaX, tooltip, color = 'var(--serie-1)', alto = 200 }) {
  const { ref, mostrarEn, ocultar, elemento } = useTooltip();
  const ancho = useAncho(ref);
  const [activo, setActivo] = useState(null);

  const m = { izq: 34, der: 14, arr: 22, aba: 26 };
  const w = Math.max(ancho - m.izq - m.der, 1);
  const n = puntos.length;
  const valores = puntos.map(valor);
  const pico = Math.max(...valores, 0);
  const paso = pasoLimpio(Math.max(pico, 4));
  const max = Math.ceil(Math.max(pico, 1) / paso) * paso;
  const ticks = Array.from({ length: Math.round(max / paso) + 1 }, (_, i) => i * paso);

  const x = (i) => m.izq + (n === 1 ? w / 2 : (i * w) / (n - 1));
  const y = (v) => m.arr + alto - (v / max) * alto;
  const linea = valores.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const area = `${linea}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const iPico = valores.indexOf(pico);
  const cadaX = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))));

  const activar = (i) => {
    setActivo(i);
    mostrarEn(x(i), y(valores[i]), tooltip(puntos[i]));
  };
  const alMover = (e) => {
    const caja = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - caja.left - m.izq) / w) * (n - 1));
    activar(Math.min(Math.max(i, 0), n - 1));
  };
  const alTeclear = (e) => {
    const delta = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!delta) return;
    e.preventDefault();
    activar(Math.min(Math.max((activo ?? n - 1) + delta, 0), n - 1));
  };
  const salir = () => {
    setActivo(null);
    ocultar();
  };

  return (
    <div className="grafico" ref={ref}>
      {ancho > 0 && n > 0 && (
        <svg
          width={ancho}
          height={m.arr + alto + m.aba}
          tabIndex={0}
          role="img"
          aria-label="Usa las flechas para recorrer los valores"
          onPointerMove={alMover}
          onPointerLeave={salir}
          onFocus={() => activar(activo ?? n - 1)}
          onBlur={salir}
          onKeyDown={alTeclear}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'eje' : 'linea-guia'} x1={m.izq} x2={m.izq + w} y1={y(t)} y2={y(t)} />
              <text className="tick" x={m.izq - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {fmtCompacto.format(t)}
              </text>
            </g>
          ))}
          {puntos.map(
            (p, i) =>
              (i % cadaX === 0 || i === n - 1) && (n - 1 - i >= cadaX / 2 || i === n - 1) && (
                <text key={i} className="tick" x={x(i)} y={m.arr + alto + 18} textAnchor="middle">
                  {etiquetaX(p)}
                </text>
              ),
          )}
          <path d={area} fill={color} opacity="0.1" />
          <path d={linea} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {pico > 0 && activo === null && (
            <>
              <circle className="punto" cx={x(iPico)} cy={y(pico)} r="4" fill={color} />
              <text className="etiqueta-directa" x={x(iPico)} y={y(pico) - 10} textAnchor="middle">
                {fmtNum.format(pico)}
              </text>
            </>
          )}
          {activo !== null && (
            <>
              <line className="cursor" x1={x(activo)} x2={x(activo)} y1={m.arr} y2={m.arr + alto} />
              <circle className="punto" cx={x(activo)} cy={y(valores[activo])} r="4" fill={color} />
            </>
          )}
        </svg>
      )}
      {elemento}
    </div>
  );
}

/* ---------- Barras horizontales ---------- */

// filas: [{ etiqueta, n, color?, extra? }] — un solo color salvo que la fila traiga el suyo (embudo)
export function BarrasH({ filas, unidad, color = 'var(--serie-1)', vacio = 'Sin datos en este periodo' }) {
  const { ref, mostrar, ocultar, elemento } = useTooltip();
  const max = Math.max(...filas.map((f) => f.n), 0);
  if (!max) return <p className="vacio-grafico tenue">{vacio}</p>;

  return (
    <div className="grafico barras" ref={ref}>
      {filas.map((f, i) => {
        const tip = (
          <>
            <div className="tip-titulo">{f.etiqueta}</div>
            <FilaTip color={f.color ?? color} valor={fmtNum.format(f.n)} etiqueta={unidad} />
            {f.extra && <div className="tip-extra">{f.extra}</div>}
          </>
        );
        return (
          <div
            key={i}
            className="barra-fila"
            tabIndex={0}
            onPointerMove={(e) => mostrar(e, tip)}
            onPointerLeave={ocultar}
            onFocus={(e) => mostrar(e, tip)}
            onBlur={ocultar}
          >
            <div className="barra-etiqueta">{f.etiqueta}</div>
            <div className="barra-pista">
              <span className="barra" style={{ width: `calc((100% - 72px) * ${f.n / max})`, background: f.color ?? color }} />
              <span className="barra-valor">
                {fmtNum.format(f.n)}
                {f.extra && <span className="tenue"> · {f.extra}</span>}
              </span>
            </div>
          </div>
        );
      })}
      {elemento}
    </div>
  );
}

/* ---------- Barra apilada al 100 % (parte del todo) ---------- */

export function BarraApilada({ segmentos, unidad }) {
  const { ref, mostrar, ocultar, elemento } = useTooltip();
  const total = segmentos.reduce((s, x) => s + x.n, 0);
  if (!total) return <p className="vacio-grafico tenue">Sin datos en este periodo</p>;
  const visibles = segmentos.filter((s) => s.n > 0);

  return (
    <div className="grafico" ref={ref}>
      <div className="apilada">
        {visibles.map((s) => {
          const tip = (
            <>
              <FilaTip color={s.color} valor={fmtPct(s.n / total)} etiqueta={s.etiqueta} />
              <div className="tip-extra">
                {fmtNum.format(s.n)} {unidad}
              </div>
            </>
          );
          return (
            <span
              key={s.etiqueta}
              className="segmento"
              tabIndex={0}
              aria-label={`${s.etiqueta}: ${fmtPct(s.n / total)}`}
              style={{ flexGrow: s.n, background: s.color }}
              onPointerMove={(e) => mostrar(e, tip)}
              onPointerLeave={ocultar}
              onFocus={(e) => mostrar(e, tip)}
              onBlur={ocultar}
            />
          );
        })}
      </div>
      <ul className="leyenda">
        {segmentos.map((s) => (
          <li key={s.etiqueta}>
            <span className="muestra" style={{ background: s.color }} />
            <span className="leyenda-etiqueta">{s.etiqueta}</span>
            <strong>{fmtPct(s.n / total)}</strong>
            <span className="tenue">{fmtNum.format(s.n)}</span>
          </li>
        ))}
      </ul>
      {elemento}
    </div>
  );
}

/* ---------- Mapa de calor día × hora ---------- */

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_LARGOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const ESCALA_CALOR = ['#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];

export function MapaCalor({ celdas, unidad }) {
  const { ref, mostrar, ocultar, elemento } = useTooltip();
  const valor = {};
  for (const c of celdas) valor[`${c.dia}-${c.hora}`] = c.n;
  const max = Math.max(...celdas.map((c) => c.n), 0);
  const colorDe = (n) => (n ? ESCALA_CALOR[Math.min(Math.ceil((n / max) * ESCALA_CALOR.length) - 1, ESCALA_CALOR.length - 1)] : null);
  const hora = (h) => `${String(h).padStart(2, '0')}:00`;
  if (!max) return <p className="vacio-grafico tenue">Sin mensajes en este periodo</p>;

  return (
    <div className="grafico" ref={ref}>
      <div className="calor">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="tick calor-hora">
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
        {DIAS.map((d, i) => (
          <div key={d} className="calor-fila">
            <span className="tick calor-dia">{d}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const n = valor[`${i + 1}-${h}`] ?? 0;
              const tip = (
                <>
                  <div className="tip-titulo">
                    {DIAS_LARGOS[i]} · {hora(h)}–{hora((h + 1) % 24)}
                  </div>
                  <FilaTip valor={fmtNum.format(n)} etiqueta={unidad} />
                </>
              );
              return (
                <span
                  key={h}
                  className="celda"
                  style={colorDe(n) ? { background: colorDe(n) } : undefined}
                  tabIndex={n ? 0 : -1}
                  onPointerMove={(e) => mostrar(e, tip)}
                  onPointerLeave={ocultar}
                  onFocus={(e) => mostrar(e, tip)}
                  onBlur={ocultar}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="escala">
        <span className="tick">Menos</span>
        <span className="celda" />
        {ESCALA_CALOR.map((c) => (
          <span key={c} className="celda" style={{ background: c }} />
        ))}
        <span className="tick">Más · máximo {fmtNum.format(max)} por hora</span>
      </div>
      {elemento}
    </div>
  );
}

/* ---------- Medidor ---------- */

export function Medidor({ etiqueta, valor, total }) {
  const pct = total ? valor / total : 0;
  return (
    <div className="medidor">
      <div className="medidor-cabecera">
        <span>{etiqueta}</span>
        <span>
          <strong>{fmtPct(pct)}</strong>
          <span className="tenue">
            {' '}
            · {fmtNum.format(valor)} de {fmtNum.format(total)}
          </span>
        </span>
      </div>
      <div className="medidor-pista" role="meter" aria-valuenow={valor} aria-valuemin={0} aria-valuemax={total} aria-label={etiqueta}>
        <span className="medidor-relleno" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
