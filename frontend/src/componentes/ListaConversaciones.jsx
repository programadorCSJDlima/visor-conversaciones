import { fechaLista, iniciales, paso, telefono as fmtTelefono } from '../formato.js';

const VISTA_PREVIA = {
  interactive_flow: '▤ Formulario',
  flow_reply: '▤ Formulario enviado',
};

function vistaPrevia(c) {
  const texto = VISTA_PREVIA[c.ultimo_tipo] ?? c.ultimo_texto ?? `[${c.ultimo_tipo}]`;
  return (c.ultimo_direccion === 'OUT' ? 'Bot: ' : '') + texto.replace(/[*_~]/g, '');
}

export default function ListaConversaciones({
  conversaciones,
  seleccionado,
  onSeleccionar,
  busqueda,
  onBuscar,
  cargando,
  error,
  usuario,
  onSalir,
}) {
  return (
    <nav className="lista">
      <header className="lista-cabecera">
        <h1>Conversaciones</h1>
        <span className="tenue">{conversaciones.length}</span>
        {onSalir && (
          <button className="boton-chico salir" onClick={onSalir} title={`Sesión de ${usuario}`}>
            Salir
          </button>
        )}
      </header>
      <div className="buscador">
        <input
          type="search"
          placeholder="Buscar teléfono, nombre, DNI o texto…"
          value={busqueda}
          onChange={(e) => onBuscar(e.target.value)}
        />
      </div>
      {error && <p className="aviso-error">No se pudo cargar: {error}</p>}
      <ul>
        {conversaciones.map((c) => {
          const nombre = c.paciente ?? c.nombre_whatsapp ?? fmtTelefono(c.telefono);
          return (
            <li key={c.telefono}>
              <button
                className={`item ${c.telefono === seleccionado ? 'seleccionado' : ''}`}
                onClick={() => onSeleccionar(c.telefono)}
              >
                <div className="avatar">{iniciales(nombre)}</div>
                <div className="item-cuerpo">
                  <div className="item-linea">
                    <span className="nombre">{nombre}</span>
                    <time className="tenue">{fechaLista(c.ultimo_mensaje)}</time>
                  </div>
                  <div className="item-linea">
                    <span className="vista-previa">{vistaPrevia(c)}</span>
                    {c.errores > 0 && (
                      <span className="insignia-error" title={`${c.errores} mensaje(s) con error de envío`}>
                        {c.errores}
                      </span>
                    )}
                  </div>
                  <div className="item-linea">
                    <span className="tenue chico">{fmtTelefono(c.telefono)}</span>
                    <span className={`chip-paso chico paso-${c.paso}`}>{paso(c.paso)}</span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      {!cargando && !error && conversaciones.length === 0 && <p className="centro tenue">Sin resultados</p>}
    </nav>
  );
}
