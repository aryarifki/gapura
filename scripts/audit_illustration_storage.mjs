import dotenv from '../services/web/node_modules/dotenv/lib/main.js';
import pkg from '../services/web/node_modules/pg/lib/index.js';
import { orphanIllustrationFiles } from '../services/designer/illustrations.js';

dotenv.config({ quiet: true });
const pool = new pkg.Pool({ host: process.env.HME_DB_HOST || '127.0.0.1', port: Number(process.env.HME_DB_PORT || 5432), user: process.env.HME_DB_USER || 'hme_user', password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME || 'hme' });
try {
  const { rows } = await pool.query('SELECT local_path FROM media_assets WHERE local_path IS NOT NULL');
  const candidates = await orphanIllustrationFiles(new Set(rows.map((row) => row.local_path)));
  console.log(JSON.stringify({ mode: 'read_only', minimum_age_hours: 24, candidates, deleted: 0 }, null, 2));
} finally { await pool.end(); }
