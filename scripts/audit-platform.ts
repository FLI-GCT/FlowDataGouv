#!/usr/bin/env npx tsx
/**
 * Audit complet de la plateforme data.gouv.fr
 *
 * Usage:
 *   npx tsx scripts/audit-platform.ts [options]
 *
 * Options:
 *   --sample N       Nombre de datasets à tester (défaut: 1000)
 *   --full           Scan complet (~73k datasets)
 *   --skip-health    Phase 1 uniquement (pas de HEAD requests)
 *   --concurrency N  Requêtes parallèles (défaut: 20)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from "fs";
import path from "path";

// ── Types ────────────────────────────────────────────────────

interface StoredEnrichment {
  cat: string;
  sub: string;
  sub2?: string;
  geo: string;
  area?: string;
  sum: string;
  th: string[];
  q: number;
  at: string;
}

interface StoredDataset {
  id: string;
  title: string;
  org: string;
  type: "d" | "a";
  tags: string[];
  v: number;
  dl: number;
  r: number;
  f: number;
  lic?: string;
  freq?: string;
  mod?: string;
  url?: string;
  desc?: string;
  e?: StoredEnrichment;
  ef?: number;
}

interface Store {
  v: number;
  fetchedAt?: string;
  ds: Record<string, StoredDataset>;
}

interface AuditConfig {
  sampleSize: number;
  fullScan: boolean;
  skipHealth: boolean;
  concurrency: number;
  storePath: string;
  outputDir: string;
}

// Phase 1 types
interface FreshnessBucket { label: string; count: number; pct: number; }
interface FreshnessAnalysis {
  buckets: FreshnessBucket[];
  stalenessScore: number;
  medianAgeDays: number;
  unknownCount: number;
}

interface OrgEntry { org: string; datasetCount: number; totalViews: number; totalDownloads: number; }
interface StoppedOrg { org: string; datasetCount: number; lastModified: string; }
interface OrgActivity {
  top20: OrgEntry[];
  stoppedOrgs: StoppedOrg[];
  totalOrgs: number;
  orgsBySize: { single: number; small: number; medium: number; large: number; };
}

interface TemporalTrends {
  byYear: { year: number; count: number; cumulative: number; }[];
  byYearMonth: { ym: string; count: number; }[];
  peakMonth: string;
  peakYear: number;
}

interface QualityDistribution {
  overall: Record<number, number>;
  byCategory: Record<string, { avg: number; count: number; }>;
  byGeo: Record<string, { avg: number; count: number; }>;
  bestOrgs: { org: string; avgQ: number; count: number; }[];
  worstOrgs: { org: string; avgQ: number; count: number; }[];
}

interface CategoryGeoDistribution {
  byCategory: { cat: string; count: number; pct: number; }[];
  byGeo: { geo: string; count: number; pct: number; }[];
  topAreas: { area: string; count: number; geo: string; }[];
}

interface FreqCompliance { freq: string; declaredCount: number; avgActualGapDays: number; expectedMaxDays: number; complianceRate: number; }
interface LicenseFreqAnalysis {
  licenses: { lic: string; count: number; pct: number; }[];
  frequencies: { freq: string; count: number; pct: number; }[];
  promiseVsReality: FreqCompliance[];
}

interface PercentileStats { median: number; p75: number; p90: number; p99: number; max: number; }
interface EngagementMetrics {
  views: PercentileStats;
  downloads: PercentileStats;
  mostDownloaded: { id: string; title: string; org: string; dl: number; }[];
  ghostDatasets: { count: number; pct: number; };
}

interface TagStats {
  topTags: { tag: string; count: number; }[];
  totalUniqueTags: number;
  avgTagsPerDataset: number;
  untaggedCount: number;
}

interface ContentCoverage {
  withDescription: number;
  withDescriptionPct: number;
  avgDescLength: number;
  withEnrichment: number;
  withEnrichmentPct: number;
  withTags: number;
  withTagsPct: number;
  withLicense: number;
  withLicensePct: number;
  withFrequency: number;
  withFrequencyPct: number;
}

interface CatalogAnalysis {
  totalDatasets: number;
  totalApis: number;
  freshness: FreshnessAnalysis;
  orgActivity: OrgActivity;
  temporal: TemporalTrends;
  quality: QualityDistribution;
  categoryGeo: CategoryGeoDistribution;
  licenseFreq: LicenseFreqAnalysis;
  engagement: EngagementMetrics;
  tags: TagStats;
  coverage: ContentCoverage;
}

// Phase 2 types
type ResourceStatus = "alive" | "redirect" | "dead" | "server_error" | "timeout" | "dns_error" | "intranet" | "other_error";

interface ResourceCheck {
  datasetId: string;
  resourceId: string;
  url: string;
  format?: string;
  status: ResourceStatus;
  httpCode?: number;
  responseTimeMs: number;
  contentType?: string;
  contentLength?: number;
  error?: string;
}

interface HealthByFormat { format: string; total: number; alive: number; healthRate: number; }
interface HealthByOrg { org: string; total: number; dead: number; healthRate: number; }
interface HealthByAge { bucket: string; total: number; alive: number; healthRate: number; }

interface HealthSummary {
  totalResources: number;
  datasetsChecked: number;
  datasetsWithNoResources: number;
  avgResourcesPerDataset: number;
  byStatus: Record<ResourceStatus, number>;
  overallHealthRate: number;
  byFormat: HealthByFormat[];
  worstOrgs: HealthByOrg[];
  byAge: HealthByAge[];
  avgResponseTimeMs: number;
  p95ResponseTimeMs: number;
  elapsedSeconds: number;
}

interface AuditResult {
  generatedAt: string;
  elapsedSeconds: number;
  config: AuditConfig;
  catalog: CatalogAnalysis;
  health?: HealthSummary;
  resourceChecks?: ResourceCheck[];
}

// ── CLI ──────────────────────────────────────────────────────

function parseArgs(): AuditConfig {
  const args = process.argv.slice(2);
  const getArg = (name: string) => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
  };
  return {
    sampleSize: parseInt(getArg("--sample") || "1000", 10),
    fullScan: args.includes("--full"),
    skipHealth: args.includes("--skip-health"),
    concurrency: parseInt(getArg("--concurrency") || "20", 10),
    storePath: path.join(process.cwd(), "data", "store.json"),
    outputDir: path.join(process.cwd(), "data", "audit"),
  };
}

// ── Utilities ────────────────────────────────────────────────

function log(msg: string) { process.stderr.write(msg + "\n"); }

function progress(current: number, total: number, label: string, startTime?: number) {
  let eta = "";
  if (startTime && current > 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    const remaining = (elapsed / current) * (total - current);
    if (remaining > 60) eta = ` | ETA ${Math.round(remaining / 60)}min`;
    else eta = ` | ETA ${Math.round(remaining)}s`;
  }
  process.stderr.write(`\r  [${current}/${total}] ${label}${eta}      `);
  if (current === total) process.stderr.write("\n");
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round(n / total * 10000) / 100 : 0;
}

function daysSince(isoDate: string, now: Date): number {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return -1;
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}

function isValidYear(isoDate: string): boolean {
  const d = new Date(isoDate);
  const y = d.getFullYear();
  return !isNaN(y) && y >= 1990 && y <= new Date().getFullYear() + 1;
}

function frequencyToMaxDays(freq: string): number | null {
  const map: Record<string, number> = {
    daily: 2, weekly: 10, biweekly: 18, semimonthly: 18,
    monthly: 35, bimonthly: 65, quarterly: 100,
    semiannual: 200, annual: 400, biennial: 800,
  };
  return map[freq] ?? null;
}

function fisherYatesSample<T>(arr: T[], n: number): T[] {
  const a = [...arr];
  const len = Math.min(n, a.length);
  for (let i = 0; i < len; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, len);
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return "invalid-url"; }
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_HEADERS = [
  "dataset_id", "dataset_title", "organization", "dataset_last_modified",
  "resource_id", "resource_url", "domain", "format",
  "status", "http_code", "response_time_ms", "content_type", "content_length", "error",
].join(",") + "\n";

function checkToCsvRow(c: ResourceCheck, ds?: StoredDataset): string {
  return [
    c.datasetId,
    csvEscape((ds?.title || "").slice(0, 120)),
    csvEscape((ds?.org || "").slice(0, 80)),
    ds?.mod?.split("T")[0] || "",
    c.resourceId,
    csvEscape(c.url),
    extractDomain(c.url),
    c.format || "",
    c.status,
    c.httpCode?.toString() || "",
    c.responseTimeMs.toString(),
    c.contentType || "",
    c.contentLength?.toString() || "",
    csvEscape((c.error || "").slice(0, 200)),
  ].join(",") + "\n";
}

function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>(r => queue.push(r));
    active++;
    try { return await fn(); }
    finally { active--; queue.shift()?.(); }
  };
}

// ── Phase 1: Catalog Analysis ────────────────────────────────

function analyzeFreshness(datasets: StoredDataset[], now: Date): FreshnessAnalysis {
  const bucketDefs = [
    { label: "< 1 mois", maxDays: 30, weight: 0 },
    { label: "1-3 mois", maxDays: 90, weight: 15 },
    { label: "3-6 mois", maxDays: 180, weight: 30 },
    { label: "6-12 mois", maxDays: 365, weight: 50 },
    { label: "1-2 ans", maxDays: 730, weight: 70 },
    { label: "2-5 ans", maxDays: 1825, weight: 85 },
    { label: "5+ ans", maxDays: Infinity, weight: 100 },
  ];

  const counts = new Array(bucketDefs.length).fill(0);
  let unknownCount = 0;
  const ages: number[] = [];

  for (const ds of datasets) {
    if (!ds.mod || !isValidYear(ds.mod)) { unknownCount++; continue; }
    const age = daysSince(ds.mod, now);
    if (age < 0) { unknownCount++; continue; }
    ages.push(age);
    for (let i = 0; i < bucketDefs.length; i++) {
      if (age <= bucketDefs[i].maxDays) { counts[i]++; break; }
    }
  }

  const total = datasets.length;
  const buckets = bucketDefs.map((b, i) => ({ label: b.label, count: counts[i], pct: pct(counts[i], total) }));

  let weightedSum = 0, weightedCount = 0;
  for (let i = 0; i < bucketDefs.length; i++) {
    weightedSum += counts[i] * bucketDefs[i].weight;
    weightedCount += counts[i];
  }
  weightedSum += unknownCount * 80;
  weightedCount += unknownCount;

  ages.sort((a, b) => a - b);

  return {
    buckets,
    stalenessScore: weightedCount > 0 ? Math.round(weightedSum / weightedCount * 10) / 10 : 0,
    medianAgeDays: percentile(ages, 50),
    unknownCount,
  };
}

function analyzeOrgActivity(datasets: StoredDataset[], now: Date): OrgActivity {
  const orgs = new Map<string, { count: number; views: number; downloads: number; lastMod: string; }>();

  for (const ds of datasets) {
    const orgName = ds.org || "(utilisateur individuel)";
    const entry = orgs.get(orgName) || { count: 0, views: 0, downloads: 0, lastMod: "" };
    entry.count++;
    entry.views += ds.v;
    entry.downloads += ds.dl;
    if (ds.mod && ds.mod > entry.lastMod) entry.lastMod = ds.mod;
    orgs.set(orgName, entry);
  }

  const entries = [...orgs.entries()];
  const top20 = entries
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([org, e]) => ({ org, datasetCount: e.count, totalViews: e.views, totalDownloads: e.downloads }));

  const twoYearsAgo = new Date(now);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const cutoff = twoYearsAgo.toISOString();

  const stoppedOrgs = entries
    .filter(([, e]) => e.lastMod && e.lastMod < cutoff && e.count >= 3)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 50)
    .map(([org, e]) => ({ org, datasetCount: e.count, lastModified: e.lastMod }));

  let single = 0, small = 0, medium = 0, large = 0;
  for (const [, e] of entries) {
    if (e.count === 1) single++;
    else if (e.count <= 10) small++;
    else if (e.count <= 100) medium++;
    else large++;
  }

  return { top20, stoppedOrgs, totalOrgs: orgs.size, orgsBySize: { single, small, medium, large } };
}

function analyzeTemporalTrends(datasets: StoredDataset[]): TemporalTrends {
  const byYear = new Map<number, number>();
  const byYM = new Map<string, number>();

  for (const ds of datasets) {
    if (!ds.mod || !isValidYear(ds.mod)) continue;
    const d = new Date(ds.mod);
    const y = d.getFullYear();
    const ym = `${y}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byYear.set(y, (byYear.get(y) || 0) + 1);
    byYM.set(ym, (byYM.get(ym) || 0) + 1);
  }

  const years = [...byYear.entries()].sort((a, b) => a[0] - b[0]);
  let cumulative = 0;
  const byYearArr = years.map(([year, count]) => {
    cumulative += count;
    return { year, count, cumulative };
  });

  const yms = [...byYM.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const byYearMonth = yms.map(([ym, count]) => ({ ym, count }));

  let peakMonth = "", peakMonthCount = 0;
  for (const [ym, count] of byYM) {
    if (count > peakMonthCount) { peakMonth = ym; peakMonthCount = count; }
  }

  let peakYear = 0, peakYearCount = 0;
  for (const [y, count] of byYear) {
    if (count > peakYearCount) { peakYear = y; peakYearCount = count; }
  }

  return { byYear: byYearArr, byYearMonth, peakMonth, peakYear };
}

function analyzeQuality(datasets: StoredDataset[]): QualityDistribution {
  const overall: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const byCat = new Map<string, { sum: number; count: number; }>();
  const byGeo = new Map<string, { sum: number; count: number; }>();
  const byOrg = new Map<string, { sum: number; count: number; }>();

  for (const ds of datasets) {
    if (!ds.e) continue;
    const q = ds.e.q;
    if (q >= 1 && q <= 5) overall[q]++;

    const catEntry = byCat.get(ds.e.cat) || { sum: 0, count: 0 };
    catEntry.sum += q; catEntry.count++;
    byCat.set(ds.e.cat, catEntry);

    const geoEntry = byGeo.get(ds.e.geo) || { sum: 0, count: 0 };
    geoEntry.sum += q; geoEntry.count++;
    byGeo.set(ds.e.geo, geoEntry);

    const orgEntry = byOrg.get(ds.org) || { sum: 0, count: 0 };
    orgEntry.sum += q; orgEntry.count++;
    byOrg.set(ds.org, orgEntry);
  }

  const byCategoryObj: Record<string, { avg: number; count: number; }> = {};
  for (const [cat, e] of byCat) byCategoryObj[cat] = { avg: Math.round(e.sum / e.count * 100) / 100, count: e.count };

  const byGeoObj: Record<string, { avg: number; count: number; }> = {};
  for (const [geo, e] of byGeo) byGeoObj[geo] = { avg: Math.round(e.sum / e.count * 100) / 100, count: e.count };

  const orgArr = [...byOrg.entries()]
    .filter(([, e]) => e.count >= 5)
    .map(([org, e]) => ({ org, avgQ: Math.round(e.sum / e.count * 100) / 100, count: e.count }));

  const bestOrgs = [...orgArr].sort((a, b) => b.avgQ - a.avgQ).slice(0, 20);
  const worstOrgs = [...orgArr].sort((a, b) => a.avgQ - b.avgQ).slice(0, 20);

  return { overall, byCategory: byCategoryObj, byGeo: byGeoObj, bestOrgs, worstOrgs };
}

function analyzeCategoryGeo(datasets: StoredDataset[]): CategoryGeoDistribution {
  const catMap = new Map<string, number>();
  const geoMap = new Map<string, number>();
  const areaMap = new Map<string, { count: number; geo: string; }>();

  for (const ds of datasets) {
    if (!ds.e) continue;
    catMap.set(ds.e.cat, (catMap.get(ds.e.cat) || 0) + 1);
    geoMap.set(ds.e.geo, (geoMap.get(ds.e.geo) || 0) + 1);
    if (ds.e.area) {
      const entry = areaMap.get(ds.e.area) || { count: 0, geo: ds.e.geo };
      entry.count++;
      areaMap.set(ds.e.area, entry);
    }
  }

  const total = datasets.length;
  const byCategory = [...catMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => ({ cat, count, pct: pct(count, total) }));

  const byGeo = [...geoMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([geo, count]) => ({ geo, count, pct: pct(count, total) }));

  const topAreas = [...areaMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 50)
    .map(([area, e]) => ({ area, count: e.count, geo: e.geo }));

  return { byCategory, byGeo, topAreas };
}

function analyzeLicenseFreq(datasets: StoredDataset[], now: Date): LicenseFreqAnalysis {
  const licMap = new Map<string, number>();
  const freqMap = new Map<string, number>();
  const freqGaps = new Map<string, { gaps: number[]; expected: number; }>();

  for (const ds of datasets) {
    const lic = ds.lic || "non spécifiée";
    licMap.set(lic, (licMap.get(lic) || 0) + 1);

    const freq = ds.freq || "inconnu";
    freqMap.set(freq, (freqMap.get(freq) || 0) + 1);

    if (ds.freq && ds.mod) {
      const maxDays = frequencyToMaxDays(ds.freq);
      if (maxDays !== null) {
        const entry = freqGaps.get(ds.freq) || { gaps: [], expected: maxDays };
        entry.gaps.push(daysSince(ds.mod, now));
        freqGaps.set(ds.freq, entry);
      }
    }
  }

  const total = datasets.length;
  const licenses = [...licMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([lic, count]) => ({ lic, count, pct: pct(count, total) }));

  const frequencies = [...freqMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([freq, count]) => ({ freq, count, pct: pct(count, total) }));

  const promiseVsReality: FreqCompliance[] = [];
  for (const [freq, entry] of freqGaps) {
    const { gaps, expected } = entry;
    const avgGap = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    const compliant = gaps.filter(g => g <= expected).length;
    promiseVsReality.push({
      freq,
      declaredCount: gaps.length,
      avgActualGapDays: avgGap,
      expectedMaxDays: expected,
      complianceRate: pct(compliant, gaps.length),
    });
  }
  promiseVsReality.sort((a, b) => b.declaredCount - a.declaredCount);

  return { licenses, frequencies, promiseVsReality };
}

function analyzeEngagement(datasets: StoredDataset[]): EngagementMetrics {
  const views = datasets.map(d => d.v).sort((a, b) => a - b);
  const downloads = datasets.map(d => d.dl).sort((a, b) => a - b);

  const viewStats: PercentileStats = {
    median: percentile(views, 50), p75: percentile(views, 75),
    p90: percentile(views, 90), p99: percentile(views, 99),
    max: views[views.length - 1] || 0,
  };
  const dlStats: PercentileStats = {
    median: percentile(downloads, 50), p75: percentile(downloads, 75),
    p90: percentile(downloads, 90), p99: percentile(downloads, 99),
    max: downloads[downloads.length - 1] || 0,
  };

  const mostDownloaded = [...datasets]
    .sort((a, b) => b.dl - a.dl)
    .slice(0, 20)
    .map(d => ({ id: d.id, title: d.title, org: d.org, dl: d.dl }));

  const ghostCount = datasets.filter(d => d.v === 0 && d.dl === 0).length;

  return {
    views: viewStats,
    downloads: dlStats,
    mostDownloaded,
    ghostDatasets: { count: ghostCount, pct: pct(ghostCount, datasets.length) },
  };
}

function analyzeTags(datasets: StoredDataset[]): TagStats {
  const tagMap = new Map<string, number>();
  let totalTags = 0;
  let untaggedCount = 0;

  for (const ds of datasets) {
    if (!ds.tags || ds.tags.length === 0) { untaggedCount++; continue; }
    totalTags += ds.tags.length;
    for (const tag of ds.tags) {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    }
  }

  const topTags = [...tagMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([tag, count]) => ({ tag, count }));

  return {
    topTags,
    totalUniqueTags: tagMap.size,
    avgTagsPerDataset: datasets.length > 0 ? Math.round(totalTags / datasets.length * 10) / 10 : 0,
    untaggedCount,
  };
}

function analyzeContentCoverage(datasets: StoredDataset[]): ContentCoverage {
  const total = datasets.length;
  let withDesc = 0, totalDescLen = 0, withEnrich = 0, withTags = 0, withLic = 0, withFreq = 0;

  for (const ds of datasets) {
    if (ds.desc && ds.desc.trim().length > 0) { withDesc++; totalDescLen += ds.desc.length; }
    if (ds.e) withEnrich++;
    if (ds.tags && ds.tags.length > 0) withTags++;
    if (ds.lic) withLic++;
    if (ds.freq && ds.freq !== "unknown") withFreq++;
  }

  return {
    withDescription: withDesc,
    withDescriptionPct: pct(withDesc, total),
    avgDescLength: withDesc > 0 ? Math.round(totalDescLen / withDesc) : 0,
    withEnrichment: withEnrich,
    withEnrichmentPct: pct(withEnrich, total),
    withTags: withTags,
    withTagsPct: pct(withTags, total),
    withLicense: withLic,
    withLicensePct: pct(withLic, total),
    withFrequency: withFreq,
    withFrequencyPct: pct(withFreq, total),
  };
}

function runCatalogAnalysis(allItems: StoredDataset[]): CatalogAnalysis {
  const now = new Date();
  const datasets = allItems.filter(d => d.type === "d");
  const apis = allItems.filter(d => d.type === "a");

  log(`  Datasets: ${datasets.length} | APIs: ${apis.length}`);

  log("  [1/9] Fraîcheur...");
  const freshness = analyzeFreshness(datasets, now);
  log("  [2/9] Organisations...");
  const orgActivity = analyzeOrgActivity(datasets, now);
  log("  [3/9] Tendances temporelles...");
  const temporal = analyzeTemporalTrends(datasets);
  log("  [4/9] Qualité...");
  const quality = analyzeQuality(datasets);
  log("  [5/9] Catégories & géographie...");
  const categoryGeo = analyzeCategoryGeo(datasets);
  log("  [6/9] Licences & fréquences...");
  const licenseFreq = analyzeLicenseFreq(datasets, now);
  log("  [7/9] Engagement...");
  const engagement = analyzeEngagement(datasets);
  log("  [8/9] Tags...");
  const tags = analyzeTags(datasets);
  log("  [9/9] Couverture des métadonnées...");
  const coverage = analyzeContentCoverage(datasets);

  return {
    totalDatasets: datasets.length,
    totalApis: apis.length,
    freshness, orgActivity, temporal, quality, categoryGeo, licenseFreq, engagement, tags, coverage,
  };
}

// ── Phase 2: Resource Health Check ───────────────────────────

let interrupted = false;

async function fetchResources(datasetId: string): Promise<{ id: string; url: string; format: string; }[]> {
  try {
    const res = await fetch(
      `https://www.data.gouv.fr/api/1/datasets/${datasetId}/?mask=resources{id,url,format}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return [];
    const json = await res.json() as { resources?: { id: string; url: string; format: string; }[] };
    return (json.resources || []).map(r => ({ id: r.id, url: r.url, format: (r.format || "").toLowerCase() }));
  } catch {
    return [];
  }
}

async function checkResource(url: string, method: "HEAD" | "GET" = "HEAD", timeoutMs = 10000): Promise<{
  status: ResourceStatus; httpCode?: number; responseTimeMs: number;
  contentType?: string; contentLength?: number; error?: string;
}> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      redirect: "manual",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    const code = res.status;

    // For GET requests, abort the body download immediately — we only needed the status
    if (method === "GET") {
      try { res.body?.cancel(); } catch { /* ignore */ }
    }

    let status: ResourceStatus;
    if (code >= 200 && code < 300) status = "alive";
    else if (code >= 300 && code < 400) status = "redirect";
    else if (code >= 400 && code < 500) status = "dead";
    else status = "server_error";

    return {
      status, httpCode: code, responseTimeMs: elapsed,
      contentType: res.headers.get("content-type") || undefined,
      contentLength: res.headers.has("content-length") ? parseInt(res.headers.get("content-length")!) : undefined,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    let status: ResourceStatus = "other_error";
    if (msg.includes("abort") || msg.includes("timeout") || msg.includes("Timeout")) status = "timeout";
    else if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) status = "dns_error";
    return { status, responseTimeMs: elapsed, error: msg };
  }
}

