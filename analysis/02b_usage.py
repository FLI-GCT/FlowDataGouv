"""
02b_usage.py - Analyse des tendances d'usage (API Metrics data.gouv.fr)

Fetch les top 50 datasets par visites et téléchargements sur 12 mois,
calcule les tendances, génère 3 figures.
"""

import json
import sys
import time
import warnings
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import requests
import seaborn as sns

warnings.filterwarnings("ignore")

sys.path.insert(0, str(Path(__file__).parent))
from utils import (
    STORE_PATH, FIGURES_DIR,
    COLORS, setup_style, save_fig, format_number,
)

setup_style()

METRICS_BASE = "https://metric-api.data.gouv.fr/api/datasets/data/"
MONTHS = []
for year in [2025, 2026]:
    for month in range(1, 13):
        ym = f"{year}-{month:02d}"
        if "2025-03" <= ym <= "2026-02":
            MONTHS.append(ym)

# Palette par catégorie
CAT_COLORS = {
    "transport-mobilite": COLORS["blue"],
    "economie-emploi": COLORS["orange"],
    "logement-urbanisme": "#8E44AD",
    "environnement": COLORS["green"],
    "geographie-cartographie": COLORS["teal"],
    "sante": COLORS["red"],
    "education-recherche": "#F1C40F",
    "elections-democratie": COLORS["navy"],
    "finances-fiscalite": "#D35400",
    "collectivites-administration": COLORS["gray"],
}


def fetch_metrics():
    """Fetch top 50 par visites et DL pour chaque mois."""
    print("  Fetch API Metrics (24 requêtes)...")
    all_data = []
    for i, ym in enumerate(MONTHS):
        for sort_field in ["monthly_visit", "monthly_download_resource"]:
            url = f"{METRICS_BASE}?metric_month__exact={ym}&{sort_field}__sort=desc&page_size=50"
            for attempt in range(3):
                try:
                    resp = requests.get(url, headers={"User-Agent": "FlowDataGouv-Analysis/1.0"}, timeout=15)
                    if resp.ok:
                        items = resp.json().get("data", [])
                        all_data.extend(items)
                        break
                except Exception as e:
                    if attempt == 2:
                        print(f"    [WARN] {ym}/{sort_field} échoué: {e}")
                    time.sleep(2 ** attempt)
            time.sleep(0.3)
        print(f"    [{i+1}/{len(MONTHS)}] {ym} OK")
    print(f"  -> {len(all_data)} entrées brutes")
    return all_data


def load_store_index():
    """Charger store.json comme index dataset_id -> info."""
    print("  Chargement store.json pour résolution...")
    with open(STORE_PATH, "r", encoding="utf-8") as f:
        store = json.load(f)
    index = {}
    for ds_id, ds in store["ds"].items():
        e = ds.get("e", {})
        index[ds["id"]] = {
            "title": ds.get("title", "[Inconnu]"),
            "org": ds.get("org", ""),
            "cat": e.get("cat", "divers"),
        }
    print(f"  -> {len(index)} datasets indexés")
    return index


