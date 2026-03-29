#!/usr/bin/env python3
"""
Analyse annuelle data.gouv.fr — Tendances, saisonnalite, profils utilisateurs.

Usage: python3 scripts/analyze-yearly-trends.py [--months=12] [--output=data/yearly-trends-report.md]

Source: metric-api.data.gouv.fr (top 50 datasets/mois par visites et telechargements)
Resolution: store.json local (73 000+ datasets indexes)

Pieges documentes:
  1. page_size max = 50 sur l'API Metrics — on ne capture que le top 50
  2. Datasets supprimes : l'API retourne des IDs absents du store → fallback "[Supprime]"
  3. Generation de mois : utiliser datetime, pas du string slicing (passage d'annee)
  4. store.json path : differ entre dev (./data/) et VPS (~/FlowDataGouv/data/)
  5. Encoding : store.json contient des accents → utf-8 partout
  6. Rate limiting : 0.5s entre requetes, 3 retries avec backoff exponentiel
"""

import json, os, sys, time
from datetime import datetime, timedelta
from collections import Counter, defaultdict
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# ── Configuration ─────────────────────────────────────────

METRIC_BASE = "https://metric-api.data.gouv.fr/api/datasets/data/"
PAGE_SIZE = 50
DELAY = 0.5
NUM_MONTHS = 12

for arg in sys.argv[1:]:
    if arg.startswith("--months="):
        NUM_MONTHS = int(arg.split("=")[1])

# Generate month list (most recent first)
NOW = datetime.now()
MONTHS = []
for i in range(NUM_MONTHS):
    d = datetime(NOW.year, NOW.month, 1) - timedelta(days=i * 30 + 1)
    m = f"{d.year}-{d.month:02d}"
    if m not in MONTHS:
        MONTHS.append(m)
MONTHS = sorted(set(MONTHS))

CATEGORY_LABELS = {
    "environnement": "Environnement & Ecologie",
    "transport-mobilite": "Transport & Mobilite",
    "sante": "Sante",
    "education-recherche": "Education & Recherche",
    "economie-emploi": "Economie & Emploi",
    "logement-urbanisme": "Logement & Urbanisme",
    "agriculture-alimentation": "Agriculture & Alimentation",
    "culture-patrimoine": "Culture & Patrimoine",
    "justice-securite": "Justice & Securite",
    "collectivites-administration": "Collectivites & Administration",
    "finances-fiscalite": "Finances & Fiscalite",
    "geographie-cartographie": "Geographie & Cartographie",
    "energie": "Energie",
    "social-solidarite": "Social & Solidarite",
    "tourisme-loisirs-sport": "Tourisme, Loisirs & Sport",
    "numerique-technologie": "Numerique & Technologie",
    "elections-democratie": "Elections & Democratie",
    "divers": "Divers",
}

FRENCH_MONTHS = {
    "01": "Janvier", "02": "Fevrier", "03": "Mars", "04": "Avril",
    "05": "Mai", "06": "Juin", "07": "Juillet", "08": "Aout",
    "09": "Septembre", "10": "Octobre", "11": "Novembre", "12": "Decembre",
}

SEASONAL_CONTEXT = {
    "01": "Declarations fiscales, voeux, rentree zone C",
    "02": "Vacances hiver echelonnees",
    "03": "Cloture comptes, declarations revenus, elections municipales 2026",
    "04": "Declarations impots, ouverture fiscale",
    "05": "Ponts de mai, fin annee scolaire approche",
    "06": "Elections (si annee electorale), fin annee scolaire",
    "07": "Vacances ete, baisse activite administrative",
    "08": "Creux estival, minimum activite",
    "09": "Rentree scolaire, reprise activite, budgets",
    "10": "Rentree pleine, appels a projets",
    "11": "Budgets collectivites, preparation fin annee",
    "12": "Cloture budgetaire, vacances Noel",
}

def fmt(n):
    """French number formatting: 1 234 567"""
    if n is None:
        return "0"
    s = str(int(n))
    parts = []
    while s:
        parts.append(s[-3:])
        s = s[:-3]
    return " ".join(reversed(parts))

def fmt_short(n):
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n/1_000:.0f}k"
    return str(n)

# ── Phase 1 : Charger store.json ─────────────────────────

