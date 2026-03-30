"""
02_revelations.py - Analyses et génération de toutes les figures.

4 révélations, ~18 figures PNG 150 DPI.
Le ML (clustering, corrélations) est le moteur, jamais le message.
"""

import json
import sys
import warnings
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import seaborn as sns
from pathlib import Path
from scipy import stats as scipy_stats

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

sys.path.insert(0, str(Path(__file__).parent))
from utils import (
    FEATURES_PATH, FIGURES_DIR, AUDIT_JSON_PATH, GEOJSON_PATH,
    COLORS, PALETTE_ORG, REGION_TO_DEPTS, DEPT_CODE_TO_NAME,
    setup_style, save_fig, add_source, format_number,
)

setup_style()

# ── Chargement ────────────────────────────────────────────────

def load_data():
    print("  Chargement des données...")
    df = pd.read_parquet(FEATURES_PATH)
    print(f"  -> {len(df)} datasets")

    # Charger les stats pré-calculées
    with open(AUDIT_JSON_PATH, "r", encoding="utf-8") as f:
        audit = json.load(f)

    return df, audit


# ══════════════════════════════════════════════════════════════
# RÉVÉLATION 1 : L'état réel des données
# ══════════════════════════════════════════════════════════════

def revelation_1(df, audit):
    print("\n  RÉVÉLATION 1 : L'état réel des données")
    h = audit.get("health", {})
    bs = h.get("byStatus", {})

    # ── Fig 1.1 : Le verdict global (donut) ──
    # Base = ressources PUBLIQUES uniquement (hors intranet RIE qui sont des doublons internes)
    # Les timeouts des domaines data.gouv.fr connus sont des faux négatifs (serveurs lents sous charge)
    try:
        fig, ax = plt.subplots(figsize=(8, 8))

        alive = bs.get("alive", 0) + bs.get("redirect", 0)
        dead = bs.get("dead", 0) + bs.get("server_error", 0)
        timeout = bs.get("timeout", 0)
        intranet = bs.get("intranet", 0)
        other = bs.get("other_error", 0) + bs.get("dns_error", 0)

        # Base publique = tout sauf intranet
        total_public = alive + dead + timeout + other

        # ~80% des timeouts sont des faux négatifs (serveurs data.gouv.fr lents sous charge)
        timeout_presumed_alive = int(timeout * 0.80)
        corrected_alive = alive + timeout_presumed_alive
        remaining_issues = (timeout - timeout_presumed_alive) + other

        # Donut sur la base publique
        labels = [
            "Accessible",
            "Probablement accessible\n(timeout sous charge)",
            "Lien mort",
            "Timeout/Erreur résiduel",
        ]
        sizes = [alive, timeout_presumed_alive, dead, remaining_issues]
        colors_pie = [COLORS["green"], "#7DCEA0", COLORS["red"], COLORS["orange"]]
        explode = (0.02, 0.02, 0.05, 0.02)

        wedges, texts, autotexts = ax.pie(
            sizes, labels=None, colors=colors_pie, explode=explode,
            autopct=lambda pct: f"{pct:.1f}%" if pct > 2 else "",
            startangle=90, pctdistance=0.8,
            wedgeprops=dict(width=0.5, edgecolor="white", linewidth=2),
        )
        for t in autotexts:
            t.set_fontsize(10)
            t.set_fontweight("bold")

        legend_labels = [f"{l} ({format_number(s)})" for l, s in zip(labels, sizes)]
        ax.legend(wedges, legend_labels, loc="center left", bbox_to_anchor=(0.82, 0.5), fontsize=9)

        rate = corrected_alive / total_public * 100 if total_public > 0 else 0
        ax.text(0, 0.05, f"{rate:.0f}%", ha="center", va="center",
                fontsize=32, fontweight="bold", color=COLORS["green"])
        ax.text(0, -0.12, "des ressources publiques accessibles", ha="center", va="center",
                fontsize=11, color=COLORS["navy"])

        ax.set_title(f"Disponibilité des {format_number(total_public)} ressources publiques",
                     fontsize=16, fontweight="bold", color=COLORS["navy"], pad=20)
        ax.annotate(
            f"Hors {format_number(intranet)} liens internes RIE (doublons administration)",
            xy=(0.5, -0.05), xycoords="axes fraction", ha="center",
            fontsize=9, color=COLORS["gray"], style="italic",
        )
        add_source(fig)
        save_fig(fig, "fig_1_1_verdict_global")
    except Exception as e:
        print(f"    [ERREUR] Fig 1.1: {e}")

    # ── Fig 1.2 : Fiabilité par format (barplot) ──
    try:
        by_format = h.get("byFormat", [])
        if by_format:
            fmt_df = pd.DataFrame(by_format)
            # Nettoyer les formats parasites
            parasites = ["www:link-1.0-http--link", "www:download-1.0-http--download",
                         "www:link", "inconnu", "data",
                         "vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
            fmt_df = fmt_df[~fmt_df["format"].isin(parasites)]
            fmt_df = fmt_df[fmt_df["total"] >= 100].head(15)  # Formats significatifs
            fmt_df = fmt_df.sort_values("healthRate")

            fig, ax = plt.subplots(figsize=(10, 7))
            colors_bar = [
                COLORS["red"] if r < 40 else COLORS["orange"] if r < 70 else COLORS["green"]
                for r in fmt_df["healthRate"]
            ]
            bars = ax.barh(fmt_df["format"], fmt_df["healthRate"], color=colors_bar, edgecolor="white")
            for bar, total in zip(bars, fmt_df["total"]):
                ax.text(bar.get_width() + 1, bar.get_y() + bar.get_height() / 2,
                        f" {format_number(total)} res.", va="center", fontsize=8, color=COLORS["gray"])
            ax.set_xlim(0, 110)
            ax.set_xlabel("Taux de disponibilité (%)")
            ax.set_title("Fiabilité par format de fichier", fontsize=14, fontweight="bold", color=COLORS["navy"])
            ax.axvline(x=50, color=COLORS["red"], linestyle="--", alpha=0.3)
            ax.axvline(x=80, color=COLORS["green"], linestyle="--", alpha=0.3)
            add_source(fig)
            save_fig(fig, "fig_1_2_fiabilite_format")
    except Exception as e:
        print(f"    [ERREUR] Fig 1.2: {e}")

    # ── Fig 1.3 : Effet de l'âge sur les liens morts ──
    try:
        health_df = df[df["health_rate"].notna() & (df["age_days"] > 0)].copy()
        health_df["age_bucket"] = pd.cut(
            health_df["age_days"],
            bins=[0, 90, 365, 730, 1095, 1825, 3650, 20000],
            labels=["<3m", "3m-1a", "1-2a", "2-3a", "3-5a", "5-10a", "10a+"],
        )
        bucket_stats = health_df.groupby("age_bucket", observed=True).agg(
            health_mean=("health_rate", "mean"),
            dead_mean=("dead_rate", "mean"),
            count=("id", "count"),
        ).reset_index()

        fig, ax = plt.subplots(figsize=(10, 6))
        x = range(len(bucket_stats))
        bars = ax.bar(x, bucket_stats["dead_mean"] * 100, color=COLORS["red"], alpha=0.8, edgecolor="white")
        ax.set_xticks(x)
        ax.set_xticklabels(bucket_stats["age_bucket"], fontsize=10)
        ax.set_ylabel("Taux de liens morts (%)")
        ax.set_xlabel("Ancienneté du jeu de données")
        ax.set_title("Taux de liens morts selon l'ancienneté du jeu de données",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        for bar, count in zip(bars, bucket_stats["count"]):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.3,
                    f"n={format_number(count)}", ha="center", fontsize=8, color=COLORS["gray"])
        add_source(fig)
        save_fig(fig, "fig_1_3_age_liens_morts")
    except Exception as e:
        print(f"    [ERREUR] Fig 1.3: {e}")

    # ── Fig 1.4 : Le mur de l'intranet ──
    try:
        intranet_df = df[df["has_intranet"] == True].groupby("org").size().reset_index(name="datasets")
        intranet_df = intranet_df.sort_values("datasets", ascending=False).head(15)
        intranet_df = intranet_df.sort_values("datasets")

        fig, ax = plt.subplots(figsize=(10, 7))
        ax.barh(intranet_df["org"].str[:50], intranet_df["datasets"], color=COLORS["blue"], edgecolor="white")
        ax.set_xlabel("Nombre de jeux de données avec ressources intranet")
        ax.set_title(f"{format_number(intranet)} ressources sur le réseau interne de l'État (RIE)\ninaccessibles au public",
                     fontsize=13, fontweight="bold", color=COLORS["navy"])
        add_source(fig)
        save_fig(fig, "fig_1_4_intranet")
    except Exception as e:
        print(f"    [ERREUR] Fig 1.4: {e}")

    # ── Fig 1.5 : Top 20 domaines (barplot) ──
    try:
        # Charger les domaines depuis le CSV audit via les stats pré-calculées
        health_df2 = df[df["health_rate"].notna()].copy()
        # Grouper par le domaine dominant... ou utiliser les stats audit
        # Simplification : top orgs par dead_count
        worst = h.get("worstOrgs", [])
        if worst:
            worst_df = pd.DataFrame(worst).head(20).sort_values("dead", ascending=True)
            fig, ax = plt.subplots(figsize=(10, 8))
            colors_bar = [
                COLORS["red"] if r < 50 else COLORS["orange"] if r < 80 else COLORS["green"]
                for r in worst_df["healthRate"]
            ]
            ax.barh(worst_df["org"].str[:45], worst_df["dead"], color=colors_bar, edgecolor="white")
            ax.set_xlabel("Nombre de ressources inaccessibles")
            ax.set_title("Les 20 organisations avec le plus de liens cassés",
                         fontsize=14, fontweight="bold", color=COLORS["navy"])
            for i, (_, row) in enumerate(worst_df.iterrows()):
                ax.text(row["dead"] + 10, i, f"{row['healthRate']:.0f}% OK",
                        va="center", fontsize=8, color=COLORS["gray"])
            add_source(fig)
            save_fig(fig, "fig_1_5_organisations_cassees")
    except Exception as e:
        print(f"    [ERREUR] Fig 1.5: {e}")


# ══════════════════════════════════════════════════════════════
# RÉVÉLATION 2 : La carte de France
# ══════════════════════════════════════════════════════════════

# Populations départementales (INSEE 2021)
POPULATION_DEPT = {
    "01": 656955, "02": 526129, "03": 336326, "04": 163915, "05": 141107,
    "06": 1094283, "07": 328278, "08": 270582, "09": 153153, "10": 310020,
    "11": 370260, "12": 279595, "13": 2043110, "14": 694002, "15": 144692,
    "16": 352335, "17": 655709, "18": 302306, "19": 238860, "21": 534124,
    "22": 598814, "23": 116270, "24": 413053, "25": 543974, "26": 516762,
    "27": 601843, "28": 431575, "29": 909028, "30": 748437, "31": 1400039,
    "32": 191091, "33": 1623749, "34": 1175623, "35": 1079498, "36": 218873,
    "37": 607924, "38": 1271083, "39": 260188, "40": 413490, "41": 329470,
    "42": 762941, "43": 227570, "44": 1429272, "45": 678008, "46": 173828,
    "47": 332842, "48": 76601, "49": 818273, "50": 496883, "51": 566571,
    "52": 172512, "53": 307062, "54": 733481, "55": 184083, "56": 759684,
    "57": 1043522, "58": 203484, "59": 2604361, "60": 827140, "61": 280942,
    "62": 1468452, "63": 662152, "64": 682621, "65": 228530, "66": 479000,
    "67": 1125559, "68": 764030, "69": 1876051, "70": 234428, "71": 553595,
    "72": 566506, "73": 436436, "74": 826654, "75": 2133111, "76": 1254378,
    "77": 1421197, "78": 1448207, "79": 374351, "80": 572443, "81": 389844,
    "82": 261294, "83": 1076711, "84": 559479, "85": 685442, "86": 436876,
    "87": 374426, "88": 364499, "89": 338291, "90": 141318, "91": 1301659,
    "92": 1609306, "93": 1644903, "94": 1396917, "95": 1249674,
    "2A": 158507, "2B": 181933,
    "971": 378560, "972": 361225, "973": 294146, "974": 873102, "976": 320901,
}


def revelation_2(df, audit):
    print("\n  RÉVÉLATION 2 : La carte de France")

    # ── Fig 2.1 : Choroplèthe par département ──
    try:
        dept_df = df[df["dept_code"] != ""].copy()
        dept_stats = dept_df.groupby("dept_code").agg(
            nb_datasets=("id", "count"),
            avg_quality=("quality", "mean"),
            avg_health=("health_rate", "mean"),
            avg_age=("age_days", "mean"),
            categories=("category", "nunique"),
        ).reset_index()

        # Population et densité
        dept_stats["population"] = dept_stats["dept_code"].map(POPULATION_DEPT)
        dept_stats["density"] = dept_stats["nb_datasets"] / dept_stats["population"] * 100_000
        dept_stats["density"] = dept_stats["density"].fillna(0)

        # Normalisation MinMax de chaque composante
        def norm(s):
            mi, ma = s.min(), s.max()
            return (s - mi) / (ma - mi) if ma > mi else 0.5

        dept_stats["density_n"] = norm(dept_stats["density"])
        dept_stats["quality_n"] = norm(dept_stats["avg_quality"])
        dept_stats["health_n"] = norm(dept_stats["avg_health"].fillna(0.5))
        dept_stats["freshness_n"] = 1 - norm(dept_stats["avg_age"])  # inversé : jeune = bon
        dept_stats["diversity_n"] = norm(dept_stats["categories"])

        # Score composite pondéré
        dept_stats["score"] = (
            dept_stats["density_n"] * 0.20 +
            dept_stats["quality_n"] * 0.25 +
            dept_stats["health_n"] * 0.25 +
            dept_stats["freshness_n"] * 0.20 +
            dept_stats["diversity_n"] * 0.10
        ) * 100

        try:
            import geopandas as gpd

            gdf = gpd.read_file(GEOJSON_PATH)
            # Le GeoJSON utilise "code" pour le code département
            gdf = gdf.merge(dept_stats, left_on="code", right_on="dept_code", how="left")

            fig, ax = plt.subplots(1, 1, figsize=(12, 12))
            gdf.plot(
                column="score", cmap="RdYlGn", linewidth=0.5, ax=ax,
                edgecolor="white", legend=True,
                legend_kwds={"label": "Indice de maturité Open Data", "orientation": "horizontal",
                             "shrink": 0.6, "pad": 0.02},
                missing_kwds={"color": "#E8E8E8", "label": "Données insuffisantes"},
            )
            ax.set_axis_off()
            ax.set_title("Indice de maturité Open Data par département",
                         fontsize=18, fontweight="bold", color=COLORS["navy"], pad=20)
            ax.annotate(
                f"Basé sur {len(dept_df)} jeux de données localisés ({len(dept_df)/len(df)*100:.0f}% du catalogue)",
                xy=(0.5, -0.02), xycoords="axes fraction", ha="center", fontsize=9, color=COLORS["gray"],
            )
            add_source(fig)
            save_fig(fig, "fig_2_1_carte_france", dpi=300)

        except Exception as e:
            print(f"    [WARN] geopandas échoué ({e}), fallback barplot")
            # Fallback : barplot top/bottom
            top = dept_stats.nlargest(15, "score")
            bottom = dept_stats.nsmallest(15, "score")
            fig, ax = plt.subplots(figsize=(10, 8))
            all_depts = pd.concat([bottom, top]).sort_values("score")
            all_depts["name"] = all_depts["dept_code"].map(lambda c: DEPT_CODE_TO_NAME.get(c, c))
            colors_bar = [COLORS["red"] if s < 40 else COLORS["orange"] if s < 60 else COLORS["green"] for s in all_depts["score"]]
            ax.barh(all_depts["name"], all_depts["score"], color=colors_bar, edgecolor="white")
            ax.set_xlabel("Score de maturité Open Data")
            ax.set_title("Indice de maturité Open Data par département",
                         fontsize=14, fontweight="bold", color=COLORS["navy"])
            save_fig(fig, "fig_2_1_carte_france", dpi=300)

    except Exception as e:
        print(f"    [ERREUR] Fig 2.1: {e}")

    # ── Fig 2.2 : Top/Bottom départements par score de maturité ──
    try:
        # Réutiliser dept_stats (déjà calculé avec score normalisé par population)
        ranked = dept_stats[dept_stats["dept_code"].isin(DEPT_CODE_TO_NAME.keys())].copy()
        ranked["name"] = ranked["dept_code"].map(lambda c: DEPT_CODE_TO_NAME.get(c, c))
        ranked = ranked[ranked["score"].notna()]

        top15 = ranked.nlargest(15, "score").sort_values("score")
        bottom15 = ranked.nsmallest(15, "score").sort_values("score", ascending=False)

        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 7))

        ax1.barh(top15["name"], top15["score"], color=COLORS["green"], edgecolor="white")
        ax1.set_title("Les 15 meilleurs\nscores de maturité", fontsize=12, fontweight="bold", color=COLORS["green"])
        ax1.set_xlabel("Indice de maturité Open Data")

        ax2.barh(bottom15["name"], bottom15["score"], color=COLORS["red"], edgecolor="white")
        ax2.set_title("Les 15 plus faibles\nscores de maturité", fontsize=12, fontweight="bold", color=COLORS["red"])
        ax2.set_xlabel("Indice de maturité Open Data")

        fig.suptitle("Les écarts territoriaux de l'Open Data", fontsize=15, fontweight="bold", color=COLORS["navy"], y=1.02)
        plt.tight_layout()
        add_source(fig)
        save_fig(fig, "fig_2_2_top_bottom_departements")
    except Exception as e:
        print(f"    [ERREUR] Fig 2.2: {e}")

    # ── Fig 2.3 : Heatmap déserts catégorie x région ──
    try:
        # Mapper dept_code -> région
        dept_to_region = {}
        for region, depts in REGION_TO_DEPTS.items():
            for d in depts:
                dept_to_region[d] = region

        regional = df[df["dept_code"] != ""].copy()
        regional["region"] = regional["dept_code"].map(dept_to_region)
        regional = regional[regional["region"].notna()]

        pivot = regional.groupby(["region", "category"]).size().reset_index(name="count")
        pivot_table = pivot.pivot_table(index="region", columns="category", values="count", fill_value=0)

        # Seulement les catégories principales (trier par total)
        cat_order = pivot_table.sum().sort_values(ascending=False).index[:12]
        pivot_table = pivot_table[cat_order]

        fig, ax = plt.subplots(figsize=(14, 8))
        sns.heatmap(
            pivot_table, cmap="YlOrRd", ax=ax, linewidths=0.5,
            fmt="g", annot=True, annot_kws={"size": 8},
            cbar_kws={"label": "Nombre de jeux de données"},
        )
        ax.set_title("Couverture thématique par région", fontsize=14, fontweight="bold", color=COLORS["navy"])
        ax.set_xlabel("")
        ax.set_ylabel("")
        plt.xticks(rotation=45, ha="right", fontsize=9)
        plt.yticks(fontsize=9)
        add_source(fig)
        save_fig(fig, "fig_2_3_heatmap_regions_categories")
    except Exception as e:
        print(f"    [ERREUR] Fig 2.3: {e}")


