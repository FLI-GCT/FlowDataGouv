"""
01_prepare.py - Chargement et préparation des données pour l'analyse.

Charge store.json + CSV audit -> DataFrame unifié avec feature engineering.
Sauvegarde en parquet pour les scripts suivants.
"""

import json
import sys
import numpy as np
import pandas as pd
from datetime import datetime
from pathlib import Path

# Ajouter le dossier scripts au path
sys.path.insert(0, str(Path(__file__).parent))
from utils import (
    STORE_PATH, AUDIT_CSV_PATH, AUDIT_JSON_PATH, CATALOG_PATH, FEATURES_PATH, INPUT_DIR,
    DEPT_NAME_TO_CODE, REGION_TO_DEPTS, LICENSE_GROUPS, FREQ_GROUPS,
    guess_org_type,
)

REFERENCE_DATE = datetime(2026, 3, 28)


def load_store():
    """Charge store.json en DataFrame pandas."""
    print("  Chargement store.json...")
    with open(STORE_PATH, "r", encoding="utf-8") as f:
        store = json.load(f)

    records = []
    for ds_id, ds in store["ds"].items():
        if ds.get("type") != "d":
            continue  # Only datasets, not APIs

        e = ds.get("e", {})
        records.append({
            "id": ds["id"],
            "title": ds.get("title", ""),
            "org": ds.get("org", ""),
            "tags": ds.get("tags", []),
            "views": ds.get("v", 0),
            "downloads": ds.get("dl", 0),
            "reuses": ds.get("r", 0),
            "followers": ds.get("f", 0),
            "license": ds.get("lic", ""),
            "frequency": ds.get("freq", ""),
            "last_modified": ds.get("mod", ""),
            "description": ds.get("desc", ""),
            # Enrichment
            "category": e.get("cat", ""),
            "subcategory": e.get("sub", ""),
            "geo_scope": e.get("geo", ""),
            "geo_area": e.get("area", ""),
            "summary": e.get("sum", ""),
            "themes": e.get("th", []),
            "quality": e.get("q", 0),
        })

    df = pd.DataFrame(records)
    print(f"  -> {len(df)} datasets chargés")

    # Étape 0 : validation
    print(f"  Colonnes: {list(df.columns)}")
    print(f"  Sample: {df.iloc[0][['id', 'title', 'category', 'quality', 'geo_scope']].to_dict()}")

    return df


def load_audit_health():
    """Charge le CSV audit et agrège la santé par dataset."""
    print("  Chargement CSV audit (peut prendre ~30s)...")

    # Charger seulement les colonnes nécessaires, avec parsing robuste
    cols = ["dataset_id", "status", "format", "domain", "http_code", "response_time_ms"]
    df = pd.read_csv(
        AUDIT_CSV_PATH,
        usecols=cols,
        dtype={"dataset_id": "str", "status": "str", "format": "str", "domain": "str",
               "http_code": "str", "response_time_ms": "str"},
        on_bad_lines="skip",
        low_memory=False,
    )
    # Convertir les numériques après chargement (gère les valeurs non-numériques)
    df["http_code"] = pd.to_numeric(df["http_code"], errors="coerce")
    df["response_time_ms"] = pd.to_numeric(df["response_time_ms"], errors="coerce")
    print(f"  -> {len(df)} resource checks chargés")

    # Agrégation par dataset
    print("  Agrégation par dataset...")

    def agg_health(group):
        total = len(group)
        alive = ((group["status"] == "alive") | (group["status"] == "redirect")).sum()
        dead = ((group["status"] == "dead") | (group["status"] == "server_error") | (group["status"] == "dns_error")).sum()
        timeouts = (group["status"] == "timeout").sum()
        intranet = (group["status"] == "intranet").sum()

        # Exclure intranet du calcul de santé
        testable = total - intranet
        health_rate = alive / testable if testable > 0 else np.nan

        # Format dominant (hors intranet)
        fmt_counts = group[group["status"] != "intranet"]["format"].value_counts()
        dominant_fmt = fmt_counts.index[0] if len(fmt_counts) > 0 else ""

        # Domaines distincts
        domains = group["domain"].nunique()

        # Temps de réponse moyen (hors intranet et timeouts)
        valid_times = group[
            (group["status"] != "intranet") & (group["status"] != "timeout")
        ]["response_time_ms"]
        avg_resp = valid_times.mean() if len(valid_times) > 0 else np.nan

        return pd.Series({
            "resource_count": total,
            "health_rate": health_rate,
            "dead_count": dead,
            "dead_rate": dead / testable if testable > 0 else 0,
            "timeout_count": timeouts,
            "has_intranet": intranet > 0,
            "avg_response_ms": avg_resp,
            "dominant_format": dominant_fmt,
            "domain_count": domains,
        })

    health = df.groupby("dataset_id").apply(agg_health, include_groups=False).reset_index()
    health.rename(columns={"dataset_id": "id"}, inplace=True)
    print(f"  -> {len(health)} datasets avec données de santé")

    return health