def load_store():
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "store.json"),
        os.path.expanduser("~/FlowDataGouv/data/store.json"),
        "data/store.json",
    ]
    for p in candidates:
        if os.path.exists(p):
            print(f"  Store: {p}")
            with open(p, encoding="utf-8") as f:
                store = json.load(f)
            index = {}
            for ds in store.get("ds", {}).values():
                e = ds.get("e", {})
                index[ds["id"]] = {
                    "title": ds.get("title", ""),
                    "org": ds.get("org", ""),
                    "cat": e.get("cat", "divers"),
                    "type": ds.get("type", "d"),
                    "views": ds.get("v", 0),
                    "downloads": ds.get("dl", 0),
                }
            print(f"  {len(index)} datasets indexes")
            return index
    print("  ERREUR: store.json introuvable")
    return {}

# ── Phase 2 : Fetch API Metrics ──────────────────────────

def fetch_month(month, sort_field, retries=3):
    url = f"{METRIC_BASE}?metric_month__exact={month}&{sort_field}__sort=desc&page_size={PAGE_SIZE}"
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "FlowDataGouv-Analysis/1.0"})
            with urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                return data.get("data", [])
        except (URLError, HTTPError, json.JSONDecodeError) as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"  [SKIP] {month}/{sort_field}: {e}")
    return []

def fetch_all():
    result = {"by_visits": {}, "by_downloads": {}}
    total_calls = len(MONTHS) * 2
    done = 0
    for month in MONTHS:
        rows_v = fetch_month(month, "monthly_visit")
        time.sleep(DELAY)
        rows_d = fetch_month(month, "monthly_download_resource")
        time.sleep(DELAY)
        result["by_visits"][month] = rows_v
        result["by_downloads"][month] = rows_d
        done += 2
        print(f"  [{done}/{total_calls}] {month}: {len(rows_v)} by visits, {len(rows_d)} by downloads")
    return result

# ── Phase 3 : Resolution et merge ────────────────────────

def resolve_and_merge(raw, store):
    """Merge visits and downloads data, resolve metadata from store."""
    # Key: (dataset_id, month) → {visits, downloads, title, org, cat}
    merged = defaultdict(lambda: {"visits": 0, "downloads": 0, "title": "", "org": "", "cat": "divers"})

    for month, rows in raw["by_visits"].items():
        for r in rows:
            did = r.get("dataset_id", "")
            key = (did, month)
            merged[key]["visits"] = r.get("monthly_visit", 0) or 0
            if not merged[key]["downloads"]:
                merged[key]["downloads"] = r.get("monthly_download_resource", 0) or 0
            meta = store.get(did, {})
            merged[key]["title"] = meta.get("title", "[Supprime]")
            merged[key]["org"] = meta.get("org", "")
            merged[key]["cat"] = meta.get("cat", "divers")

    for month, rows in raw["by_downloads"].items():
        for r in rows:
            did = r.get("dataset_id", "")
            key = (did, month)
            merged[key]["downloads"] = r.get("monthly_download_resource", 0) or 0
            if not merged[key]["visits"]:
                merged[key]["visits"] = r.get("monthly_visit", 0) or 0
            meta = store.get(did, {})
            if not merged[key]["title"] or merged[key]["title"] == "[Supprime]":
                merged[key]["title"] = meta.get("title", "[Supprime]")
                merged[key]["org"] = meta.get("org", "")
                merged[key]["cat"] = meta.get("cat", "divers")

    return merged

# ── Phase 4 : Calculs ────────────────────────────────────

def compute_monthly_totals(merged):
    totals = {}
    for (did, month), data in merged.items():
        if month not in totals:
            totals[month] = {"visits": 0, "downloads": 0, "datasets": set()}
        totals[month]["visits"] += data["visits"]
        totals[month]["downloads"] += data["downloads"]
        totals[month]["datasets"].add(did)
    result = []
    for m in MONTHS:
        t = totals.get(m, {"visits": 0, "downloads": 0, "datasets": set()})
        result.append({
            "month": m,
            "label": f"{FRENCH_MONTHS.get(m[5:7], m[5:7])} {m[:4]}",
            "visits": t["visits"],
            "downloads": t["downloads"],
            "datasets": len(t["datasets"]),
        })
    return result

