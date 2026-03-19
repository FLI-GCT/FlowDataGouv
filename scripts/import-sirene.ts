#!/usr/bin/env npx tsx
/**
 * Import SIRENE dataset (StockUniteLegale CSV) into SQLite.
 *
 * Usage:
 *   npx tsx scripts/import-sirene.ts [--db path/to/sirene.db] [--csv path/to/StockUniteLegale.csv]
 *
 * If --csv is not provided, downloads the latest from data.gouv.fr.
 */

import Database from "better-sqlite3";
import { createReadStream, existsSync, unlinkSync, renameSync } from "fs";
import { createInterface } from "readline";
import { createGunzip } from "zlib";
import path from "path";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";

// ── Config ───────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name: string) => {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
};

const DB_PATH = getArg("--db") || process.env.SIRENE_DB_PATH || path.join(process.cwd(), "data", "sirene.db");
const CSV_PATH = getArg("--csv") || null;
const DATASET_ID = "5b3cc551c751df4822526c1c"; // Base Sirene des entreprises
const TMP_DB = DB_PATH + ".tmp";

// ── Download CSV if needed ───────────────────────────────────

async function downloadCsv(): Promise<string> {
  if (CSV_PATH && existsSync(CSV_PATH)) {
    console.log(`Using provided CSV: ${CSV_PATH}`);
    return CSV_PATH;
  }

  // Find the StockUniteLegale CSV resource
  console.log("Fetching SIRENE dataset metadata...");
  const metaRes = await fetch(`https://www.data.gouv.fr/api/1/datasets/${DATASET_ID}/`);
  if (!metaRes.ok) throw new Error(`Dataset fetch failed: ${metaRes.status}`);
  const meta = await metaRes.json();

  const resource = meta.resources?.find(
    (r: { title: string; format: string }) =>
      r.title?.includes("StockUniteLegale") && !r.title?.includes("Historique") && r.format?.toLowerCase() === "csv",
  );

  if (!resource) {
    // Try ZIP
    const zipResource = meta.resources?.find(
      (r: { title: string }) => r.title?.includes("StockUniteLegale") && !r.title?.includes("Historique") && r.title?.includes(".zip"),
    );
    if (zipResource) {
      throw new Error(
        `Only ZIP format available. Download manually:\n  ${zipResource.url}\nThen run: npx tsx scripts/import-sirene.ts --csv path/to/StockUniteLegale_utf8.csv`,
      );
    }
    throw new Error("StockUniteLegale CSV not found in dataset resources");
  }

  const csvUrl = resource.url;
  const localPath = path.join(process.cwd(), "data", "StockUniteLegale_utf8.csv");
  console.log(`Downloading: ${csvUrl}`);
  console.log(`To: ${localPath}`);

  const dlRes = await fetch(csvUrl);
  if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);
  if (!dlRes.body) throw new Error("No response body");

  const writer = createWriteStream(localPath);
  // @ts-expect-error - Node.js stream compatibility
  await pipeline(dlRes.body, writer);
  console.log(`Downloaded: ${(await import("fs")).statSync(localPath).size / 1024 / 1024 | 0} MB`);
  return localPath;
}

// ── Create SQLite database ───────────────────────────────────

function createDatabase(): Database.Database {
  if (existsSync(TMP_DB)) unlinkSync(TMP_DB);
  const db = new Database(TMP_DB);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = OFF");
  db.pragma("cache_size = -500000"); // 500 MB during import
  db.pragma("temp_store = MEMORY");

  db.exec(`
    CREATE TABLE unite_legale (
      siren TEXT PRIMARY KEY,
      denomination TEXT,
      sigle TEXT,
      categorie_juridique TEXT,
      activite_principale TEXT,
      tranche_effectifs TEXT,
      date_creation TEXT,
      etat_administratif TEXT,
      economie_sociale_solidaire TEXT,
      societe_mission TEXT,
      adresse TEXT
    );
  `);

  return db;
}

// ── Parse CSV and insert ─────────────────────────────────────

