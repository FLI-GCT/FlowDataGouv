/**
 * SIRENE SQLite database connection.
 *
 * Opens the database in readonly mode (imports happen via scripts/import-sirene.ts).
 * Gracefully disables SIRENE features if the database file doesn't exist.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.SIRENE_DB_PATH || path.join(process.cwd(), "data", "sirene.db");

let db: Database.Database | null = null;
let available = false;

function getDb(): Database.Database | null {
  if (db) return db;
  try {
    const fs = require("fs");
    if (!fs.existsSync(DB_PATH)) {
      console.warn(`[sirene] Database not found: ${DB_PATH}`);
      return null;
    }
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -200000"); // 200 MB page cache
    db.pragma("mmap_size = 268435456"); // 256 MB memory-mapped I/O
    available = true;
    console.log(`[sirene] Database opened: ${DB_PATH}`);
    return db;
  } catch (err) {
    console.warn(`[sirene] Cannot open database: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export function isAvailable(): boolean {
  if (available) return true;
  getDb();
  return available;
}

// ── Prepared statements (lazy-initialized) ──────────────────

let stmtSearchFts: Database.Statement | null = null;
let stmtSearchLike: Database.Statement | null = null;
let stmtGetBySiren: Database.Statement | null = null;
let stmtGetEtablissements: Database.Statement | null = null;
let stmtCountActive: Database.Statement | null = null;

export interface EntrepriseRow {
  siren: string;
  denomination: string;
  sigle: string | null;
  categorie_juridique: string | null;
  activite_principale: string | null;
  tranche_effectifs: string | null;
  date_creation: string | null;
  etat_administratif: string;
  economie_sociale_solidaire: string | null;
  societe_mission: string | null;
  adresse: string | null;
}

export interface EtablissementRow {
  siret: string;
  siren: string;
  nic: string;
  denomination: string | null;
  enseigne: string | null;
  activite_principale: string | null;
  adresse_numero: string | null;
  adresse_voie: string | null;
  adresse_code_postal: string | null;
  adresse_commune: string | null;
  tranche_effectifs: string | null;
  date_creation: string | null;
  etat_administratif: string;
  est_siege: number;
}

// ── Query functions ─────────────────────────────────────────

export function searchEntreprises(
  query: string,
  filters?: {
    etat_administratif?: string;
    activite_principale?: string;
    commune?: string;
  },
  limit = 20,
  offset = 0,
): { total: number; results: EntrepriseRow[] } {
  const d = getDb();
  if (!d) return { total: 0, results: [] };

  const isSiren = /^\d{9}$/.test(query.trim());

  if (isSiren) {
    // Exact SIREN lookup
    if (!stmtGetBySiren) {
      stmtGetBySiren = d.prepare("SELECT * FROM unite_legale WHERE siren = ?");
    }
    const row = stmtGetBySiren.get(query.trim()) as EntrepriseRow | undefined;
    return row ? { total: 1, results: [row] } : { total: 0, results: [] };
  }

  // Build WHERE clauses for filters
  const whereClauses: string[] = [];
  const whereParams: string[] = [];

  if (filters?.etat_administratif) {
    whereClauses.push("u.etat_administratif = ?");
    whereParams.push(filters.etat_administratif);
  }
  if (filters?.activite_principale) {
    whereClauses.push("u.activite_principale LIKE ?");
    whereParams.push(filters.activite_principale + "%");
  }

  const whereStr = whereClauses.length ? " AND " + whereClauses.join(" AND ") : "";

  // Try FTS5 first
  try {
    const ftsQuery = query.trim().replace(/['"]/g, "").split(/\s+/).map(w => `"${w}"`).join(" ");
    const sql = `
      SELECT u.*, rank
      FROM fts_entreprise f
      JOIN unite_legale u ON u.rowid = f.rowid
      WHERE fts_entreprise MATCH ?${whereStr}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `;
    const countSql = `
      SELECT COUNT(*) as cnt
      FROM fts_entreprise f
      JOIN unite_legale u ON u.rowid = f.rowid
      WHERE fts_entreprise MATCH ?${whereStr}
    `;
    const results = d.prepare(sql).all(ftsQuery, ...whereParams, limit, offset) as EntrepriseRow[];
    const countRow = d.prepare(countSql).get(ftsQuery, ...whereParams) as { cnt: number };
    return { total: countRow?.cnt || results.length, results };
  } catch {
    // FTS failed — fallback to LIKE
  }

  // Fallback: LIKE search
  const likeSql = `
    SELECT * FROM unite_legale u
    WHERE u.denomination LIKE ?${whereStr}
    ORDER BY u.denomination
    LIMIT ? OFFSET ?
  `;
  const likeCountSql = `
    SELECT COUNT(*) as cnt FROM unite_legale u
    WHERE u.denomination LIKE ?${whereStr}
  `;
  const likePattern = `%${query.trim()}%`;
  const results = d.prepare(likeSql).all(likePattern, ...whereParams, limit, offset) as EntrepriseRow[];
  const countRow = d.prepare(likeCountSql).get(likePattern, ...whereParams) as { cnt: number };
  return { total: countRow?.cnt || results.length, results };
}

export function getEntreprise(siren: string): EntrepriseRow | null {
  const d = getDb();
  if (!d) return null;
  if (!stmtGetBySiren) {
    stmtGetBySiren = d.prepare("SELECT * FROM unite_legale WHERE siren = ?");
  }
  return (stmtGetBySiren.get(siren) as EntrepriseRow) || null;
}

export function getEtablissements(siren: string): EtablissementRow[] {
  const d = getDb();
  if (!d) return [];
  if (!stmtGetEtablissements) {
    stmtGetEtablissements = d.prepare(
      "SELECT * FROM etablissement WHERE siren = ? ORDER BY est_siege DESC, date_creation DESC",
    );
  }
  return stmtGetEtablissements.all(siren) as EtablissementRow[];
}

export function getStats(): { entreprises: number; active: number } {
  const d = getDb();
  if (!d) return { entreprises: 0, active: 0 };
  if (!stmtCountActive) {
    stmtCountActive = d.prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN etat_administratif = 'A' THEN 1 ELSE 0 END) as active FROM unite_legale",
    );
  }
  const row = stmtCountActive.get() as { total: number; active: number };
  return { entreprises: row.total, active: row.active };
}
