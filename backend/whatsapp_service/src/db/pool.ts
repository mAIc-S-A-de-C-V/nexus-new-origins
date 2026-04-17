import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://nexus:nexus_pass@localhost:5432/nexus';

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

export async function runMigrations(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'migrations', '001_whatsapp_tables.sql'), 'utf-8');
  await pool.query(sql);
  console.log('[db] migrations applied');
}