async function importCsv(db: Database.Database, csvPath: string) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO unite_legale
    (siren, denomination, sigle, categorie_juridique, activite_principale,
     tranche_effectifs, date_creation, etat_administratif,
     economie_sociale_solidaire, societe_mission, adresse)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows: unknown[][]) => {
    for (const row of rows) insert.run(...row);
  });

  // Auto-detect if file is gzipped
  const isGz = csvPath.endsWith(".gz");
  const rawStream = createReadStream(csvPath);
  const inputStream = isGz ? rawStream.pipe(createGunzip()) : rawStream;

  const rl = createInterface({ input: inputStream, crlfDelay: Infinity });

  let headers: string[] = [];
  let batch: unknown[][] = [];
  let count = 0;
  const BATCH_SIZE = 10_000;

  // Column mapping
  const colIdx = (name: string) => headers.indexOf(name);

  for await (const line of rl) {
    if (!headers.length) {
      headers = line.split(",").map(h => h.trim().replace(/^"|"$/g, ""));
      console.log(`CSV columns: ${headers.length}`);
      continue;
    }

    // Simple CSV parse (handles quoted fields)
    const fields = parseCsvLine(line);
    if (fields.length < 5) continue;

    const siren = fields[colIdx("siren")] || "";
    if (!siren || siren.length !== 9) continue;

    const row = [
      siren,
      fields[colIdx("denominationUniteLegale")] || fields[colIdx("denominationUsuelleUniteLegale")] || "",
      fields[colIdx("sigleUniteLegale")] || null,
      fields[colIdx("categorieJuridiqueUniteLegale")] || null,
      fields[colIdx("activitePrincipaleUniteLegale")] || null,
      fields[colIdx("trancheEffectifsUniteLegale")] || null,
      fields[colIdx("dateCreationUniteLegale")] || null,
      fields[colIdx("etatAdministratifUniteLegale")] || "A",
      fields[colIdx("economieSocialeSolidaireUniteLegale")] || null,
      fields[colIdx("societeMissionUniteLegale")] || null,
      null, // adresse (will be enriched from etablissements later)
    ];

    batch.push(row);
    count++;

    if (batch.length >= BATCH_SIZE) {
      insertMany(batch);
      batch = [];
      if (count % 100_000 === 0) {
        process.stdout.write(`\r  ${(count / 1000).toFixed(0)}K rows imported...`);
      }
    }
  }

  if (batch.length) insertMany(batch);
  console.log(`\n  Total: ${count.toLocaleString()} rows imported`);
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ── Build indexes ────────────────────────────────────────────

function buildIndexes(db: Database.Database) {
  console.log("Building indexes...");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_denomination ON unite_legale(denomination);
    CREATE INDEX IF NOT EXISTS idx_activite ON unite_legale(activite_principale);
    CREATE INDEX IF NOT EXISTS idx_etat ON unite_legale(etat_administratif);
  `);

  console.log("Building FTS5 index...");
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_entreprise USING fts5(
      siren, denomination, sigle, activite_principale,
      content=unite_legale, content_rowid=rowid,
      tokenize='unicode61 remove_diacritics 2'
    );
    INSERT INTO fts_entreprise(fts_entreprise) VALUES('rebuild');
  `);
  console.log("FTS5 index built");
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("=== SIRENE Import ===\n");

  const csvPath = await downloadCsv();

  console.log("\nCreating database...");
  const db = createDatabase();

  console.log("Importing CSV...");
  const t0 = Date.now();
  await importCsv(db, csvPath);
  console.log(`  Import time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log("\nBuilding indexes...");
  const t1 = Date.now();
  buildIndexes(db);
  console.log(`  Index time: ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  // Stats
  const stats = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN etat_administratif = 'A' THEN 1 ELSE 0 END) as active FROM unite_legale").get() as { total: number; active: number };
  console.log(`\n  Total entreprises: ${stats.total.toLocaleString()}`);
  console.log(`  Active: ${stats.active.toLocaleString()}`);

  // Quick test
  const test = db.prepare("SELECT siren, denomination FROM unite_legale WHERE denomination LIKE '%SYSTEM%' LIMIT 5").all();
  console.log(`\n  Test search "SYSTEM": ${JSON.stringify(test)}`);

  db.close();

  // Atomic swap
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  renameSync(TMP_DB, DB_PATH);
  console.log(`\nDatabase ready: ${DB_PATH}`);

  const { statSync } = await import("fs");
  const size = statSync(DB_PATH).size;
  console.log(`  Size: ${(size / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
