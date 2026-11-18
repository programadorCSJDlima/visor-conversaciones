import pg from 'pg';

// Acepta la misma URL JDBC que usa el chatbot (jdbc:postgresql://host:puerto/base)
function configDesdeUrl(url) {
  if (!url) throw new Error('Falta DB_URL en el .env');
  const u = new URL(url.replace(/^jdbc:/, ''));
  return {
    host: u.hostname,
    port: Number(u.port || 5432),
    database: u.pathname.replace(/^\//, ''),
  };
}

const conexion = {
  ...configDesdeUrl(process.env.DB_URL),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 8000,
};

export const pool = new pg.Pool({
  ...conexion,
  max: 5,
  // El visor solo lee las tablas del chatbot: cualquier INSERT/UPDATE/DELETE fallaría
  options: '-c default_transaction_read_only=on',
});

// Única conexión con escritura: la usa solo usuarios.js para su tabla visor_usuarios
export const poolUsuarios = new pg.Pool({ ...conexion, max: 2 });