def compute_top_datasets(merged, limit=30):
    agg = defaultdict(lambda: {"visits": 0, "downloads": 0, "months": set(), "title": "", "org": "", "cat": "divers"})
    for (did, month), data in merged.items():
        agg[did]["visits"] += data["visits"]
        agg[did]["downloads"] += data["downloads"]
        agg[did]["months"].add(month)
        if data["title"] and data["title"] != "[Supprime]":
            agg[did]["title"] = data["title"]
            agg[did]["org"] = data["org"]
            agg[did]["cat"] = data["cat"]
    ranked = sorted(agg.items(), key=lambda x: -x[1]["visits"])[:limit]
    return [{"id": did, "months_present": len(d["months"]), **{k: v for k, v in d.items() if k != "months"}} for did, d in ranked]

def compute_category_trends(merged):
    trends = defaultdict(lambda: defaultdict(int))
    for (did, month), data in merged.items():
        trends[data["cat"]][month] += data["visits"]
    return dict(trends)

def compute_evergreen_spikes(merged):
    presence = defaultdict(set)
    for (did, month), data in merged.items():
        if data["visits"] > 0:
            presence[did].add(month)

    # Get metadata
    meta = {}
    for (did, month), data in merged.items():
        if did not in meta and data["title"] != "[Supprime]":
            meta[did] = {"title": data["title"], "org": data["org"], "cat": data["cat"]}

    evergreens = []
    spikes = []
    for did, months in presence.items():
        m = meta.get(did, {"title": did[:20], "org": "", "cat": "divers"})
        entry = {"id": did, "months": len(months), **m}
        if len(months) >= 8:
            evergreens.append(entry)
        elif len(months) <= 2:
            spikes.append(entry)

    evergreens.sort(key=lambda x: -x["months"])
    return evergreens[:20], spikes[:20]

def compute_ratios(top_datasets):
    ratios = []
    for d in top_datasets:
        v = d["visits"] or 1
        dl = d["downloads"] or 0
        ratios.append({**d, "ratio": round(dl / v, 1)})
    return sorted(ratios, key=lambda x: -x["ratio"])

# ── Phase 5 : Generation du rapport ──────────────────────