def compute_features(df):
    """Feature engineering sur le DataFrame datasets."""
    print("  Feature engineering...")

    # Numériques log-transformés
    df["log_views"] = np.log1p(df["views"])
    df["log_downloads"] = np.log1p(df["downloads"])

    # Ancienneté
    # Parser les dates - certaines ont des microsecondes, format mixte
    df["last_modified_dt"] = pd.to_datetime(df["last_modified"], errors="coerce", format="mixed", utc=True)
    ref = pd.Timestamp(REFERENCE_DATE, tz="UTC")
    df["age_days"] = (ref - df["last_modified_dt"]).dt.total_seconds() / 86400
    df["age_days"] = df["age_days"].clip(lower=0).fillna(0).astype(int)
    df["age_years"] = (df["age_days"] / 365.25).round(1)

    # Longueurs texte
    df["desc_length"] = df["description"].str.len().fillna(0).astype(int)
    df["tag_count"] = df["tags"].apply(len)
    df["title_length"] = df["title"].str.len().fillna(0).astype(int)

    # Licence regroupée
    df["license_group"] = df["license"].map(LICENSE_GROUPS).fillna("Non spécifiée")

    # Fréquence regroupée
    df["freq_group"] = df["frequency"].map(FREQ_GROUPS).fillna("Inconnu/Ponctuel")

    # Type d'organisation
    df["org_type"] = df["org"].apply(guess_org_type)

    # Nombre de datasets par org
    org_counts = df["org"].value_counts().to_dict()
    df["org_dataset_count"] = df["org"].map(org_counts)
    df["org_size"] = pd.cut(
        df["org_dataset_count"],
        bins=[0, 1, 10, 50, 200, float("inf")],
        labels=["1", "2-10", "11-50", "51-200", "200+"],
    )

    # Extraction département
    df["dept_code"] = extract_department(df)

    # Année de modification
    df["mod_year"] = df["last_modified_dt"].dt.year
    df["mod_month"] = df["last_modified_dt"].dt.month

    return df


def load_communes_mapping():
    """Charge le mapping commune -> code département depuis communes.json."""
    communes_path = INPUT_DIR / "communes.json"
    if not communes_path.exists():
        print("    [WARN] communes.json absent, mapping ville limité")
        return {}
    with open(communes_path, "r", encoding="utf-8") as f:
        communes = json.load(f)
    # Mapping nom -> codeDepartement (en minuscule pour matching flexible)
    mapping = {}
    for c in communes:
        nom = c.get("nom", "")
        code = c.get("codeDepartement", "")
        if nom and code:
            mapping[nom] = code
            mapping[nom.lower()] = code
    print(f"    {len(communes)} communes chargées")
    return mapping


# Mapping nom de région (texte libre Mistral) -> clé REGION_TO_DEPTS
REGION_AREA_NORMALIZE = {
    "île-de-france": "Île-de-France", "ile-de-france": "Île-de-France",
    "auvergne-rhône-alpes": "Auvergne-Rhône-Alpes", "auvergne-rhone-alpes": "Auvergne-Rhône-Alpes",
    "bourgogne-franche-comté": "Bourgogne-Franche-Comté", "bourgogne-franche-comte": "Bourgogne-Franche-Comté",
    "bretagne": "Bretagne", "centre-val de loire": "Centre-Val de Loire",
    "corse": "Corse", "grand est": "Grand Est",
    "hauts-de-france": "Hauts-de-France", "normandie": "Normandie",
    "nouvelle-aquitaine": "Nouvelle-Aquitaine", "occitanie": "Occitanie",
    "pays de la loire": "Pays de la Loire",
    "provence-alpes-côte d'azur": "Provence-Alpes-Côte d'Azur",
    "provence-alpes-cote d'azur": "Provence-Alpes-Côte d'Azur",
    "paca": "Provence-Alpes-Côte d'Azur",
}
# Ajouter les versions capitalisées
for k, v in list(REGION_AREA_NORMALIZE.items()):
    REGION_AREA_NORMALIZE[v] = v
    REGION_AREA_NORMALIZE[v.lower()] = v


