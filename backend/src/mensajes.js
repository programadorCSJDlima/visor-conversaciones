// Convierte el payload de WhatsApp guardado en chatbot_mensajes en algo que el
// frontend pueda pintar sin cargar el JSON completo (los flows pesan bastante).

function parseJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

function contenidoSaliente(m, p) {
  const i = p.interactive;
  if (!i) return { texto: p.text?.body ?? m.texto };

  const base = {
    encabezado: i.header?.text,
    texto: i.body?.text ?? m.texto,
    pie: i.footer?.text,
  };
  const params = i.action?.parameters ?? {};

  switch (i.type) {
    case 'button':
      return { ...base, botones: (i.action?.buttons ?? []).map((b) => b.reply?.title) };
    case 'list':
      return {
        ...base,
        boton: i.action?.button,
        secciones: (i.action?.sections ?? []).map((s) => ({
          titulo: s.title,
          filas: (s.rows ?? []).map((r) => ({ titulo: r.title, descripcion: r.description })),
        })),
      };
    case 'flow':
      return { ...base, boton: params.flow_cta, esFormulario: true };
    case 'cta_url':
      return { ...base, boton: params.display_text, url: params.url };
    default:
      return base;
  }
}

function contenidoEntrante(m, p) {
  const msg = p.messages?.[0] ?? {};
  const i = msg.interactive;

  if (i?.type === 'button_reply') return { texto: i.button_reply.title, seleccion: 'botón' };
  if (i?.type === 'list_reply') {
    return { texto: i.list_reply.title, descripcion: i.list_reply.description, seleccion: 'lista' };
  }
  if (i?.type === 'nfm_reply') {
    const respuesta = parseJson(i.nfm_reply?.response_json) ?? {};
    delete respuesta.flow_token;
    return { formulario: respuesta };
  }
  if (msg.button) return { texto: msg.button.text, seleccion: 'botón' };

  return { texto: msg.text?.body ?? m.texto };
}

export function aMensaje(m) {
  const p = m.payload && typeof m.payload === 'object' ? m.payload : {};
  return {
    id: m.id,
    direccion: m.direccion,
    tipo: m.tipo,
    paso: m.paso,
    estado: m.estado,
    error: m.error ? (parseJson(m.error)?.message ?? m.error) : null,
    creadoEn: m.creado_en,
    contenido: m.direccion === 'OUT' ? contenidoSaliente(m, p) : contenidoEntrante(m, p),
  };
}
