#!/usr/bin/env node
/**
 * Professor CSV backup — append-only, de-duplicated by professor id (UUID PK).
 *
 * WHY: the Postgres data lives in a Docker volume that has been wiped more than
 * once (a stray `docker compose down -v` / prune destroys it). This script keeps
 * ONE master CSV outside Docker (in iCloud Drive) that only ever GROWS: every run
 * appends professors it hasn't seen before, so even if the DB is reset the CSV
 * still holds everyone discovered from day one onward.
 *
 * HOW dedup works: a hidden sidecar file lists every professor id already written
 * to the CSV (one comma/quote-free UUID per line). A row is appended only if its
 * id isn't in that set. We read the sidecar — never re-parse the CSV — so free-text
 * fields (match_reason, reply_notes, …) that contain commas/newlines can't corrupt
 * the dedup logic. Each appended row also records `exported_at` (when it was first
 * captured), so you can see day-1 vs day-N rows.
 *
 * Run: `node scripts/backup-professors.mjs`  (wrapper: scripts/backup-professors.sh)
 * Env: BACKUP_DIR overrides where the CSV is stored; PG_* override DB connection.
 */
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---- config -------------------------------------------------------------
const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// Load PG_* from .env without adding a dependency.
function loadEnv() {
  const file = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const DEFAULT_BACKUP_DIR = path.join(
  os.homedir(),
  'Library/Mobile Documents/com~apple~CloudDocs/phd-outreach-backups',
);
const BACKUP_DIR = process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR;
const CSV_PATH = path.join(BACKUP_DIR, 'professors_master.csv');
const IDS_PATH = path.join(BACKUP_DIR, '.professors_captured_ids.txt');

// Fixed column order. Add new columns at the END only, so old CSV rows stay aligned.
const COLUMNS = [
  'id', 'professor_name', 'university', 'country', 'department_lab', 'email',
  'linkedin_url', 'personal_website', 'social_links', 'matched_tags', 'source',
  'source_url', 'match_reason', 'funding_type', 'application_deadline', 'status',
  'date_discovered', 'date_emailed', 'followup_date', 'reply_notes',
  'personalized_snippet', 'personalized_at', 'apply_path', 'created_at', 'updated_at',
];
const HEADER = [...COLUMNS, 'exported_at'];

// ---- helpers ------------------------------------------------------------
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s;
  if (Array.isArray(value)) s = JSON.stringify(value);
  else if (typeof value === 'object' && !(value instanceof Date)) s = JSON.stringify(value);
  else if (value instanceof Date) s = value.toISOString();
  else s = String(value);
  // Quote if it contains comma, quote, CR or LF; escape embedded quotes by doubling.
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
}

// ---- main ---------------------------------------------------------------
async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const client = new Client({
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT || 5432),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    database: process.env.PG_DATABASE || 'phd_outreach',
    // Fail fast if the DB/Docker isn't up, instead of hanging the cron job.
    connectionTimeoutMillis: 8000,
  });

  try {
    await client.connect();
  } catch (err) {
    log(`SKIPPED: could not connect to Postgres (is Docker running?) — ${err.message}`);
    log(`Master CSV left untouched at ${CSV_PATH}`);
    process.exit(0); // exit clean so cron doesn't treat a down DB as a hard failure
  }

  try {
    const { rows } = await client.query(
      `SELECT ${COLUMNS.join(', ')} FROM professors ORDER BY created_at ASC`,
    );

    // Load the set of ids already captured (safe: plain UUIDs, one per line).
    const captured = new Set(
      fs.existsSync(IDS_PATH)
        ? fs.readFileSync(IDS_PATH, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)
        : [],
    );

    // First run: write the header once.
    if (!fs.existsSync(CSV_PATH)) {
      fs.writeFileSync(CSV_PATH, HEADER.join(',') + '\n');
    }

    const exportedAt = new Date().toISOString();
    let appended = 0;
    const newIds = [];
    let csvChunk = '';

    for (const row of rows) {
      if (captured.has(row.id)) continue; // already in the master CSV — skip
      const cells = COLUMNS.map((c) => csvCell(row[c]));
      cells.push(csvCell(exportedAt));
      csvChunk += cells.join(',') + '\n';
      newIds.push(row.id);
      appended++;
    }

    if (appended > 0) {
      fs.appendFileSync(CSV_PATH, csvChunk);
      fs.appendFileSync(IDS_PATH, newIds.join('\n') + '\n');
    }

    const totalInFile = captured.size + appended;
    log(
      `OK: ${rows.length} professors in DB, ${appended} new appended, ` +
        `${totalInFile} total rows now in master CSV.`,
    );
    log(`CSV: ${CSV_PATH}`);

    // Gentle heads-up for the future pagination step (page1/page2/…). Not automatic.
    if (totalInFile >= 5000) {
      log(`NOTE: master CSV has ${totalInFile} rows — consider splitting into pages.`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  log(`ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
