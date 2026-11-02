import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fechaHora } from '../formato.js';

function jsonLegible(texto) {
  try {
    return JSON.stringify(JSON.parse(texto), null, 2);
  } catch {
    return texto;
  }
}

export default function DetalleMensaje({ id, onCerrar }) {
  const [mensaje, setMensaje] = useState(null);
  const [error, setError] = useState(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    api.mensaje(id).then(setMensaje, (e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    const alPresionar = (e) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [onCerrar]);

  const json = mensaje ? JSON.stringify(mensaje.payload, null, 2) : '';

  const copiar = async () => {
    await navigator.clipboard.writeText(json);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  };

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Detalle del mensaje">
        <header>
          <h2>Mensaje #{id}</h2>
          <button className="boton-icono" onClick={onCerrar} aria-label="Cerrar">
            ✕
          </button>
        </header>
        {error && <p className="aviso-error">{error}</p>}
        {!mensaje && !error && <p className="tenue">Cargando…</p>}
        {mensaje && (
          <>
            <dl className="datos-tabla">
              <dt>Dirección</dt>
              <dd>{mensaje.direccion === 'IN' ? 'Entrante (usuario)' : 'Saliente (bot)'}</dd>
              <dt>Tipo</dt>
              <dd>{mensaje.tipo ?? '—'}</dd>
              <dt>Paso</dt>
              <dd>{mensaje.paso ?? '—'}</dd>
              <dt>Estado</dt>
              <dd>{mensaje.estado ?? '—'}</dd>
              <dt>Fecha</dt>
              <dd>{fechaHora(mensaje.creado_en)}</dd>
              <dt>WA id</dt>
              <dd className="mono">{mensaje.wa_message_id ?? '—'}</dd>
            </dl>
            {mensaje.error && (
              <>
                <h3>Error</h3>
                <pre className="json">{jsonLegible(mensaje.error)}</pre>
              </>
            )}
            <div className="titulo-json">
              <h3>Payload</h3>
              <button className="boton-chico" onClick={copiar}>
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <pre className="json">{json}</pre>
          </>
        )}
      </div>
    </div>
  );
}