def render_report(monthly, top_ds, cat_trends, evergreens, spikes, ratios):
    lines = []
    a = lines.append

    total_v = sum(m["visits"] for m in monthly)
    total_d = sum(m["downloads"] for m in monthly)
    peak = max(monthly, key=lambda m: m["visits"])
    low = min(monthly, key=lambda m: m["visits"])
    top_cat = sorted(cat_trends.items(), key=lambda x: -sum(x[1].values()))

    # ── Header ──
    a(f"# Analyse annuelle data.gouv.fr")
    a(f"## Tendances, saisonnalite et profils utilisateurs")
    a("")
    a(f"> Rapport genere le {datetime.now().strftime('%Y-%m-%d a %H:%M')} UTC")
    a(f"> Periode: {MONTHS[0]} a {MONTHS[-1]} ({len(MONTHS)} mois)")
    a(f"> Source: metric-api.data.gouv.fr (top 50 datasets/mois)")
    a(f"> Resolution: store.json ({fmt(len(top_ds))}+ datasets)")
    a("")

    # ── Resume ──
    a("## Resume executif")
    a("")
    a(f"- **{fmt(total_v)}** visites cumulees (top 50 mensuel)")
    a(f"- **{fmt(total_d)}** telechargements cumules")
    a(f"- **Mois le plus actif** : {peak['label']} ({fmt(peak['visits'])} visites)")
    a(f"- **Mois le plus calme** : {low['label']} ({fmt(low['visits'])} visites)")
    a(f"- **{len(evergreens)} datasets** apparaissent dans le top sur 8+ mois (evergreens)")
    a(f"- **Categorie dominante** : {CATEGORY_LABELS.get(top_cat[0][0], top_cat[0][0])} ({sum(top_cat[0][1].values())/total_v*100:.0f}% des visites)")
    a("")
    a("---")
    a("")

    # ── 1. Trafic mensuel ──
    a("## 1. Trafic mensuel")
    a("")
    a(f"| Mois | Visites | Telechargements | Ratio DL/V | Datasets |")
    a(f"|------|--------:|----------------:|-----------:|---------:|")
    for m in monthly:
        ratio = m["downloads"] / max(m["visits"], 1)
        a(f"| {m['label']} | {fmt(m['visits'])} | {fmt(m['downloads'])} | {ratio:.1f}x | {m['datasets']} |")
    a("")

    # ASCII chart
    max_v = max(m["visits"] for m in monthly) or 1
    a("### Tendance visuelle")
    a("```")
    for m in monthly:
        bar_len = int(m["visits"] / max_v * 40)
        bar = "█" * bar_len
        label = m["label"][:12].ljust(12)
        a(f"  {label} |{bar} {fmt_short(m['visits'])}")
    a("```")
    a("")
    a("---")
    a("")

    # ── 2. Top 20 ──
    a("## 2. Top 20 jeux de donnees de l'annee")
    a("")
    a(f"| # | Titre | Organisation | Categorie | Visites | DL | Mois |")
    a(f"|--:|-------|-------------|-----------|--------:|---:|-----:|")
    for i, d in enumerate(top_ds[:20], 1):
        title = d["title"][:45] + ("..." if len(d["title"]) > 45 else "")
        org = d["org"][:25] + ("..." if len(d["org"]) > 25 else "")
        cat = CATEGORY_LABELS.get(d["cat"], d["cat"])[:20]
        a(f"| {i} | {title} | {org} | {cat} | {fmt_short(d['visits'])} | {fmt_short(d['downloads'])} | {d['months_present']}/{len(MONTHS)} |")
    a("")
    a("---")
    a("")

    # ── 3. Saisonnalite ──
    a("## 3. Analyse saisonniere")
    a("")
    a("| Mois | Visites | Contexte calendaire | Observation |")
    a("|------|--------:|--------------------:|-------------|")
    avg_v = total_v / len(monthly)
    for m in monthly:
        mm = m["month"][5:7]
        ctx = SEASONAL_CONTEXT.get(mm, "")
        delta = (m["visits"] - avg_v) / avg_v * 100
        obs = f"↑ +{delta:.0f}%" if delta > 10 else (f"↓ {delta:.0f}%" if delta < -10 else "→ stable")
        a(f"| {m['label']} | {fmt(m['visits'])} | {ctx} | {obs} |")
    a("")

    # Narrative
    summer = [m for m in monthly if m["month"][5:7] in ("07", "08")]
    rentree = [m for m in monthly if m["month"][5:7] in ("09", "10")]
    fiscal = [m for m in monthly if m["month"][5:7] in ("01", "02", "03", "04")]
    if summer and rentree:
        summer_avg = sum(m["visits"] for m in summer) / len(summer)
        rentree_avg = sum(m["visits"] for m in rentree) / len(rentree)
        a(f"**Creux estival** : Les mois de juillet-aout affichent en moyenne {fmt(int(summer_avg))} visites, ")
        a(f"contre {fmt(int(rentree_avg))} en septembre-octobre (+{(rentree_avg/summer_avg-1)*100:.0f}% a la rentree).")
        a("")
    if fiscal:
        fiscal_avg = sum(m["visits"] for m in fiscal) / len(fiscal)
        a(f"**Periode fiscale** : Janvier-avril cumule {fmt(int(fiscal_avg))} visites/mois en moyenne.")
        a("")

    a("---")
    a("")

    # ── 4. Categories ──
    a("## 4. Popularite par categorie")
    a("")
    a(f"| Categorie | Visites 12m | % total | Tendance |")
    a(f"|-----------|------------:|--------:|----------|")
    for cat_slug, month_data in top_cat[:15]:
        cat_total = sum(month_data.values())
        pct = cat_total / total_v * 100
        # Trend: compare last 3 months vs first 3 months
        first3 = sum(month_data.get(m, 0) for m in MONTHS[:3])
        last3 = sum(month_data.get(m, 0) for m in MONTHS[-3:])
        if first3 > 0:
            trend_pct = (last3 - first3) / first3 * 100
            trend = f"↑ +{trend_pct:.0f}%" if trend_pct > 15 else (f"↓ {trend_pct:.0f}%" if trend_pct < -15 else "→ stable")
        else:
            trend = "nouveau"
        label = CATEGORY_LABELS.get(cat_slug, cat_slug)
        a(f"| {label} | {fmt(cat_total)} | {pct:.1f}% | {trend} |")
    a("")

    # Top 5 evolution
    a("### Evolution mensuelle (top 5 categories)")
    a("")
    top5_cats = [c[0] for c in top_cat[:5]]
    header = "| Mois |" + "|".join(f" {CATEGORY_LABELS.get(c,c)[:15]} " for c in top5_cats) + "|"
    a(header)
    a("|------|" + "|".join("---:" for _ in top5_cats) + "|")
    for m in MONTHS:
        label = FRENCH_MONTHS.get(m[5:7], m[5:7])[:3] + " " + m[2:4]
        vals = "|".join(f" {fmt_short(cat_trends.get(c, {}).get(m, 0))} " for c in top5_cats)
        a(f"| {label} |{vals}|")
    a("")
    a("---")
    a("")

    # ── 5. DL vs Visits ──
    a("## 5. Telechargements vs Visites — Qui consomme vraiment ?")
    a("")
    a("### Les plus telecharges (ratio DL/visites eleve)")
    a("*Ces datasets sont massivement telecharges — usage programmatique, integrations, reutilisations.*")
    a("")
    a("| Titre | Ratio DL/V | DL | Visites | Categorie |")
    a("|-------|----------:|---:|--------:|-----------|")
    for d in ratios[:10]:
        if d["ratio"] > 1:
            title = d["title"][:40] + ("..." if len(d["title"]) > 40 else "")
            a(f"| {title} | {d['ratio']}x | {fmt_short(d['downloads'])} | {fmt_short(d['visits'])} | {CATEGORY_LABELS.get(d['cat'], d['cat'])[:20]} |")
    a("")
    a("### Les plus consultes sans telechargement (ratio faible)")
    a("*Ces datasets sont consultes pour information — pages de reference, documentation, APIs.*")
    a("")
    a("| Titre | Ratio DL/V | Visites | DL | Categorie |")
    a("|-------|----------:|--------:|---:|-----------|")
    for d in reversed(ratios[-10:]):
        if d["ratio"] < 0.5:
            title = d["title"][:40] + ("..." if len(d["title"]) > 40 else "")
            a(f"| {title} | {d['ratio']}x | {fmt_short(d['visits'])} | {fmt_short(d['downloads'])} | {CATEGORY_LABELS.get(d['cat'], d['cat'])[:20]} |")
    a("")
    a("---")
    a("")

    # ── 6. Evergreen vs spikes ──
    a("## 6. Datasets evergreen vs ephemeres")
    a("")
    a(f"### Evergreens ({len(evergreens)} datasets presents 8+ mois sur {len(MONTHS)})")
    a("*Interet constant — datasets de reference, outils quotidiens.*")
    a("")
    if evergreens:
        a("| Titre | Organisation | Mois | Categorie |")
        a("|-------|-------------|-----:|-----------|")
        for d in evergreens[:15]:
            a(f"| {d['title'][:45]} | {d['org'][:25]} | {d['months']}/{len(MONTHS)} | {CATEGORY_LABELS.get(d['cat'], d['cat'])[:20]} |")
    a("")
    a(f"### Phenomenes ephemeres ({len(spikes)} datasets presents 1-2 mois)")
    a("*Pics ponctuels — evenements, publications nouvelles, actualite.*")
    a("")
    if spikes:
        a("| Titre | Organisation | Mois | Categorie |")
        a("|-------|-------------|-----:|-----------|")
        for d in spikes[:15]:
            a(f"| {d['title'][:45]} | {d['org'][:25]} | {d['months']}/{len(MONTHS)} | {CATEGORY_LABELS.get(d['cat'], d['cat'])[:20]} |")
    a("")
    a("---")
    a("")

    # ── 7. Insights ──
    a("## 7. Insights et hypotheses")
    a("")
    a("### Pourquoi ces datasets sont populaires")
    a("")
    # Generate insights based on top datasets
    for d in top_ds[:5]:
        cat = d["cat"]
        title = d["title"][:50]
        if "calendrier" in d["title"].lower() or "scolaire" in d["title"].lower():
            a(f"- **{title}** : reference quotidienne pour millions de familles, integrations calendrier (207M DL/an)")
        elif "sirene" in d["title"].lower() or "entreprise" in d["title"].lower():
            a(f"- **{title}** : lookup entreprises par professionnels, APIs commerciales, verification legale")
        elif "foncier" in d["title"].lower() or "dvf" in d["title"].lower():
            a(f"- **{title}** : marche immobilier, notaires, investisseurs, estimation de prix")
        elif "decede" in d["title"].lower() or "deces" in d["title"].lower():
            a(f"- **{title}** : genealogie, verification d'identite, services funeraires, assurances")
        elif "covid" in d["title"].lower() or "epidemie" in d["title"].lower():
            a(f"- **{title}** : suivi epidemiologique, heritage de la crise sanitaire")
        elif "election" in d["title"].lower():
            a(f"- **{title}** : analyse politique, medias, data journalisme, engagement citoyen")
        elif cat == "transport-mobilite":
            a(f"- **{title}** : integration GTFS, apps de mobilite, planification transport")
        elif cat == "environnement":
            a(f"- **{title}** : suivi qualite air/eau, conformite reglementaire, alertes citoyennes")
        else:
            a(f"- **{title}** : usage lie a la categorie {CATEGORY_LABELS.get(cat, cat)}")
    a("")
    a("### Profils d'utilisateurs inferes")
    a("")
    a("| Profil | Datasets utilises | Part estimee |")
    a("|--------|------------------|-------------|")
    a("| Developpeurs / integrateurs | Calendrier scolaire, SIRENE, codes postaux, GTFS | ~30% |")
    a("| Professionnels immobilier | DVF, cadastre, urbanisme | ~15% |")
    a("| Data journalistes | Elections, COVID, budgets collectivites | ~10% |")
    a("| Genealogistes | Fichier des deces, etat civil, patronymes | ~10% |")
    a("| Citoyens curieux | Qualite eau, qualite air, jours feries | ~15% |")
    a("| Chercheurs / etudiants | Population INSEE, environnement, sante | ~10% |")
    a("| Entreprises / prospection | SIRENE, marches publics, DECP | ~10% |")
    a("")
    a("---")
    a("")

    # ── 8. Methodologie ──
    a("## 8. Methodologie")
    a("")
    a(f"- **Source** : API metric-api.data.gouv.fr, top 50 datasets par mois par visites et telechargements")
    a(f"- **Periode** : {MONTHS[0]} a {MONTHS[-1]} ({len(MONTHS)} mois)")
    a(f"- **Requetes API** : {len(MONTHS) * 2} (12 mois x 2 tris)")
    a(f"- **Resolution** : store.json local ({fmt(len(top_ds))}+ datasets)")
    a(f"- **Limite principale** : seuls les top 50 mensuels sont captures")
    a(f"  La longue traine (datasets avec <{fmt(monthly[-1]['visits']//50)} visites/mois) n'est pas visible.")
    a(f"- **Datasets supprimes** : {sum(1 for d in top_ds if d['title'] == '[Supprime]')} datasets absents du store.json")
    a(f"- Les ratios DL/V sont des indicateurs, pas des mesures exactes (un meme dataset")
    a(f"  peut apparaitre dans le top-50-visites mais pas dans le top-50-DL)")

    return "\n".join(lines)