const INTRANET_PATTERNS = [
  ".e2.rie.gouv.fr",    // Réseau Interministériel de l'État
  ".rie.gouv.fr",       // RIE intranet
  ".intra.gouv.fr",     // Intranet gouvernemental
  "intranet.",          // Generic intranet
  ".local",             // Local network
  "localhost",
];

function isIntranetUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return INTRANET_PATTERNS.some(p => host.includes(p));
  } catch { return false; }
}

async function checkWithRetry(url: string): Promise<Awaited<ReturnType<typeof checkResource>>> {
  // Skip intranet URLs — they're inaccessible from outside by design
  if (isIntranetUrl(url)) {
    return { status: "intranet", responseTimeMs: 0 };
  }

  // Try HEAD first
  const result = await checkResource(url, "HEAD");

  // If HEAD fails with error (not 4xx dead link), retry with GET
  if (result.status === "other_error" || result.status === "server_error") {
    const getResult = await checkResource(url, "GET");
    return getResult;
  }

  // If timeout, retry once with HEAD
  if (result.status === "timeout") {
    await new Promise(r => setTimeout(r, 500));
    return checkResource(url, "HEAD");
  }

  return result;
}

async function runHealthCheck(
  datasets: StoredDataset[],
  config: AuditConfig,
  datasetMap: Map<string, StoredDataset>,
  catalog?: CatalogAnalysis,
): Promise<{ summary: HealthSummary; checks: ResourceCheck[]; }> {
  const sample = config.fullScan ? datasets : fisherYatesSample(datasets, config.sampleSize);
  const total = sample.length;
  log(`  Échantillon: ${total} datasets`);

  if (total > 5000) {
    const estimate = Math.round(total * 5 * 0.6 / 60); // ~5 resources/dataset, ~0.6s each
    log(`  ⚠ Scan de ${total} datasets — estimation: ~${estimate} minutes`);
  }

  // Open CSV stream for real-time writing
  const outputDir = config.outputDir;
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const date = new Date().toISOString().split("T")[0];
  const csvPath = path.join(outputDir, `checks-${date}.csv`);
  const csvStream = createWriteStream(csvPath, { encoding: "utf-8" });
  csvStream.write(CSV_HEADERS);
  log(`  CSV: ${csvPath}`);

  const limiter = createLimiter(config.concurrency);
  const checks: ResourceCheck[] = [];
  let processed = 0;
  let datasetsWithNoResources = 0;
  let totalResourceCount = 0;
  const startTime = Date.now();

  // Process datasets in parallel batches
  const batchSize = Math.min(config.concurrency, total);
  let i = 0;

  while (i < total && !interrupted) {
    const batch = sample.slice(i, i + batchSize);
    const batchPromises = batch.map(ds =>
      limiter(async () => {
        const resources = await fetchResources(ds.id);
        if (resources.length === 0) {
          datasetsWithNoResources++;
          return [];
        }
        totalResourceCount += resources.length;

        const headResults = await Promise.all(
          resources.map(async res => {
            const result = await checkWithRetry(res.url);
            const check: ResourceCheck = {
              datasetId: ds.id, resourceId: res.id, url: res.url, format: res.format,
              status: result.status, httpCode: result.httpCode, responseTimeMs: result.responseTimeMs,
              contentType: result.contentType, contentLength: result.contentLength, error: result.error,
            };
            // Stream to CSV immediately
            csvStream.write(checkToCsvRow(check, ds));
            return check;
          }),
        );
        return headResults;
      }),
    );

    const batchResults = await Promise.all(batchPromises);
    for (const results of batchResults) {
      checks.push(...results);
      processed++;
    }
    i += batchSize;

    progress(Math.min(processed, total), total, `datasets (${checks.length} ressources)`, startTime);

    // Checkpoint every 500 datasets for long runs
    if (catalog && processed > 0 && processed % 500 === 0 && total > 500) {
      const partialSummary = buildHealthSummary(checks, processed, datasetsWithNoResources, totalResourceCount, datasetMap, startTime);
      saveCheckpoint(config, catalog, partialSummary, checks);
    }
  }

  // Close CSV stream
  await new Promise<void>(resolve => csvStream.end(resolve));
  log(`  CSV écrit: ${checks.length} lignes → ${csvPath}`);

  return {
    summary: buildHealthSummary(checks, processed, datasetsWithNoResources, totalResourceCount, datasetMap, startTime),
    checks,
  };
}

