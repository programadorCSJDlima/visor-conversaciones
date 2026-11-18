// Modo día / noche. La elección se recuerda en este navegador; si no hay ninguna, se usa la del sistema.
const CLAVE = 'visor.tema';

function guardado() {
  try {
    const t = localStorage.getItem(CLAVE);
    return t === 'dark' || t === 'light' ? t : null;
  } catch {
    return null;
  }
}

export function temaInicial() {
  return guardado() ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function aplicarTema(tema, recordar = false) {
  document.documentElement.dataset.theme = tema;
  if (!recordar) return;
  try {
    localStorage.setItem(CLAVE, tema);
  } catch {
    // sin almacenamiento local, el modo vale solo hasta recargar
  }
}
