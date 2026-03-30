"""
Utilitaires partagés pour l'analyse de l'Open Data français.
Style graphique unifié, helpers de chargement, constantes.
"""

import os
import json
from pathlib import Path
import matplotlib.pyplot as plt
import matplotlib as mpl

# ── Chemins ──────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).parent.parent.parent.parent  # d:/Github/FlowDataGouv
DATA_DIR = PROJECT_ROOT / "data"
ANALYSIS_DIR = DATA_DIR / "analysis"
INPUT_DIR = ANALYSIS_DIR / "input"
FIGURES_DIR = ANALYSIS_DIR / "figures"
OUTPUT_DIR = ANALYSIS_DIR / "output"

STORE_PATH = DATA_DIR / "store.json"
AUDIT_CSV_PATH = DATA_DIR / "audit" / "checks-2026-03-28.csv"
AUDIT_JSON_PATH = DATA_DIR / "audit" / "audit-2026-03-28.json"
TAXONOMY_PATH = DATA_DIR / "taxonomy.json"
CATALOG_PATH = INPUT_DIR / "catalog.json"
GEOJSON_PATH = INPUT_DIR / "departements.geojson"
FEATURES_PATH = INPUT_DIR / "datasets_features.parquet"

# ── Palette de couleurs ──────────────────────────────────────

COLORS = {
    "navy": "#1B2A4A",
    "blue": "#2E75B6",
    "red": "#E74C3C",
    "green": "#27AE60",
    "gray": "#7F8C8D",
    "light_gray": "#BDC3C7",
    "orange": "#E67E22",
    "purple": "#8E44AD",
    "teal": "#16A085",
    "yellow": "#F1C40F",
    "white": "#FFFFFF",
    "bg_blue": "#D6EAF8",
    "bg_gray": "#F2F3F4",
}

# Palette séquentielle pour les barplots
PALETTE_SEQ = [COLORS["navy"], COLORS["blue"], COLORS["teal"], COLORS["green"],
               COLORS["orange"], COLORS["red"]]

# Palette catégorielle pour les types d'orgs
PALETTE_ORG = {
    "Ministère": COLORS["navy"],
    "Opérateur": COLORS["blue"],
    "Région": COLORS["teal"],
    "Département": COLORS["green"],
    "Commune/Interco": COLORS["orange"],
    "Autre": COLORS["gray"],
}

# ── Style graphique unifié ───────────────────────────────────

def setup_style():
    """Configure le style matplotlib pour tout le rapport."""
    plt.rcParams.update({
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "axes.edgecolor": COLORS["light_gray"],
        "axes.labelcolor": COLORS["navy"],
        "axes.titlecolor": COLORS["navy"],
        "axes.titlesize": 14,
        "axes.titleweight": "bold",
        "axes.labelsize": 11,
        "xtick.color": COLORS["gray"],
        "ytick.color": COLORS["gray"],
        "xtick.labelsize": 9,
        "ytick.labelsize": 9,
        "axes.grid": True,
        "grid.alpha": 0.3,
        "grid.color": COLORS["light_gray"],
        "grid.linestyle": "--",
        "legend.fontsize": 9,
        "legend.framealpha": 0.8,
        "font.family": "sans-serif",
        "font.sans-serif": ["DejaVu Sans", "Liberation Sans", "Calibri", "Arial"],
        "figure.dpi": 150,
        "savefig.dpi": 150,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.3,
    })


def save_fig(fig, name, dpi=150):
    """Sauvegarde une figure."""
    fig.savefig(FIGURES_DIR / f"{name}.png", dpi=dpi, facecolor="white",
                bbox_inches="tight", pad_inches=0.2)
    plt.close(fig)
    print(f"  [fig] {name}.png")


def add_source(fig, text="Source : data.gouv.fr, audit demo-fli.fr, mars 2026"):
    """No-op : la source est ajoutée dans le rapport Word, pas dans les figures matplotlib.
    Cela évite les chevauchements avec les axes X."""
    pass


# ── Mapping géographique ────────────────────────────────────

# Départements français : nom -> code
DEPT_NAME_TO_CODE = {
    "Ain": "01", "Aisne": "02", "Allier": "03", "Alpes-de-Haute-Provence": "04",
    "Hautes-Alpes": "05", "Alpes-Maritimes": "06", "Ardèche": "07", "Ardennes": "08",
    "Ariège": "09", "Aube": "10", "Aude": "11", "Aveyron": "12",
    "Bouches-du-Rhône": "13", "Calvados": "14", "Cantal": "15", "Charente": "16",
    "Charente-Maritime": "17", "Cher": "18", "Corrèze": "19",
    "Corse-du-Sud": "2A", "Haute-Corse": "2B",
    "Côte-d'Or": "21", "Côtes-d'Armor": "22", "Creuse": "23",
    "Dordogne": "24", "Doubs": "25", "Drôme": "26", "Eure": "27",
    "Eure-et-Loir": "28", "Finistère": "29", "Gard": "30", "Haute-Garonne": "31",
    "Gers": "32", "Gironde": "33", "Hérault": "34", "Ille-et-Vilaine": "35",
    "Indre": "36", "Indre-et-Loire": "37", "Isère": "38", "Jura": "39",
    "Landes": "40", "Loir-et-Cher": "41", "Loire": "42", "Haute-Loire": "43",
    "Loire-Atlantique": "44", "Loiret": "45", "Lot": "46", "Lot-et-Garonne": "47",
    "Lozère": "48", "Maine-et-Loire": "49", "Manche": "50", "Marne": "51",
    "Haute-Marne": "52", "Mayenne": "53", "Meurthe-et-Moselle": "54", "Meuse": "55",
    "Morbihan": "56", "Moselle": "57", "Nièvre": "58", "Nord": "59",
    "Oise": "60", "Orne": "61", "Pas-de-Calais": "62", "Puy-de-Dôme": "63",
    "Pyrénées-Atlantiques": "64", "Hautes-Pyrénées": "65",
    "Pyrénées-Orientales": "66", "Bas-Rhin": "67", "Haut-Rhin": "68",
    "Rhône": "69", "Haute-Saône": "70", "Saône-et-Loire": "71",
    "Sarthe": "72", "Savoie": "73", "Haute-Savoie": "74",
    "Paris": "75", "Seine-Maritime": "76", "Seine-et-Marne": "77",
    "Yvelines": "78", "Deux-Sèvres": "79", "Somme": "80",
    "Tarn": "81", "Tarn-et-Garonne": "82", "Var": "83", "Vaucluse": "84",
    "Vendée": "85", "Vienne": "86", "Haute-Vienne": "87", "Vosges": "88",
    "Yonne": "89", "Territoire de Belfort": "90", "Essonne": "91",
    "Hauts-de-Seine": "92", "Seine-Saint-Denis": "93", "Val-de-Marne": "94",
    "Val-d'Oise": "95",
    "Guadeloupe": "971", "Martinique": "972", "Guyane": "973",
    "La Réunion": "974", "Mayotte": "976",
}