function buildHealthSummary(
  checks: ResourceCheck[],
  processed: number,
  datasetsWithNoResources: number,
  totalResourceCount: number,
  datasetMap: Map<string, StoredDataset>,
  startTime: number,
): HealthSummary {
  const byStatus: Record<ResourceStatus, number> = {
    alive: 0, redirect: 0, dead: 0, server_error: 0, timeout: 0, dns_error: 0, intranet: 0, other_error: 0,
  };
  const formatStats = new Map<string, { total: number; alive: number; }>();
  const orgStats = new Map<string, { total: number; dead: number; }>();
  const responseTimes: number[] = [];

  for (const c of checks) {
    byStatus[c.status]++;
    if (c.status !== "intranet") responseTimes.push(c.responseTimeMs);

    // Skip intranet for format/org stats
    if (c.status === "intranet") continue;

    const fmt = c.format || "inconnu";
    const fEntry = formatStats.get(fmt) || { total: 0, alive: 0 };
    fEntry.total++;
    if (c.status === "alive" || c.status === "redirect") fEntry.alive++;
    formatStats.set(fmt, fEntry);

    const ds = datasetMap.get(c.datasetId);
    const orgName = ds?.org || "inconnu";
    const oEntry = orgStats.get(orgName) || { total: 0, dead: 0 };
    oEntry.total++;
    if (c.status === "dead" || c.status === "server_error" || c.status === "dns_error") oEntry.dead++;
    orgStats.set(orgName, oEntry);
  }

  responseTimes.sort((a, b) => a - b);
  const aliveCount = byStatus.alive + byStatus.redirect;
  const testableCount = checks.length - byStatus.intranet;

  const byFormat = [...formatStats.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 30)
    .map(([format, e]) => ({ format, total: e.total, alive: e.alive, healthRate: pct(e.alive, e.total) }));

  const worstOrgs = [...orgStats.entries()]
    .filter(([, e]) => e.total >= 3 && e.dead > 0)
    .sort((a, b) => b[1].dead - a[1].dead)
    .slice(0, 30)
    .map(([org, e]) => ({ org, total: e.total, dead: e.dead, healthRate: pct(e.total - e.dead, e.total) }));

  const now = new Date();
  const ageBuckets = [
    { label: "< 1 an", maxDays: 365 },
    { label: "1-3 ans", maxDays: 1095 },
    { label: "3-5 ans", maxDays: 1825 },
    { label: "5+ ans", maxDays: Infinity },
  ];
  const ageStats = ageBuckets.map(b => ({ ...b, total: 0, alive: 0 }));

  for (const c of checks) {
    if (c.status === "intranet") continue;
    const ds = datasetMap.get(c.datasetId);
    if (!ds?.mod) continue;
    const age = daysSince(ds.mod, now);
    if (age < 0) continue;
    for (const bucket of ageStats) {
      if (age <= bucket.maxDays) {
        bucket.total++;
        if (c.status === "alive" || c.status === "redirect") bucket.alive++;
        break;
      }
    }
  }

  const byAge = ageStats.map(b => ({
    bucket: b.label, total: b.total, alive: b.alive, healthRate: pct(b.alive, b.total),
  }));

  const elapsed = (Date.now() - startTime) / 1000;

  return {
    totalResources: checks.length,
    datasetsChecked: processed,
    datasetsWithNoResources,
    avgResourcesPerDataset: processed > 0 ? Math.round(totalResourceCount / (processed - datasetsWithNoResources || 1) * 10) / 10 : 0,
    byStatus,
    overallHealthRate: pct(aliveCount, testableCount),
    byFormat, worstOrgs, byAge,
    avgResponseTimeMs: responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0,
    p95ResponseTimeMs: percentile(responseTimes, 95),
    elapsedSeconds: Math.round(elapsed),
  };
}