def process_data(all_data, ds_index):
    """Dédupliquer, résoudre, calculer."""
    print("  Traitement des données...")

    # Dédupliquer par (dataset_id, month) en prenant le max de chaque métrique
    monthly = {}
    for item in all_data:
        did = item.get("dataset_id", "")
        ym = item.get("metric_month", "")
        if not did or not ym:
            continue
        key = (did, ym)
        if key not in monthly:
            info = ds_index.get(did, {"title": "[Dataset supprimé]", "org": "Inconnu", "cat": "divers"})
            monthly[key] = {"visits": 0, "downloads": 0, **info}
        monthly[key]["visits"] = max(monthly[key]["visits"], item.get("monthly_visit", 0) or 0)
        monthly[key]["downloads"] = max(monthly[key]["downloads"], item.get("monthly_download_resource", 0) or 0)

    print(f"  -> {len(monthly)} entrées uniques (dataset, mois)")

    # Agrégation annuelle par dataset
    annual = {}
    for (did, ym), data in monthly.items():
        if did not in annual:
            annual[did] = {"visits": 0, "downloads": 0, "months": set(),
                           "title": data["title"], "org": data["org"], "cat": data["cat"]}
        annual[did]["visits"] += data["visits"]
        annual[did]["downloads"] += data["downloads"]
        annual[did]["months"].add(ym)

    # Classifier evergreen / éphémère
    for did, data in annual.items():
        n = len(data["months"])
        data["n_months"] = n
        data["type"] = "evergreen" if n >= 8 else ("éphémère" if n <= 2 else "régulier")
        data["ratio"] = data["downloads"] / max(data["visits"], 1)

    # Totaux mensuels
    monthly_totals = defaultdict(lambda: {"visits": 0, "downloads": 0})
    for (did, ym), data in monthly.items():
        monthly_totals[ym]["visits"] += data["visits"]
        monthly_totals[ym]["downloads"] += data["downloads"]

    # Tendances par catégorie
    cat_monthly = defaultdict(lambda: defaultdict(int))
    for (did, ym), data in monthly.items():
        cat_monthly[data["cat"]][ym] += data["visits"]

    # Concentration
    total_visits = sum(d["visits"] for d in annual.values())
    top_sorted = sorted(annual.items(), key=lambda x: x[1]["visits"], reverse=True)
    top10_visits = sum(d[1]["visits"] for d in top_sorted[:10])
    concentration = top10_visits / max(total_visits, 1) * 100

    return monthly, annual, monthly_totals, cat_monthly, top_sorted, concentration