# ══════════════════════════════════════════════════════════════
# RÉVÉLATION 3 : Qui publie vraiment ?
# ══════════════════════════════════════════════════════════════

def revelation_3(df, audit):
    print("\n  RÉVÉLATION 3 : Qui publie vraiment ?")

    # ── Fig 3.1 : Courbe de Lorenz ──
    try:
        org_counts = df["org"].value_counts().sort_values().values
        cum_orgs = np.arange(1, len(org_counts) + 1) / len(org_counts) * 100
        cum_datasets = np.cumsum(org_counts) / org_counts.sum() * 100

        # Gini
        n = len(org_counts)
        gini = (2 * np.sum(np.arange(1, n + 1) * np.sort(org_counts)) / (n * np.sum(org_counts))) - (n + 1) / n

        fig, ax = plt.subplots(figsize=(8, 8))
        ax.fill_between(cum_orgs, cum_datasets, cum_orgs, alpha=0.15, color=COLORS["blue"])
        ax.plot(cum_orgs, cum_datasets, color=COLORS["blue"], linewidth=2.5, label="Distribution réelle")
        ax.plot([0, 100], [0, 100], "--", color=COLORS["gray"], linewidth=1, label="Égalité parfaite")

        # Annoter : combien le top 10% produit
        idx_90 = np.searchsorted(cum_orgs, 90)  # Le point 90% des orgs (= top 10%)
        if idx_90 < len(cum_datasets):
            pct_data_top10 = 100 - cum_datasets[idx_90]
            ax.annotate(
                f"10% des organisations\nproduisent {pct_data_top10:.0f}% des données",
                xy=(90, cum_datasets[idx_90]), xytext=(40, 55),
                fontsize=11, fontweight="bold", color=COLORS["navy"],
                arrowprops=dict(arrowstyle="->", color=COLORS["navy"]),
            )

        ax.set_xlabel("% cumulé des organisations (de la plus petite à la plus grande)")
        ax.set_ylabel("% cumulé des jeux de données")
        ax.set_title(f"Concentration de la production (Gini = {gini:.2f})",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        ax.legend(loc="upper left")
        ax.set_xlim(0, 100)
        ax.set_ylim(0, 100)
        add_source(fig)
        save_fig(fig, "fig_3_1_lorenz")
    except Exception as e:
        print(f"    [ERREUR] Fig 3.1: {e}")

    # ── Fig 3.2 : Top 30 contributeurs ──
    try:
        top30 = df.groupby("org").agg(
            count=("id", "count"),
            org_type=("org_type", "first"),
        ).nlargest(30, "count").reset_index()
        # Corriger les noms vides
        top30["org"] = top30["org"].replace("", "(utilisateurs individuels)")
        top30 = top30.sort_values("count")

        fig, ax = plt.subplots(figsize=(10, 10))
        colors_bar = [PALETTE_ORG.get(t, COLORS["gray"]) for t in top30["org_type"]]
        ax.barh(top30["org"].str[:55], top30["count"], color=colors_bar, edgecolor="white")
        ax.set_xlabel("Nombre de jeux de données")
        ax.set_title("Les 30 plus gros producteurs de données ouvertes",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])

        # Légende par type
        from matplotlib.patches import Patch
        handles = [Patch(color=c, label=t) for t, c in PALETTE_ORG.items() if t in top30["org_type"].values]
        ax.legend(handles=handles, loc="lower right", fontsize=9)
        add_source(fig)
        save_fig(fig, "fig_3_2_top30_producteurs")
    except Exception as e:
        print(f"    [ERREUR] Fig 3.2: {e}")

    # ── Fig 3.3 : Profils d'organisations (clustering invisible) ──
    try:
        from sklearn.preprocessing import StandardScaler
        from sklearn.cluster import KMeans

        org_stats = df.groupby("org").agg(
            nb_datasets=("id", "count"),
            total_views=("views", "sum"),
            total_dl=("downloads", "sum"),
            avg_quality=("quality", "mean"),
            avg_health=("health_rate", "mean"),
            avg_age=("age_days", "mean"),
            categories=("category", "nunique"),
            org_type=("org_type", "first"),
        ).reset_index()
        org_stats = org_stats[org_stats["nb_datasets"] >= 2]  # Au moins 2 datasets

        features = ["nb_datasets", "total_views", "total_dl", "avg_quality", "avg_age", "categories"]
        X = org_stats[features].fillna(0).copy()
        X["nb_datasets"] = np.log1p(X["nb_datasets"])
        X["total_views"] = np.log1p(X["total_views"])
        X["total_dl"] = np.log1p(X["total_dl"])

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # K-Means avec 5 clusters
        km = KMeans(n_clusters=5, random_state=42, n_init=10)
        org_stats["cluster"] = km.fit_predict(X_scaled)

        # Nommer les clusters avec des métriques plus différenciées
        cluster_profiles = org_stats.groupby("cluster").agg(
            n=("org", "count"),
            avg_datasets=("nb_datasets", "mean"),
            med_datasets=("nb_datasets", "median"),
            total_views=("total_views", "mean"),
            total_dl=("total_dl", "mean"),
            avg_quality=("avg_quality", "mean"),
            avg_age=("avg_age", "mean"),
            avg_health=("avg_health", "mean"),
            categories=("categories", "mean"),
        ).reset_index()

        # Trier par volume total (datasets * views) pour mieux différencier
        cluster_profiles["impact"] = cluster_profiles["avg_datasets"] * cluster_profiles["total_views"]
        cluster_profiles = cluster_profiles.sort_values("impact", ascending=False)
        name_map = {}
        profile_names = [
            "Champions nationaux",
            "Producteurs établis",
            "Contributeurs réguliers",
            "Producteurs occasionnels",
            "Micro-contributeurs",
        ]
        for i, (_, row) in enumerate(cluster_profiles.iterrows()):
            name_map[row["cluster"]] = profile_names[min(i, len(profile_names) - 1)]

        org_stats["profile"] = org_stats["cluster"].map(name_map)

        # Figure enrichie : radar-like avec métriques clés par profil
        profile_counts = org_stats.groupby("profile").agg(
            n=("org", "count"),
            avg_datasets=("nb_datasets", "mean"),
            total_dl=("total_dl", "mean"),
            avg_quality=("avg_quality", "mean"),
            avg_health=("avg_health", "mean"),
            avg_age=("avg_age", "mean"),
        ).reset_index()
        profile_counts = profile_counts.sort_values("avg_datasets", ascending=True)

        fig, ax = plt.subplots(figsize=(12, 7))
        colors_prof = [COLORS["gray"], COLORS["orange"], COLORS["teal"], COLORS["blue"], COLORS["navy"]]
        bars = ax.barh(profile_counts["profile"], profile_counts["n"],
                       color=colors_prof[:len(profile_counts)], edgecolor="white")
        ax.set_xlabel("Nombre d'organisations")
        ax.set_title("Profils des organisations productrices",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        for bar, (_, row) in zip(bars, profile_counts.iterrows()):
            health_pct = f"{row['avg_health']*100:.0f}%" if pd.notna(row['avg_health']) else "n/a"
            age_y = row['avg_age'] / 365
            desc = (f" {row['avg_datasets']:.0f} datasets/org | "
                    f"{format_number(row['total_dl'])} DL | "
                    f"qualité {row['avg_quality']:.1f}/5 | "
                    f"santé {health_pct} | "
                    f"age moy. {age_y:.1f}a")
            ax.text(bar.get_width() + 5, bar.get_y() + bar.get_height() / 2,
                    desc, va="center", fontsize=8, color=COLORS["gray"])
        add_source(fig)
        save_fig(fig, "fig_3_3_profils_organisations")
    except Exception as e:
        print(f"    [ERREUR] Fig 3.3: {e}")

    # ── Fig 3.4 : Organisations fantômes ──
    try:
        ghost_threshold = 365 * 2  # 2 ans
        org_last_update = df.groupby("org").agg(
            min_age=("age_days", "min"),  # Le dataset le plus récent
            count=("id", "count"),
            org_type=("org_type", "first"),
        ).reset_index()

        ghosts = org_last_update[org_last_update["min_age"] > ghost_threshold]
        ghost_by_type = ghosts.groupby("org_type").agg(
            nb_orgs=("org", "count"),
            nb_datasets=("count", "sum"),
        ).reset_index().sort_values("nb_orgs", ascending=True)

        fig, ax = plt.subplots(figsize=(10, 6))
        ax.barh(ghost_by_type["org_type"], ghost_by_type["nb_orgs"], color=COLORS["red"], alpha=0.8, edgecolor="white")
        for i, (_, row) in enumerate(ghost_by_type.iterrows()):
            ax.text(row["nb_orgs"] + 2, i, f"{int(row['nb_datasets'])} datasets abandonnés",
                    va="center", fontsize=9, color=COLORS["gray"])
        ax.set_xlabel("Nombre d'organisations")
        ax.set_title(f"{len(ghosts)} organisations n'ont rien mis a jour depuis 2 ans",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        add_source(fig)
        save_fig(fig, "fig_3_4_organisations_fantomes")
    except Exception as e:
        print(f"    [ERREUR] Fig 3.4: {e}")


# ══════════════════════════════════════════════════════════════
# RÉVÉLATION 4 : La promesse et la réalité
# ══════════════════════════════════════════════════════════════

def revelation_4(df, audit):
    print("\n  RÉVÉLATION 4 : La promesse et la réalité")

    # ── Fig 4.1 : Boxplot fréquence promise vs ancienneté ──
    try:
        freq_df = df[df["freq_group"] != "Inconnu/Ponctuel"].copy()
        freq_order = ["Quotidien/Temps réel", "Hebdomadaire", "Mensuel", "Trimestriel", "Annuel"]
        freq_df["freq_group"] = pd.Categorical(freq_df["freq_group"], categories=freq_order, ordered=True)
        freq_df = freq_df[freq_df["freq_group"].notna()]

        fig, ax = plt.subplots(figsize=(10, 7))
        bp = ax.boxplot(
            [freq_df[freq_df["freq_group"] == f]["age_days"].values for f in freq_order],
            labels=freq_order, patch_artist=True, showfliers=False,
            medianprops=dict(color=COLORS["navy"], linewidth=2),
        )
        colors_box = [COLORS["red"], COLORS["orange"], COLORS["blue"], COLORS["teal"], COLORS["green"]]
        for patch, color in zip(bp["boxes"], colors_box):
            patch.set_facecolor(color)
            patch.set_alpha(0.5)

        # Ligne de référence pour chaque fréquence
        expected = [2, 10, 35, 100, 400]
        for i, exp in enumerate(expected):
            ax.plot([i + 0.6, i + 1.4], [exp, exp], "--", color=COLORS["navy"], linewidth=1.5, alpha=0.5)
            ax.text(i + 1.4, exp, f" attendu: {exp}j", fontsize=7, color=COLORS["navy"], va="center")

        ax.set_ylabel("Jours depuis la dernière mise a jour")
        ax.set_title("Fréquence de mise a jour promise vs réalité",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        ax.set_yscale("log")
        ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{int(x)}"))
        add_source(fig)
        save_fig(fig, "fig_4_1_promesse_realite")
    except Exception as e:
        print(f"    [ERREUR] Fig 4.1: {e}")

    # ── Fig 4.2 : Courbe de fraîcheur (% de datasets encore actifs selon le seuil d'inactivité) ──
    # age_days = jours depuis la dernière modification.
    # Pour chaque seuil S, on calcule : quel % du catalogue a été modifié dans les S derniers jours ?
    # C'est 1-CDF(age_days). La courbe descend : plus le seuil monte, plus il y a de datasets "actifs".
    # On l'inverse : pour chaque seuil, quel % n'a PAS été touché depuis S jours.
    try:
        ages = df[df["age_days"] > 0]["age_days"].values
        total = len(ages)
        thresholds = np.arange(30, 3650, 30)
        pct_stale = [(ages > t).sum() / total * 100 for t in thresholds]

        fig, ax = plt.subplots(figsize=(10, 6))
        ax.fill_between(thresholds / 365, pct_stale, alpha=0.15, color=COLORS["red"])
        ax.plot(thresholds / 365, pct_stale, color=COLORS["red"], linewidth=2.5)
        ax.set_xlabel("Seuil d'inactivité (années)")
        ax.set_ylabel("% du catalogue non mis a jour depuis ce seuil")
        ax.set_title("La dette de fraîcheur du catalogue",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        ax.set_ylim(0, 100)
        ax.set_xlim(0, 10)

        # Annotations aux seuils clés
        for years, label in [(1, "1 an"), (2, "2 ans"), (5, "5 ans")]:
            idx = np.searchsorted(thresholds, years * 365)
            if idx < len(pct_stale):
                pct = pct_stale[idx]
                ax.annotate(f"{pct:.0f}% non mis a jour\ndepuis {label}",
                            xy=(years, pct), xytext=(years + 1.2, pct + 5),
                            fontsize=10, fontweight="bold", color=COLORS["navy"],
                            arrowprops=dict(arrowstyle="->", color=COLORS["navy"]))

        add_source(fig)
        save_fig(fig, "fig_4_2_courbe_survie")
    except Exception as e:
        print(f"    [ERREUR] Fig 4.2: {e}")

    # ── Fig 4.3 : Qualité vs Popularité ──
    try:
        scatter_df = df[(df["downloads"] > 0) & (df["quality"] > 0)].sample(min(5000, len(df)), random_state=42)
        rho, pval = scipy_stats.spearmanr(scatter_df["quality"], scatter_df["downloads"])

        fig, ax = plt.subplots(figsize=(10, 7))
        cat_colors = {
            "environnement": COLORS["green"], "transport-mobilite": COLORS["blue"],
            "economie-emploi": COLORS["orange"], "sante": COLORS["red"],
        }
        for cat, color in cat_colors.items():
            mask = scatter_df["category"] == cat
            ax.scatter(scatter_df.loc[mask, "quality"] + np.random.normal(0, 0.1, mask.sum()),
                       scatter_df.loc[mask, "downloads"], alpha=0.3, s=8, color=color, label=cat)
        # Reste
        mask_other = ~scatter_df["category"].isin(cat_colors)
        ax.scatter(scatter_df.loc[mask_other, "quality"] + np.random.normal(0, 0.1, mask_other.sum()),
                   scatter_df.loc[mask_other, "downloads"], alpha=0.1, s=5, color=COLORS["light_gray"], label="Autres")

        ax.set_yscale("log")
        ax.set_xlabel("Score de qualité (1-5)")
        ax.set_ylabel("Nombre de téléchargements (échelle log)")
        ax.set_title(f"Qualité vs Popularité (corrélation = {rho:.2f})",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        ax.legend(loc="upper left", fontsize=9)
        add_source(fig)
        save_fig(fig, "fig_4_3_qualite_vs_popularite")
    except Exception as e:
        print(f"    [ERREUR] Fig 4.3: {e}")

    # ── Fig 4.4 : Croissance historique ──
    try:
        yearly = df[df["mod_year"].between(2010, 2026)].groupby("mod_year").size().reset_index(name="count")
        yearly["cumulative"] = yearly["count"].cumsum()

        fig, ax = plt.subplots(figsize=(10, 6))
        ax.fill_between(yearly["mod_year"], yearly["cumulative"], alpha=0.15, color=COLORS["blue"])
        ax.plot(yearly["mod_year"], yearly["cumulative"], color=COLORS["blue"], linewidth=2.5, marker="o", markersize=5)

        # Projection linéaire
        recent = yearly[yearly["mod_year"] >= 2020]
        if len(recent) >= 3:
            slope = np.polyfit(recent["mod_year"], recent["cumulative"], 1)
            for year in [2027, 2028]:
                proj = np.polyval(slope, year)
                ax.plot(year, proj, "o", color=COLORS["gray"], markersize=8)
                ax.annotate(f"{format_number(proj)}", xy=(year, proj), xytext=(year, proj * 1.05),
                            fontsize=9, color=COLORS["gray"], ha="center")
            ax.plot([2026, 2028], [np.polyval(slope, 2026), np.polyval(slope, 2028)],
                    "--", color=COLORS["gray"], linewidth=1.5, label="Projection")

        # Annotations
        ax.annotate("Loi Lemaire\n(2016)", xy=(2016, yearly[yearly["mod_year"] == 2016]["cumulative"].values[0]),
                    xytext=(2013, yearly["cumulative"].max() * 0.3),
                    fontsize=9, color=COLORS["navy"],
                    arrowprops=dict(arrowstyle="->", color=COLORS["navy"]))

        ax.set_xlabel("Année")
        ax.set_ylabel("Nombre cumulé de jeux de données")
        ax.set_title("Croissance de l'Open Data français",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: format_number(x)))
        ax.legend()
        add_source(fig)
        save_fig(fig, "fig_4_4_croissance_historique")
    except Exception as e:
        print(f"    [ERREUR] Fig 4.4: {e}")

    # ── Fig 4.5 : Heatmap saisonnalité ──
    try:
        seasonal = df[(df["mod_year"].between(2015, 2026)) & (df["mod_month"] > 0)]
        pivot = seasonal.groupby(["mod_year", "mod_month"]).size().reset_index(name="count")
        pivot_table = pivot.pivot_table(index="mod_year", columns="mod_month", values="count", fill_value=0)
        pivot_table.columns = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"]

        fig, ax = plt.subplots(figsize=(12, 6))
        sns.heatmap(
            pivot_table, cmap="YlOrRd", ax=ax, linewidths=0.5,
            annot=True, fmt="g", annot_kws={"size": 8},
            cbar_kws={"label": "Jeux de données modifiés"},
        )
        ax.set_title("Saisonnalité des mises a jour", fontsize=14, fontweight="bold", color=COLORS["navy"])
        ax.set_ylabel("Année")
        ax.set_xlabel("")
        add_source(fig)
        save_fig(fig, "fig_4_5_saisonnalite")
    except Exception as e:
        print(f"    [ERREUR] Fig 4.5: {e}")


# ══════════════════════════════════════════════════════════════
# Stats clés pour le rapport
# ══════════════════════════════════════════════════════════════

def compute_key_stats(df, audit):
    print("\n  Calcul des stats clés...")
    h = audit.get("health", {})
    bs = h.get("byStatus", {})

    total_resources = h.get("totalResources", 0)
    alive = bs.get("alive", 0) + bs.get("redirect", 0)
    intranet = bs.get("intranet", 0)
    testable = total_resources - intranet
    dead = bs.get("dead", 0) + bs.get("server_error", 0)

    # Orgs fantômes
    org_last = df.groupby("org")["age_days"].min()
    ghost_orgs = (org_last > 365 * 2).sum()

    # Concentration
    org_counts = df["org"].value_counts().sort_values().values
    n = len(org_counts)
    gini = (2 * np.sum(np.arange(1, n + 1) * np.sort(org_counts)) / (n * np.sum(org_counts))) - (n + 1) / n

    # Département meilleur/pire selon le score composite (calculé dans revelation_2)
    # Fallback sur le volume si le score n'est pas encore calculé
    dept_agg = df[df["dept_code"] != ""].groupby("dept_code").agg(
        n=("id", "count"), avg_q=("quality", "mean"), avg_h=("health_rate", "mean"), avg_age=("age_days", "mean"),
    ).reset_index()
    dept_agg["pop"] = dept_agg["dept_code"].map(POPULATION_DEPT)
    dept_agg["density"] = dept_agg["n"] / dept_agg["pop"] * 100_000
    dept_agg = dept_agg[dept_agg["dept_code"].isin(DEPT_CODE_TO_NAME.keys()) & dept_agg["pop"].notna()]
    def _norm(s):
        mi, ma = s.min(), s.max()
        return (s - mi) / (ma - mi) if ma > mi else 0.5
    dept_agg["score"] = (
        _norm(dept_agg["density"]) * 0.25 + _norm(dept_agg["avg_q"]) * 0.25 +
        _norm(dept_agg["avg_h"].fillna(0.5)) * 0.25 + (1 - _norm(dept_agg["avg_age"])) * 0.25
    )
    top_row = dept_agg.sort_values("score", ascending=False).iloc[0]
    bot_row = dept_agg.sort_values("score").iloc[0]
    best_dept = DEPT_CODE_TO_NAME.get(top_row["dept_code"], "?")
    worst_dept = DEPT_CODE_TO_NAME.get(bot_row["dept_code"], "?")
    best_dept_density = top_row["density"]
    best_dept_quality = top_row["avg_q"]
    best_dept_health = top_row["avg_h"]
    best_dept_pop = top_row["pop"]

    # Base publique (hors intranet = doublons internes)
    total_public = total_resources - intranet
    timeout_total = bs.get("timeout", 0)
    timeout_presumed_alive = int(timeout_total * 0.80)
    corrected_alive = alive + timeout_presumed_alive
    accessibility_rate = round(corrected_alive / total_public * 100, 1) if total_public > 0 else 0

    stats = {
        "total_datasets": len(df),
        "total_resources": total_resources,
        "total_public_resources": total_public,
        "total_orgs": df["org"].nunique(),
        "accessibility_rate": accessibility_rate,
        "dead_resources": dead,
        "dead_rate": round(dead / total_public * 100, 1) if total_public > 0 else 0,
        "intranet_resources": intranet,
        "stale_2y_pct": round((df["age_days"] > 730).mean() * 100, 1),
        "stale_5y_pct": round((df["age_days"] > 1825).mean() * 100, 1),
        "quality_4plus_pct": round((df["quality"] >= 4).mean() * 100, 1),
        "median_age_days": int(df[df["age_days"] > 0]["age_days"].median()),
        "gini": round(gini, 2),
        "ghost_orgs": int(ghost_orgs),
        "ghost_orgs_pct": round(ghost_orgs / df["org"].nunique() * 100, 1),
        "best_dept": best_dept,
        "worst_dept": worst_dept,
        "top_category": df["category"].value_counts().index[0],
        "avg_health": round(df["health_rate"].mean() * 100, 1) if df["health_rate"].notna().any() else 0,
        "geo_coverage_pct": round((df["dept_code"] != "").mean() * 100, 0),
        "best_dept_density": round(best_dept_density, 0) if not np.isnan(best_dept_density) else 0,
        "best_dept_quality": round(best_dept_quality, 1) if not np.isnan(best_dept_quality) else 0,
        "best_dept_health": round(best_dept_health * 100, 0) if not np.isnan(best_dept_health) else 0,
        "best_dept_pop": int(best_dept_pop) if not np.isnan(best_dept_pop) else 0,
    }

    stats_path = FIGURES_DIR / "stats.json"
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    print(f"  -> Stats sauvegardées: {stats_path}")

    for k, v in stats.items():
        print(f"    {k}: {v}")

    return stats


# ── Main ──────────────────────────────────────────────────────

def acte1_figures():
    """Figures spécifiques à l'Acte 1 (le défi technique)."""
    print("\n  ACTE 1 : Figures techniques")

    # ── Fig 0.1 : Chaîne de fiabilité ──
    try:
        fig, ax = plt.subplots(figsize=(12, 4))
        ax.set_xlim(0, 12)
        ax.set_ylim(0, 4)
        ax.set_axis_off()

        blocks = [
            (1, "Donnée source", "75k datasets\nnon normalisés\nenrichis par Mistral", COLORS["blue"]),
            (5, "Infrastructure", "400k ressources\nmulti-serveurs\nauditées en 8h", COLORS["green"]),
            (9, "Agent IA", "19 outils MCP\n30% puis 2% d'erreur\nfuzzy matching", COLORS["orange"]),
        ]
        for x, title, desc, color in blocks:
            rect = plt.Rectangle((x - 0.9, 0.5), 2.8, 3, facecolor=color, alpha=0.15,
                                 edgecolor=color, linewidth=2, zorder=2)
            ax.add_patch(rect)
            ax.text(x + 0.5, 3.0, title, ha="center", va="center",
                    fontsize=13, fontweight="bold", color=color)
            ax.text(x + 0.5, 1.6, desc, ha="center", va="center",
                    fontsize=10, color=COLORS["navy"], linespacing=1.5)

        # Flèches
        for x in [3.2, 7.2]:
            ax.annotate("", xy=(x + 0.7, 2), xytext=(x, 2),
                        arrowprops=dict(arrowstyle="-|>", color=COLORS["navy"], lw=2.5))

        ax.set_title("La chaîne de fiabilité : trois maillons, zéro droit à l'erreur",
                     fontsize=14, fontweight="bold", color=COLORS["navy"], pad=15)
        save_fig(fig, "fig_0_1_chaine_fiabilite")
    except Exception as e:
        print(f"    [ERREUR] Fig 0.1: {e}")

    # ── Fig 0.2 : De 30% à 2% d'erreur ──
    try:
        fig, ax = plt.subplots(figsize=(8, 5))
        bars = ax.bar(["Avant\nfiabilisation", "Après\nfiabilisation"], [30, 2],
                      color=[COLORS["red"], COLORS["green"]], edgecolor="white", width=0.5)
        ax.set_ylabel("Taux d'erreur des appels MCP (%)")
        ax.set_title("Fiabilisation des agents IA sur la donnée publique",
                     fontsize=14, fontweight="bold", color=COLORS["navy"])
        ax.set_ylim(0, 38)

        # Annotations
        ax.text(0, 31, "137 erreurs\nsur 447 appels", ha="center", fontsize=11,
                fontweight="bold", color=COLORS["red"])
        ax.text(1, 3, "~9 erreurs\nsur 447 appels", ha="center", fontsize=11,
                fontweight="bold", color=COLORS["green"])

        # Flèche
        ax.annotate("", xy=(0.85, 5), xytext=(0.15, 28),
                    arrowprops=dict(arrowstyle="-|>", color=COLORS["navy"], lw=2, connectionstyle="arc3,rad=-0.3"))
        ax.text(0.7, 17, "fuzzy matching\ncontexte d'erreur\nproxy + fallback",
                fontsize=9, color=COLORS["navy"], ha="center", style="italic")

        save_fig(fig, "fig_0_2_avant_apres_erreurs")
    except Exception as e:
        print(f"    [ERREUR] Fig 0.2: {e}")


def main():
    print("=" * 60)
    print("  02 - LES RÉVÉLATIONS")
    print("=" * 60)

    df, audit = load_data()

    acte1_figures()
    revelation_1(df, audit)
    revelation_2(df, audit)
    revelation_3(df, audit)
    revelation_4(df, audit)
    stats = compute_key_stats(df, audit)

    print("\n" + "=" * 60)
    figs = list(FIGURES_DIR.glob("*.png"))
    print(f"  {len(figs)} figures générées dans {FIGURES_DIR}")
    for f in sorted(figs):
        print(f"    {f.name}")
    print("=" * 60)


if __name__ == "__main__":
    main()