// ── Phase 3: Report Generation ───────────────────────────────

function generateMarkdown(result: AuditResult): string {
  const { catalog: c, health: h } = result;
  const lines: string[] = [];
  const ln = (s = "") => lines.push(s);
  const table = (headers: string[], rows: (string | number)[][]) => {
    ln("| " + headers.join(" | ") + " |");
    ln("| " + headers.map(() => "---").join(" | ") + " |");
    for (const row of rows) ln("| " + row.join(" | ") + " |");
    ln();
  };

  ln("# Audit de la plateforme data.gouv.fr");
  ln(`> Généré le ${result.generatedAt.split("T")[0]} | ${c.totalDatasets.toLocaleString()} jeux de données + ${c.totalApis} APIs | Durée: ${formatDuration(result.elapsedSeconds)}`);
  ln();

  // Résumé exécutif
  ln("## Résumé exécutif");
  ln(`- **Score de péremption** : ${c.freshness.stalenessScore}/100 (0=frais, 100=obsolète)`);
  ln(`- **Âge médian** : ${c.freshness.medianAgeDays} jours (~${Math.round(c.freshness.medianAgeDays / 365 * 10) / 10} ans)`);
  ln(`- **Organisations** : ${c.orgActivity.totalOrgs} actives, ${c.orgActivity.stoppedOrgs.length} inactives (>2 ans)`);
  ln(`- **Datasets fantômes** (0 vue, 0 DL) : ${c.engagement.ghostDatasets.count.toLocaleString()} (${c.engagement.ghostDatasets.pct}%)`);
  ln(`- **Couverture métadonnées** : ${c.coverage.withDescriptionPct}% avec description, ${c.coverage.withEnrichmentPct}% enrichis, ${c.coverage.withTagsPct}% tagués`);
  if (h) {
    ln(`- **Disponibilité ressources** : ${h.overallHealthRate}% (${h.totalResources.toLocaleString()} testées sur ${h.datasetsChecked} datasets)`);
  }
  ln();

  // 0. Couverture des métadonnées
  ln("## 0. Couverture des métadonnées");
  table(
    ["Champ", "Renseigné", "%"],
    [
      ["Description", c.coverage.withDescription.toLocaleString(), `${c.coverage.withDescriptionPct}%`],
      ["Tags", c.coverage.withTags.toLocaleString(), `${c.coverage.withTagsPct}%`],
      ["Licence", c.coverage.withLicense.toLocaleString(), `${c.coverage.withLicensePct}%`],
      ["Fréquence (hors unknown)", c.coverage.withFrequency.toLocaleString(), `${c.coverage.withFrequencyPct}%`],
      ["Enrichissement IA", c.coverage.withEnrichment.toLocaleString(), `${c.coverage.withEnrichmentPct}%`],
    ],
  );
  ln(`Longueur moyenne des descriptions : **${c.coverage.avgDescLength} caractères**`);
  ln();

  // 1. Fraîcheur
  ln("## 1. Fraîcheur des données");
  table(
    ["Tranche", "Nombre", "%"],
    c.freshness.buckets.map(b => [b.label, b.count.toLocaleString(), `${b.pct}%`]),
  );
  if (c.freshness.unknownCount > 0) ln(`_${c.freshness.unknownCount} datasets sans date de modification valide._`);
  ln();

  // 2. Organisations
  ln("## 2. Organisations");
  ln(`${c.orgActivity.totalOrgs.toLocaleString()} organisations | 1 dataset: ${c.orgActivity.orgsBySize.single} | 2-10: ${c.orgActivity.orgsBySize.small} | 11-100: ${c.orgActivity.orgsBySize.medium} | 100+: ${c.orgActivity.orgsBySize.large}`);
  ln();
  ln("### Top 20 par nombre de jeux de données");
  table(
    ["Organisation", "Datasets", "Vues", "Téléchargements"],
    c.orgActivity.top20.map(o => [o.org.slice(0, 70), o.datasetCount.toLocaleString(), o.totalViews.toLocaleString(), o.totalDownloads.toLocaleString()]),
  );

  if (c.orgActivity.stoppedOrgs.length > 0) {
    ln("### Organisations inactives (>2 ans, ≥3 datasets)");
    table(
      ["Organisation", "Datasets", "Dernière modification"],
      c.orgActivity.stoppedOrgs.slice(0, 30).map(o => [o.org.slice(0, 60), o.datasetCount.toString(), o.lastModified.split("T")[0]]),
    );
  }

  // 3. Tendances temporelles
  ln("## 3. Tendances temporelles");
  ln(`Année de pointe : **${c.temporal.peakYear}** | Mois de pointe : **${c.temporal.peakMonth}**`);
  ln();
  ln("### Datasets modifiés par année");
  table(
    ["Année", "Modifiés", "Cumul"],
    c.temporal.byYear.map(y => [y.year.toString(), y.count.toLocaleString(), y.cumulative.toLocaleString()]),
  );

  // 4. Qualité
  ln("## 4. Qualité (score IA 1-5)");
  ln("### Distribution globale");
  table(
    ["Score", "Nombre", "%"],
    Object.entries(c.quality.overall).map(([q, count]) => [
      "★".repeat(Number(q)), count.toLocaleString(), `${pct(count as number, c.totalDatasets)}%`,
    ]),
  );

  ln("### Par catégorie");
  table(
    ["Catégorie", "Score moyen", "Nombre"],
    Object.entries(c.quality.byCategory)
      .sort((a, b) => b[1].avg - a[1].avg)
      .map(([cat, e]) => [cat, e.avg.toString(), e.count.toLocaleString()]),
  );

  ln("### Par scope géographique");
  table(
    ["Scope", "Score moyen", "Nombre"],
    Object.entries(c.quality.byGeo).map(([geo, e]) => [geo, e.avg.toString(), e.count.toLocaleString()]),
  );

  ln("### Top 10 meilleures orgs (≥5 datasets)");
  table(
    ["Organisation", "Score moyen", "Datasets"],
    c.quality.bestOrgs.slice(0, 10).map(o => [o.org.slice(0, 60), o.avgQ.toString(), o.count.toString()]),
  );

  ln("### Top 10 pires orgs (≥5 datasets)");
  table(
    ["Organisation", "Score moyen", "Datasets"],
    c.quality.worstOrgs.slice(0, 10).map(o => [o.org.slice(0, 60), o.avgQ.toString(), o.count.toString()]),
  );

  // 5. Catégories & géographie
  ln("## 5. Catégories & géographie");
  ln("### Par catégorie");
  table(
    ["Catégorie", "Nombre", "%"],
    c.categoryGeo.byCategory.map(e => [e.cat, e.count.toLocaleString(), `${e.pct}%`]),
  );

  ln("### Couverture géographique");
  table(
    ["Scope", "Nombre", "%"],
    c.categoryGeo.byGeo.map(e => [e.geo, e.count.toLocaleString(), `${e.pct}%`]),
  );

  ln("### Top 30 zones");
  table(
    ["Zone", "Nombre", "Type"],
    c.categoryGeo.topAreas.slice(0, 30).map(e => [e.area, e.count.toLocaleString(), e.geo]),
  );

  // 6. Licences & fréquences
  ln("## 6. Licences & fréquences de mise à jour");
  ln("### Licences");
  table(
    ["Licence", "Nombre", "%"],
    c.licenseFreq.licenses.slice(0, 15).map(e => [e.lic, e.count.toLocaleString(), `${e.pct}%`]),
  );

  ln("### Fréquences déclarées");
  table(
    ["Fréquence", "Nombre", "%"],
    c.licenseFreq.frequencies.map(e => [e.freq, e.count.toLocaleString(), `${e.pct}%`]),
  );

  if (c.licenseFreq.promiseVsReality.length > 0) {
    ln("### Promesse vs réalité");
    table(
      ["Fréquence", "Déclarés", "Écart moyen (j)", "Attendu max (j)", "Conformité"],
      c.licenseFreq.promiseVsReality.map(e => [
        e.freq, e.declaredCount.toString(), e.avgActualGapDays.toString(),
        e.expectedMaxDays.toString(), `${e.complianceRate}%`,
      ]),
    );
  }

  // 7. Engagement
  ln("## 7. Engagement");
  ln("### Vues & téléchargements");
  table(
    ["Métrique", "Médiane", "P75", "P90", "P99", "Max"],
    [
      ["Vues", c.engagement.views.median, c.engagement.views.p75, c.engagement.views.p90, c.engagement.views.p99, c.engagement.views.max],
      ["Téléchargements", c.engagement.downloads.median, c.engagement.downloads.p75, c.engagement.downloads.p90, c.engagement.downloads.p99, c.engagement.downloads.max],
    ],
  );

  ln("### Top 20 les plus téléchargés");
  table(
    ["Titre", "Organisation", "Téléchargements"],
    c.engagement.mostDownloaded.map(d => [d.title.slice(0, 60), d.org.slice(0, 40), d.dl.toLocaleString()]),
  );

  ln(`**Datasets fantômes** (0 vue, 0 téléchargement) : ${c.engagement.ghostDatasets.count.toLocaleString()} (${c.engagement.ghostDatasets.pct}%)`);
  ln();

  // 8. Tags
  ln("## 8. Tags");
  ln(`**${c.tags.totalUniqueTags.toLocaleString()}** tags uniques | Moyenne: **${c.tags.avgTagsPerDataset}** tags/dataset | Sans tag: **${c.tags.untaggedCount.toLocaleString()}**`);
  ln();
  ln("### Top 40 tags");
  table(
    ["Tag", "Occurrences"],
    c.tags.topTags.slice(0, 40).map(t => [t.tag, t.count.toLocaleString()]),
  );

  // 9. Santé des ressources
  if (h) {
    ln("## 9. Santé des ressources");
    const testable = h.totalResources - h.byStatus.intranet;
    ln(`**${h.datasetsChecked.toLocaleString()} datasets** vérifiés → **${h.totalResources.toLocaleString()} ressources** testées en ${formatDuration(h.elapsedSeconds)}`);
    ln(`Datasets sans ressource trouvée : ${h.datasetsWithNoResources} | Moyenne : ${h.avgResourcesPerDataset} ressources/dataset`);
    if (h.byStatus.intranet > 0) ln(`_${h.byStatus.intranet} ressources intranet (*.rie.gouv.fr) exclues du calcul de disponibilité._`);
    ln(`**Taux de disponibilité global : ${h.overallHealthRate}%** (sur ${testable.toLocaleString()} ressources testables)`);
    ln(`Temps de réponse moyen : ${h.avgResponseTimeMs}ms | P95 : ${h.p95ResponseTimeMs}ms`);
    ln();

    ln("### Par statut");
    table(
      ["Statut", "Nombre", "%"],
      (Object.entries(h.byStatus) as [string, number][])
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => [s, n.toLocaleString(), `${pct(n, h.totalResources)}%`]),
    );

    ln("### Par format");
    table(
      ["Format", "Total", "Disponibles", "Taux"],
      h.byFormat.map(e => [e.format, e.total.toString(), e.alive.toString(), `${e.healthRate}%`]),
    );

    if (h.worstOrgs.length > 0) {
      ln("### Organisations avec le plus de liens cassés");
      table(
        ["Organisation", "Total", "Cassés", "Taux santé"],
        h.worstOrgs.map(e => [e.org.slice(0, 50), e.total.toString(), e.dead.toString(), `${e.healthRate}%`]),
      );
    }

    ln("### Santé par ancienneté du dataset");
    table(
      ["Ancienneté", "Total", "Disponibles", "Taux"],
      h.byAge.filter(e => e.total > 0).map(e => [e.bucket, e.total.toString(), e.alive.toString(), `${e.healthRate}%`]),
    );
  }

  ln("---");
  ln("*Généré par `scripts/audit-platform.ts`*");

  return lines.join("\n");
}