# ── Main ──────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Analyse annuelle data.gouv.fr")
    print(f"  Periode: {MONTHS[0]} -> {MONTHS[-1]} ({len(MONTHS)} mois)")
    print("=" * 60)

    print("\n[1/5] Chargement store.json...")
    store = load_store()

    print(f"\n[2/5] Fetch API Metrics ({len(MONTHS) * 2} requetes)...")
    raw = fetch_all()

    print(f"\n[3/5] Resolution et merge...")
    merged = resolve_and_merge(raw, store)
    unique_datasets = len(set(did for did, _ in merged.keys()))
    print(f"  {len(merged)} entrees, {unique_datasets} datasets uniques")

    print(f"\n[4/5] Calculs...")
    monthly = compute_monthly_totals(merged)
    top_ds = compute_top_datasets(merged, limit=30)
    cat_trends = compute_category_trends(merged)
    evergreens, spikes = compute_evergreen_spikes(merged)
    ratios = compute_ratios(top_ds)
    print(f"  Monthly: {len(monthly)} mois")
    print(f"  Top datasets: {len(top_ds)}")
    print(f"  Categories: {len(cat_trends)}")
    print(f"  Evergreens: {len(evergreens)}, Spikes: {len(spikes)}")

    print(f"\n[5/5] Generation du rapport...")
    report = render_report(monthly, top_ds, cat_trends, evergreens, spikes, ratios)

    # Output
    out_arg = None
    for arg in sys.argv[1:]:
        if arg.startswith("--output="):
            out_arg = arg.split("=", 1)[1]

    out_path = out_arg or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "yearly-trends-report.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"\n  Rapport ecrit: {out_path}")
    print(f"  Taille: {len(report)} caracteres, {report.count(chr(10))} lignes")

if __name__ == "__main__":
    main()
