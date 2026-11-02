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

export const pool = new pg.Pool({
  ...configDesdeUrl(process.env.DB_URL),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  max: 5,
  connectionTimeoutMillis: 8000,
  // El visor solo lee: cualquier INSERT/UPDATE/DELETE fallaría
  options: '-c default_transaction_read_only=on',
});
