import { etiquetaCampo, hora, paso } from '../formato.js';
import TextoWhatsapp from './TextoWhatsapp.jsx';

function valorFormulario(clave, valor) {
  if (Array.isArray(valor)) return valor.map((v) => valorFormulario(clave, v)).join(', ');
  if (typeof valor !== 'string') return JSON.stringify(valor);
  // Los flows envían "codigo|descripcion"; en citas es "numero|monto"
  const [a, b] = valor.split('|');
  if (b === undefined) return valor;
  return clave === 'citas' ? `N° ${a} · S/ ${b}` : `${b} (${a})`;
}

function Formulario({ datos }) {
  const campos = Object.entries(datos);
  return (
    <div className="formulario">
      <div className="formulario-titulo">Formulario enviado</div>
      {campos.length === 0 ? (
        <span className="tenue">Sin datos</span>
      ) : (
        <dl>
          {campos.map(([k, v]) => (
            <div key={k}>
              <dt>{etiquetaCampo(k)}</dt>
              <dd>{valorFormulario(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Acciones({ c }) {
  if (c.botones?.length) {
    return (
      <div className="acciones">
        {c.botones.map((b, i) => (
          <span key={i} className="accion">
            ↩ {b}
          </span>
        ))}
      </div>
    );
  }
  if (c.secciones) {
    return (
      <details className="acciones lista-opciones">
        <summary className="accion">☰ {c.boton}</summary>
        {c.secciones.map((s, i) => (
          <div key={i} className="seccion">
            {s.titulo && <div className="seccion-titulo">{s.titulo}</div>}
            {s.filas.map((f, j) => (
              <div key={j} className="fila-opcion">
                <div>{f.titulo}</div>
                {f.descripcion && <div className="tenue">{f.descripcion}</div>}
              </div>
            ))}
          </div>
        ))}
      </details>
    );
  }
  if (c.url) {
    return (
      <div className="acciones">
        <a className="accion" href={c.url} target="_blank" rel="noreferrer" title={c.url}>
          ↗ {c.boton}
        </a>
      </div>
    );
  }
  if (c.boton) {
    return (
      <div className="acciones">
        <span className="accion" title="WhatsApp Flow">
          ▤ {c.boton}
        </span>
      </div>
    );
  }
  return null;
}

export default function Burbuja({ m, onDetalle }) {
  const c = m.contenido;
  const bot = m.direccion === 'OUT';
  const conError = m.estado === 'ERROR';

  return (
    <div className={`fila-mensaje ${bot ? 'de-bot' : 'de-usuario'}`}>
      <div className={`burbuja ${conError ? 'con-error' : ''}`}>
        {c.seleccion && <div className="seleccion">Tocó en {c.seleccion}</div>}
        {c.encabezado && <div className="encabezado">{c.encabezado}</div>}
        {c.formulario ? (
          <Formulario datos={c.formulario} />
        ) : c.texto ? (
          <TextoWhatsapp texto={c.texto} />
        ) : (
          <div className="tenue">[{m.tipo ?? 'sin contenido'}]</div>
        )}
        {c.descripcion && <div className="tenue">{c.descripcion}</div>}
        {c.pie && <div className="pie">{c.pie}</div>}
        {conError && <div className="error-envio">No se envió: {m.error ?? 'error desconocido'}</div>}
        <div className="meta">
          {m.paso && <span className="paso-mini" title="Paso del bot al registrar el mensaje">{paso(m.paso)}</span>}
          <button className="ver-json" onClick={() => onDetalle(m.id)} title="Ver payload">
            {'{ }'}
          </button>
          <time>{hora(m.creadoEn)}</time>
          {bot && !conError && <span className="enviado" title={m.estado ?? ''}>✓</span>}
        </div>
        <Acciones c={c} />
      </div>
    </div>
  );
}
