import { useEffect, useState } from 'react';
import { api } from './api.js';
import Chat from './componentes/Chat.jsx';
import ListaConversaciones from './componentes/ListaConversaciones.jsx';

const REFRESCO_LISTA_MS = 15000;

// La conversación abierta vive en el hash (#/51999999999) para poder compartir el enlace
const leerHash = () => decodeURIComponent(location.hash.replace(/^#\/?/, '')) || null;

export default function App() {
  const [telefono, setTelefono] = useState(leerHash);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('');
  const [conversaciones, setConversaciones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const alCambiar = () => setTelefono(leerHash());
    window.addEventListener('hashchange', alCambiar);
    return () => window.removeEventListener('hashchange', alCambiar);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setFiltro(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => {
    let vivo = true;
    const cargar = () =>
      api
        .conversaciones(filtro)
        .then((r) => {
          if (!vivo) return;
          setConversaciones(r);
          setError(null);
        })
        .catch((e) => vivo && setError(e.message))
        .finally(() => vivo && setCargando(false));

    setCargando(true);
    cargar();
    const t = setInterval(cargar, REFRESCO_LISTA_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [filtro]);

  const resumen = conversaciones.find((c) => c.telefono === telefono);

  return (
    <div className={`app ${telefono ? 'con-chat' : ''}`}>
      <ListaConversaciones
        conversaciones={conversaciones}
        seleccionado={telefono}
        onSeleccionar={(t) => (location.hash = `/${t}`)}
        busqueda={busqueda}
        onBuscar={setBusqueda}
        cargando={cargando}
        error={error}
      />
      {telefono ? (
        <Chat key={telefono} telefono={telefono} resumen={resumen} onVolver={() => (location.hash = '')} />
      ) : (
        <div className="chat-vacio">
          <p>Selecciona una conversación para ver los mensajes</p>
        </div>
      )}
    </div>
  );
}