function saveResults(result: AuditResult, outputDir: string) {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const date = result.generatedAt.split("T")[0];
  const suffix = interrupted ? "-partial" : "";

  const jsonPath = path.join(outputDir, `audit-${date}${suffix}.json`);
  // Resource checks are in CSV — don't duplicate in JSON
  const { resourceChecks: _checks, ...jsonResult } = result;
  void _checks;
  writeFileSync(jsonPath, JSON.stringify(jsonResult, null, 2));
  log(`  JSON: ${jsonPath}`);

  const mdPath = path.join(outputDir, `report-${date}${suffix}.md`);
  writeFileSync(mdPath, generateMarkdown(result));
  log(`  Markdown: ${mdPath}`);
}

// Checkpoint: save intermediate results during long runs
function saveCheckpoint(
  config: AuditConfig,
  catalog: CatalogAnalysis,
  health: HealthSummary,
  checks: ResourceCheck[],
) {
  const result: AuditResult = {
    generatedAt: new Date().toISOString(),
    elapsedSeconds: 0,
    config,
    catalog,
    health,
    resourceChecks: checks.length <= 5000 ? checks : undefined,
  };
  const outputDir = config.outputDir;
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "audit-checkpoint.json");
  writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  log(`  💾 Checkpoint sauvegardé (${health.datasetsChecked} datasets, ${checks.length} ressources)`);
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();
  const globalStart = Date.now();

  // SIGINT handler
  process.on("SIGINT", () => {
    log("\n⚠ Interruption — sauvegarde des résultats partiels...");
    interrupted = true;
  });

  log("═══════════════════════════════════════════════════");
  log("  AUDIT PLATEFORME DATA.GOUV.FR");
  log("═══════════════════════════════════════════════════");
  log("");

  // Load store
  log("▶ Chargement de store.json...");
  const raw = readFileSync(config.storePath, "utf-8");
  const store: Store = JSON.parse(raw);
  const allItems = Object.values(store.ds);
  log(`  ${allItems.length.toLocaleString()} entrées chargées (fetchedAt: ${store.fetchedAt || "inconnu"})`);
  log("");

  // Phase 1
  log("▶ Phase 1 : Analyse du catalogue");
  const catalog = runCatalogAnalysis(allItems);
  log("  ✓ Phase 1 terminée");
  log("");

  // Phase 2
  let health: HealthSummary | undefined;
  let resourceChecks: ResourceCheck[] | undefined;

  if (!config.skipHealth) {
    log("▶ Phase 2 : Vérification santé des ressources");
    const datasets = allItems.filter(d => d.type === "d");
    const datasetMap = new Map(allItems.map(d => [d.id, d]));
    const result = await runHealthCheck(datasets, config, datasetMap, catalog);
    health = result.summary;
    resourceChecks = result.checks;
    log(`  ✓ Phase 2 terminée — ${health.totalResources.toLocaleString()} ressources en ${formatDuration(health.elapsedSeconds)}`);
    log("");
  } else {
    log("▶ Phase 2 : ignorée (--skip-health)");
    log("");
  }

  // Phase 3
  const totalElapsed = (Date.now() - globalStart) / 1000;
  log("▶ Phase 3 : Génération du rapport");
  const auditResult: AuditResult = {
    generatedAt: new Date().toISOString(),
    elapsedSeconds: Math.round(totalElapsed),
    config,
    catalog,
    health,
    resourceChecks,
  };
  saveResults(auditResult, config.outputDir);
  log("  ✓ Phase 3 terminée");
  log("");

  // Console summary
  log("═══════════════════════════════════════════════════");
  log("  RÉSUMÉ");
  log("═══════════════════════════════════════════════════");
  log(`  Datasets: ${catalog.totalDatasets.toLocaleString()} | APIs: ${catalog.totalApis}`);
  log(`  Péremption: ${catalog.freshness.stalenessScore}/100 | Âge médian: ${catalog.freshness.medianAgeDays}j`);
  log(`  Orgs: ${catalog.orgActivity.totalOrgs} (${catalog.orgActivity.stoppedOrgs.length} inactives)`);
  log(`  Couverture: ${catalog.coverage.withDescriptionPct}% desc, ${catalog.coverage.withTagsPct}% tags, ${catalog.coverage.withEnrichmentPct}% enrichis`);
  log(`  Fantômes: ${catalog.engagement.ghostDatasets.count.toLocaleString()} (${catalog.engagement.ghostDatasets.pct}%)`);
  if (health) {
    log(`  Santé: ${health.overallHealthRate}% (${health.totalResources.toLocaleString()} ressources, ${health.datasetsChecked} datasets)`);
    log(`  ↳ Vivants: ${health.byStatus.alive} | Redirections: ${health.byStatus.redirect} | Morts: ${health.byStatus.dead} | Erreurs: ${health.byStatus.server_error} | Timeout: ${health.byStatus.timeout} | DNS: ${health.byStatus.dns_error} | Intranet: ${health.byStatus.intranet} | Autre: ${health.byStatus.other_error}`);
  }
  log(`  Durée totale: ${formatDuration(totalElapsed)}`);
  log("═══════════════════════════════════════════════════");
}

main().catch(err => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