# Inverse
DEPT_CODE_TO_NAME = {v: k for k, v in DEPT_NAME_TO_CODE.items()}

# Régions -> départements
REGION_TO_DEPTS = {
    "Île-de-France": ["75", "77", "78", "91", "92", "93", "94", "95"],
    "Auvergne-Rhône-Alpes": ["01", "03", "07", "15", "26", "38", "42", "43", "63", "69", "73", "74"],
    "Bourgogne-Franche-Comté": ["21", "25", "39", "58", "70", "71", "89", "90"],
    "Bretagne": ["22", "29", "35", "56"],
    "Centre-Val de Loire": ["18", "28", "36", "37", "41", "45"],
    "Corse": ["2A", "2B"],
    "Grand Est": ["08", "10", "51", "52", "54", "55", "57", "67", "68", "88"],
    "Hauts-de-France": ["02", "59", "60", "62", "80"],
    "Normandie": ["14", "27", "50", "61", "76"],
    "Nouvelle-Aquitaine": ["16", "17", "19", "23", "24", "33", "40", "47", "64", "79", "86", "87"],
    "Occitanie": ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"],
    "Pays de la Loire": ["44", "49", "53", "72", "85"],
    "Provence-Alpes-Côte d'Azur": ["04", "05", "06", "13", "83", "84"],
}

# Mapping licence simplifié
LICENSE_GROUPS = {
    "lov2": "Licence Ouverte",
    "fr-lo": "Licence Ouverte",
    "odc-odbl": "ODbL",
    "odc-by": "ODbL",
    "cc-by": "Creative Commons",
    "cc-by-sa": "Creative Commons",
    "cc-zero": "Creative Commons",
    "other-open": "Autre libre",
    "other-at": "Autre libre",
    "other-pd": "Autre libre",
    "odc-pddl": "Autre libre",
    "notspecified": "Non spécifiée",
}

# Mapping fréquence simplifié
FREQ_GROUPS = {
    "daily": "Quotidien/Temps réel",
    "continuous": "Quotidien/Temps réel",
    "severalTimesADay": "Quotidien/Temps réel",
    "hourly": "Quotidien/Temps réel",
    "semidaily": "Quotidien/Temps réel",
    "fiveMinutes": "Quotidien/Temps réel",
    "threeTimesADay": "Quotidien/Temps réel",
    "oneMinute": "Quotidien/Temps réel",
    "thirtyMinutes": "Quotidien/Temps réel",
    "twelveHours": "Quotidien/Temps réel",
    "weekly": "Hebdomadaire",
    "semiweekly": "Hebdomadaire",
    "biweekly": "Hebdomadaire",
    "threeTimesAWeek": "Hebdomadaire",
    "semimonthly": "Mensuel",
    "monthly": "Mensuel",
    "threeTimesAMonth": "Mensuel",
    "bimonthly": "Trimestriel",
    "quarterly": "Trimestriel",
    "threeTimesAYear": "Trimestriel",
    "semiannual": "Annuel",
    "annual": "Annuel",
    "biennial": "Annuel",
    "triennial": "Annuel",
    "quinquennial": "Annuel",
    "quadrennial": "Annuel",
    "decennial": "Annuel",
}
# Tout le reste -> "Inconnu/Ponctuel"


def guess_org_type(org_name: str) -> str:
    """Devine le type d'organisation depuis son nom."""
    name = org_name.lower()
    if any(w in name for w in ["ministère", "ministere", "premier ministre", "secrétariat"]):
        return "Ministère"
    if any(w in name for w in ["insee", "ign", "inpi", "ademe", "anses", "cerema", "shom",
                                "météo-france", "meteo-france", "santé publique", "ofb ",
                                "office français", "agence nationale", "caisse nationale",
                                "bibliothèque nationale", "institut national", "cnrs"]):
        return "Opérateur"
    if any(w in name for w in ["région ", "region "]):
        return "Région"
    if any(w in name for w in ["département", "departement", "ddt", "ddtm", "dreal", "direction départementale",
                                "direction régionale", "préfecture"]):
        return "Département"
    if any(w in name for w in ["commune", "ville ", "mairie", "métropole", "metropole", "communauté",
                                "agglomération", "agglo", "intercommunal"]):
        return "Commune/Interco"
    return "Autre"


def format_number(n):
    """Format un nombre avec des espaces comme séparateurs."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}k"
    return str(int(n))