def extract_department(df):
    """Extrait le code département pour chaque dataset."""
    print("  Extraction département...")

    communes_map = load_communes_mapping()
    dept_codes = pd.Series("", index=df.index, dtype="str")

    # Priorité 1 : geo_scope == "departemental" et area = nom de département
    mask_dept = df["geo_scope"] == "departemental"
    dept_codes[mask_dept] = df.loc[mask_dept, "geo_area"].map(
        lambda x: DEPT_NAME_TO_CODE.get(x, "")
    )
    n1 = (dept_codes != "").sum()
    print(f"    P1 départemental direct : {n1}")

    # Priorité 2 : geo_scope == "communal" - mapping via communes.json (34k communes)
    mask_communal = (df["geo_scope"] == "communal") & (dept_codes == "")
    if communes_map:
        dept_codes[mask_communal] = df.loc[mask_communal, "geo_area"].map(
            lambda x: communes_map.get(x, "") or communes_map.get(x.lower().strip(), "") if isinstance(x, str) else ""
        )
    n2 = (dept_codes != "").sum() - n1
    print(f"    P2 communal (communes.json) : +{n2}")

    # Priorité 3 : geo_scope == "regional" - distribuer aléatoirement sur les départements de la région
    # Chaque dataset régional est assigné à un département au hasard dans sa région
    # pour éviter de tout concentrer sur le premier département
    import random
    random.seed(42)
    mask_regional = (df["geo_scope"] == "regional") & (dept_codes == "")
    def region_to_random_dept(area):
        if not isinstance(area, str):
            return ""
        normalized = REGION_AREA_NORMALIZE.get(area, "") or REGION_AREA_NORMALIZE.get(area.lower(), "")
        if normalized and normalized in REGION_TO_DEPTS:
            return random.choice(REGION_TO_DEPTS[normalized])
        return ""
    dept_codes[mask_regional] = df.loc[mask_regional, "geo_area"].map(region_to_random_dept)
    n3 = (dept_codes != "").sum() - n1 - n2
    print(f"    P3 régional (distribué) : +{n3}")

    # Priorité 4 : extraire depuis le nom de l'org (DDT du Jura -> 39)
    mask_empty = dept_codes == ""
    for dept_name, code in DEPT_NAME_TO_CODE.items():
        if len(dept_name) < 4:
            continue
        org_match = mask_empty & df["org"].str.contains(dept_name, case=False, na=False)
        dept_codes[org_match] = code
        mask_empty = dept_codes == ""  # Mettre à jour le masque
    n4 = (dept_codes != "").sum() - n1 - n2 - n3
    print(f"    P4 nom d'org : +{n4}")

    mapped = (dept_codes != "").sum()
    total = len(df)
    print(f"    Total : {mapped}/{total} datasets mappés ({mapped/total*100:.1f}%)")

    return dept_codes


def main():
    print("=" * 60)
    print("  01 - PRÉPARATION DES DONNÉES")
    print("=" * 60)
    print()

    # 1. Store
    df = load_store()
    print()

    # 2. Audit health
    health = load_audit_health()
    print()

    # 3. Merge
    print("  Fusion datasets + santé...")
    df = df.merge(health, on="id", how="left")
    print(f"  -> {df['health_rate'].notna().sum()} datasets avec données de santé")
    print()

    # 4. Features
    df = compute_features(df)
    print()

    # 5. Stats rapides
    print("  === STATS RAPIDES ===")
    print(f"  Total datasets: {len(df)}")
    print(f"  Catégories: {df['category'].nunique()}")
    print(f"  Organisations: {df['org'].nunique()}")
    print(f"  Avec département: {(df['dept_code'] != '').sum()}")
    print(f"  Qualité moyenne: {df['quality'].mean():.2f}")
    print(f"  Health rate moyen: {df['health_rate'].mean():.2%}")
    print(f"  Âge médian: {df['age_days'].median():.0f} jours")
    print()

    # 6. Sauvegarder
    # Convertir les listes en strings pour parquet
    df["tags_str"] = df["tags"].apply(lambda x: "|".join(x) if isinstance(x, list) else "")
    df["themes_str"] = df["themes"].apply(lambda x: "|".join(x) if isinstance(x, list) else "")
    cols_to_save = [c for c in df.columns if c not in ("tags", "themes")]

    df[cols_to_save].to_parquet(FEATURES_PATH, index=False)
    print(f"  Sauvegardé: {FEATURES_PATH}")
    print(f"  Taille: {FEATURES_PATH.stat().st_size / 1024 / 1024:.1f} Mo")
    print()

    # Vérification CSV intact
    import subprocess
    result = subprocess.run(["wc", "-l", str(AUDIT_CSV_PATH)], capture_output=True, text=True)
    csv_lines = result.stdout.strip().split()[0]
    print(f"  CSV audit intact: {csv_lines} lignes (attendu: 385138)")
    assert csv_lines == "385138", f"CSV audit modifié ! {csv_lines} != 385138"

    print()
    print("  OK - Préparation terminée")


if __name__ == "__main__":
    main()