def generate_figures(annual, cat_monthly, top_sorted, concentration):
    """Générer les 3 figures."""

    # ── Fig 5.1 : Top 20 datasets les plus consultés ──
    try:
        # Filtrer les pics artificiels : datasets avec 1 seul mois et 0 DL (bots/scraping)
        top20 = [(did, d) for did, d in top_sorted[:40]
                 if d["title"] != "[Dataset supprimé]"
                 and not (d["n_months"] <= 1 and d["downloads"] == 0)][:20]
        top20.reverse()

        fig, ax = plt.subplots(figsize=(12, 9))
        labels = [d["title"][:55] for _, d in top20]
        values = [d["visits"] for _, d in top20]
        colors = [CAT_COLORS.get(d["cat"], COLORS["gray"]) for _, d in top20]
        bars = ax.barh(labels, values, color=colors, edgecolor="white")

        for bar, (_, d) in zip(bars, top20):
            ax.text(bar.get_width() + max(values) * 0.01, bar.get_y() + bar.get_height() / 2,
                    f" {d['n_months']}/12 mois", va="center", fontsize=8, color=COLORS["gray"])

        ax.set_xlabel("Visites sur 12 mois (mars 2025 - février 2026)")
        ax.set_title("Les 20 jeux de données les plus consultés",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: format_number(x)))
        save_fig(fig, "fig_5_1_top20_usage")
    except Exception as e:
        print(f"    [ERREUR] Fig 5.1: {e}")

    # ── Fig 5.2 : Heatmap saisonnalité par catégorie ──
    try:
        import pandas as pd
        # Top 10 catégories par visites totales
        cat_totals = {cat: sum(months.values()) for cat, months in cat_monthly.items()}
        top_cats = sorted(cat_totals, key=cat_totals.get, reverse=True)[:10]

        rows = []
        for cat in top_cats:
            row = {"Catégorie": cat}
            for ym in MONTHS:
                month_label = ym[5:] + "/" + ym[2:4]  # "04/25"
                row[month_label] = cat_monthly[cat].get(ym, 0)
            rows.append(row)
        hm_df = pd.DataFrame(rows).set_index("Catégorie")

        fig, ax = plt.subplots(figsize=(14, 7))
        sns.heatmap(hm_df, cmap="Blues", ax=ax, linewidths=0.5,
                    annot=True, fmt="g", annot_kws={"size": 8},
                    cbar_kws={"label": "Visites mensuelles (top 50)"})
        ax.set_title("Saisonnalité de la consultation par thématique",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        ax.set_ylabel("")
        plt.xticks(rotation=45, ha="right")
        save_fig(fig, "fig_5_2_saisonnalite_usage")
    except Exception as e:
        print(f"    [ERREUR] Fig 5.2: {e}")

    # ── Fig 5.3 : Scatter evergreen vs éphémères ──
    try:
        items = [(did, d) for did, d in annual.items() if d["title"] != "[Dataset supprimé]" and d["visits"] > 0]

        fig, ax = plt.subplots(figsize=(10, 7))

        for did, d in items:
            color = CAT_COLORS.get(d["cat"], COLORS["light_gray"])
            alpha = 0.8 if d["n_months"] >= 8 or d["visits"] > 100000 else 0.3
            size = max(5, min(200, d["downloads"] / 5000))
            ax.scatter(d["n_months"], d["visits"], s=size, color=color, alpha=alpha, edgecolors="white", linewidth=0.3)

        # Annoter les top 6
        top6 = sorted(items, key=lambda x: x[1]["visits"], reverse=True)[:6]
        for did, d in top6:
            short = d["title"][:35]
            ax.annotate(short, xy=(d["n_months"], d["visits"]),
                        xytext=(d["n_months"] - 1.5, d["visits"] * 1.3),
                        fontsize=7, color=COLORS["navy"],
                        arrowprops=dict(arrowstyle="-", color=COLORS["gray"], lw=0.5))

        ax.set_xlabel("Nombre de mois dans le top 50 (sur 12)")
        ax.set_ylabel("Visites totales (12 mois)")
        ax.set_yscale("log")
        ax.set_title("Datasets \"evergreen\" vs pics éphémères",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        ax.set_xlim(0, 13)

        # Zones annotées
        ax.axvline(x=8, color=COLORS["green"], linestyle="--", alpha=0.3)
        ax.axvline(x=2, color=COLORS["red"], linestyle="--", alpha=0.3)
        ax.text(10, ax.get_ylim()[0] * 3, "Evergreen", fontsize=10, color=COLORS["green"], alpha=0.6)
        ax.text(0.5, ax.get_ylim()[0] * 3, "Éphémères", fontsize=10, color=COLORS["red"], alpha=0.6)

        save_fig(fig, "fig_5_3_evergreen")
    except Exception as e:
        print(f"    [ERREUR] Fig 5.3: {e}")


def save_stats(annual, top_sorted, concentration):
    """Sauvegarder les stats clés."""
    top1 = top_sorted[0][1] if top_sorted else {}
    n_evergreen = sum(1 for d in annual.values() if d["type"] == "evergreen")
    n_ephemere = sum(1 for d in annual.values() if d["type"] == "éphémère")
    total_visits = sum(d["visits"] for d in annual.values())
    total_dl = sum(d["downloads"] for d in annual.values())

    stats = {
        "total_visits_top50": total_visits,
        "total_downloads_top50": total_dl,
        "top1_title": top1.get("title", "?"),
        "top1_visits": top1.get("visits", 0),
        "concentration_top10_pct": round(concentration, 1),
        "n_evergreen": n_evergreen,
        "n_ephemere": n_ephemere,
        "n_datasets_seen": len(annual),
    }

    path = FIGURES_DIR / "usage_stats.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    print(f"  -> Stats sauvegardées : {path}")
    for k, v in stats.items():
        print(f"    {k}: {v}")
    return stats


def main():
    print("=" * 60)
    print("  02b - ANALYSE D'USAGE (API Metrics)")
    print("=" * 60)

    raw = fetch_metrics()
    ds_index = load_store_index()
    monthly, annual, monthly_totals, cat_monthly, top_sorted, concentration = process_data(raw, ds_index)

    print("\n  Génération des figures...")
    generate_figures(annual, cat_monthly, top_sorted, concentration)

    print("\n  Stats clés :")
    save_stats(annual, top_sorted, concentration)

    print("\n" + "=" * 60)
    figs = list(FIGURES_DIR.glob("fig_5_*.png"))
    print(f"  {len(figs)} figures d'usage générées")
    for f in sorted(figs):
        print(f"    {f.name}")
    print("=" * 60)


if __name__ == "__main__":
    main()
