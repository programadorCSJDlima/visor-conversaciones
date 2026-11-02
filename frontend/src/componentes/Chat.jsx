import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { claveDia, etiquetaDia, iniciales, nombrePaciente, paso, telefono as fmtTelefono } from '../formato.js';
import Burbuja from './Burbuja.jsx';
import DetalleMensaje from './DetalleMensaje.jsx';
import PanelDatos from './PanelDatos.jsx';

const REFRESCO_MS = 5000;

export default function Chat({ telefono, resumen, onVolver }) {
  const [mensajes, setMensajes] = useState([]);
  const [estado, setEstado] = useState(null);
  const [hayAnteriores, setHayAnteriores] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoAnteriores, setCargandoAnteriores] = useState(false);
  const [error, setError] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [verDatos, setVerDatos] = useState(() => window.innerWidth > 1100);

  const scrollRef = useRef(null);
  const pegadoAbajo = useRef(true);
  const alturaPrevia = useRef(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([api.mensajes(telefono), api.conversacion(telefono)])
      .then(([m, e]) => {
        if (!vivo) return;
        setMensajes(m.mensajes);
        setHayAnteriores(m.hayAnteriores);
        setEstado(e);
      })
      .catch((e) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [telefono]);

  // Trae solo los mensajes nuevos para seguir la conversación en vivo
  const ultimoId = mensajes.at(-1)?.id;
  useEffect(() => {
    if (cargando || !ultimoId) return;
    let vivo = true;
    const t = setInterval(async () => {
      try {
        const [m, e] = await Promise.all([api.mensajes(telefono, { despues: ultimoId }), api.conversacion(telefono)]);
        if (!vivo) return;
        setEstado(e);
        if (m.mensajes.length) {
          setMensajes((prev) => {
            const ids = new Set(prev.map((x) => x.id));
            return [...prev, ...m.mensajes.filter((x) => !ids.has(x.id))];
          });
        }
      } catch {
        // Se reintenta en el siguiente ciclo
      }
    }, REFRESCO_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [telefono, ultimoId, cargando]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (alturaPrevia.current != null) {
      el.scrollTop = el.scrollHeight - alturaPrevia.current;
      alturaPrevia.current = null;
    } else if (pegadoAbajo.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [mensajes]);

  const alDesplazar = () => {
    const el = scrollRef.current;
    pegadoAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const cargarAnteriores = async () => {
    setCargandoAnteriores(true);
    try {
      const m = await api.mensajes(telefono, { antes: mensajes[0].id });
      const el = scrollRef.current;
      alturaPrevia.current = el.scrollHeight - el.scrollTop;
      setMensajes((prev) => [...m.mensajes, ...prev]);
      setHayAnteriores(m.hayAnteriores);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargandoAnteriores(false);
    }
  };

  const nombre = resumen?.paciente ?? nombrePaciente(estado?.datos) ?? resumen?.nombre_whatsapp ?? fmtTelefono(telefono);
  const pasoActual = estado?.paso ?? resumen?.paso;

  return (
    <div className="chat">
      <div className="chat-principal">
        <header className="chat-cabecera">
          <button className="boton-icono solo-movil" onClick={onVolver} aria-label="Volver">
            ←
          </button>
          <div className="avatar">{iniciales(nombre)}</div>
          <div className="chat-titulo">
            <div className="nombre">{nombre}</div>
            <div className="tenue">
              {fmtTelefono(telefono)}
              {resumen?.nombre_whatsapp && resumen.nombre_whatsapp !== nombre && ` · WhatsApp: ${resumen.nombre_whatsapp}`}
            </div>
          </div>
          {pasoActual && <span className={`chip-paso paso-${pasoActual}`}>{paso(pasoActual)}</span>}
          <button
            className={`boton-chico ${verDatos ? 'activo' : ''}`}
            onClick={() => setVerDatos((v) => !v)}
            title="Datos del paciente y estado del bot"
          >
            Detalle
          </button>
        </header>

        <div className="mensajes" ref={scrollRef} onScroll={alDesplazar}>
          {cargando && <p className="centro tenue">Cargando mensajes…</p>}
          {error && <p className="aviso-error">{error}</p>}
          {hayAnteriores && (
            <button className="cargar-anteriores" onClick={cargarAnteriores} disabled={cargandoAnteriores}>
              {cargandoAnteriores ? 'Cargando…' : 'Cargar mensajes anteriores'}
            </button>
          )}
          {mensajes.map((m, i) => {
            const nuevoDia = i === 0 || claveDia(m.creadoEn) !== claveDia(mensajes[i - 1].creadoEn);
            return (
              <Fragment key={m.id}>
                {nuevoDia && (
                  <div className="separador-dia">
                    <span>{etiquetaDia(m.creadoEn)}</span>
                  </div>
                )}
                <Burbuja m={m} onDetalle={setDetalle} />
              </Fragment>
            );
          })}
        </div>
      </div>

      {verDatos && <PanelDatos estado={estado} resumen={resumen} onCerrar={() => setVerDatos(false)} />}
      {detalle && <DetalleMensaje id={detalle} onCerrar={() => setDetalle(null)} />}
    </div>
  );
}
