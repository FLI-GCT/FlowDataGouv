# Pipeline d'analyse - Radiographie de l'Open Data Français

Scripts Python pour l'audit et l'analyse des 73 000+ jeux de données de data.gouv.fr.

## Prérequis

- Python 3.12+
- Les données sources (générées par le script d'audit)

```bash
pip install pandas numpy scikit-learn matplotlib seaborn geopandas \
            python-docx pyarrow scipy requests squarify openpyxl
```

## Données sources

Les scripts lisent des données générées en amont :

| Fichier | Généré par | Contenu |
|---------|-----------|---------|
| `data/store.json` | Sync catalogue (`/api/sync/catalog`) | 73 974 datasets enrichis par Mistral |
| `data/audit/checks-*.csv` | `scripts/audit-platform.ts` | 385 138 health checks (HEAD sur chaque ressource) |
| `data/audit/audit-*.json` | `scripts/audit-platform.ts` | Stats agrégées de l'audit |
| `data/analysis/input/catalog.json` | `curl https://demo-fli.fr/api/catalog` | Catalogue enrichi live |
| `data/analysis/input/departements.geojson` | GeoJSON départements français | Carte choroplèthe |
| `data/analysis/input/communes.json` | `curl https://geo.api.gouv.fr/communes` | Mapping ville -> département |

### Générer les données d'audit

```bash
# Audit complet (8h, 73k datasets, 385k ressources)
npx tsx scripts/audit-platform.ts --full

# Ou un échantillon rapide (10 min)
npx tsx scripts/audit-platform.ts --sample 1000
```

## Pipeline

Exécuter dans l'ordre :

```bash
# 1. Préparation : chargement + feature engineering (2 min)
python analysis/01_prepare.py

# 2. Analyses et figures (5 min, génère 19 figures PNG)
python analysis/02_revelations.py

# 3. Analyse d'usage via API Metrics data.gouv.fr (1 min, 24 appels API)
python analysis/02b_usage.py

# 4. Génération du rapport Word (30s)
python analysis/03_report.py
```

## Résultats

- `data/analysis/figures/` : 22 figures PNG (carte de France, Lorenz, heatmaps, etc.)
- `data/analysis/figures/stats.json` : stats clés pour le rapport
- `data/analysis/output/rapport-datagouv-2026-publish.docx` : rapport Word final

## Description des scripts

| Script | Rôle |
|--------|------|
| `utils.py` | Constantes, palette graphique, mappings géographiques, helpers |
| `01_prepare.py` | Charge store.json + CSV audit, feature engineering, mapping départemental (66% couverture via API geo.gouv.fr) |
| `02_revelations.py` | 4 révélations + 2 figures Acte 1 : donut disponibilité, formats, ancienneté, carte France, Lorenz, profils orgs, promesse vs réalité, croissance, saisonnalité |
| `02b_usage.py` | Fetch API Metrics (12 mois), top 20 datasets, saisonnalité par catégorie, evergreen vs éphémères |
| `03_report.py` | Assemblage du rapport Word en 3 actes avec python-docx |
