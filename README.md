# FlowDataGouv

> Étude ponctuelle sur l'open data français, menée de janvier à mars 2026.
> Ce projet est archivé. Pour accéder aux données publiques françaises,
> nous recommandons le [MCP officiel de data.gouv.fr](https://github.com/datagouv/mcp-data.gouv.fr).

Projet personnel de [Guillaume CLEMENT](https://www.linkedin.com/in/guillaume-clement-erp-cloud/).

**Principe : IA quand nécessaire, code quand suffisant.**

## Ce que ce projet a exploré

FlowDataGouv est une plateforme expérimentale d'exploration des 73 000+ jeux de données publiques de [data.gouv.fr](https://www.data.gouv.fr). Le projet combinait recherche intelligente (Mistral AI), un serveur MCP de 19 outils pour agents IA, et un audit automatisé de l'intégralité des 385 000 ressources du catalogue.

Les résultats :
- Une **interface web complète** avec recherche augmentée par IA, visualisation multi-format et exploration tabulaire
- **Martine**, un agent conversationnel propulsé par Mistral avec tool calling natif, capable d'interroger et croiser les données en langage naturel
- Un **rapport d'analyse complet** : "Comment j'ai audité la totalité des données publiques françaises avec des Agents IA", disponible dans [`analysis/`](analysis/)

### En chiffres

| | |
|---|---|
| Datasets indexés et enrichis par IA | 73 974 |
| Ressources auditées (HEAD request) | 384 928 |
| Outils MCP pour agents IA | 19 |
| Catégories thématiques | 18 |
| Organisations analysées | 3 656 |
| Durée du scan complet | 8 heures |
| Taux de disponibilité (hors intranet) | ~83% |

## La plateforme web

### Recherche augmentée par IA

La recherche combine un moteur in-memory sur 73 000 items avec Mistral AI :

1. **Expansion de requête** : Mistral corrige les fautes, génère des mots-clés sémantiques, et coche automatiquement les filtres pertinents (catégories, zones géographiques)
2. **Scoring multi-champs** : 7 champs pondérés (titre x10, organisation x5, tags x4...) avec keyword weight decay et breadth bonus
3. **Re-ranking sémantique** : Mistral réordonne les 20 premiers résultats par pertinence contextuelle
4. **Facettes dynamiques** : 18 catégories, sous-catégories searchable, territoire hiérarchique (national > régional > départemental > communal), date, qualité, licence

### Exploration des données

- **Preview multi-format** : CSV (tableau interactif avec tri/filtre par colonne), JSON/GeoJSON (arbre collapsible, strip des géométries lourdes), XML (coloration syntaxique), ZIP (listing du contenu), images, PDF
- **Interrogation tabulaire** : filtrage et tri directement sur les fichiers CSV/XLS hébergés sur data.gouv.fr via la Tabular API
- **Détail dataset** : métriques (vues, téléchargements mensuels), ressources, licence, fréquence de mise à jour, organisation
- **OpenAPI Viewer** : navigation des specs API avec "Try It" intégré et proxy CORS
- **Visualisation des tendances** : graphiques d'évolution annuelle des datasets par catégorie, scope géographique et organisation

### Martine - agent conversationnel

Martine est un agent IA accessible via le chat du site et un widget flottant. Elle utilise le tool calling natif de Mistral pour interroger les données :

- **Architecture** : boucle agent Mistral avec 6 outils (search, details, explore, filter, categories, stats), max 5 rounds de tool calling, puis streaming de la réponse finale
- **Outils** : recherche de datasets, exploration tabulaire, filtrage de données, statistiques du catalogue
- **Frontend** : composants structurés par outil (cartes datasets, tableaux de données, vues catégories) avec traces d'outils collapsibles
- **Sessions** : gestion en mémoire avec TTL 30 min et sliding window de 30 messages

### Serveur MCP (19 outils)

Un serveur MCP TypeScript permet à Claude Desktop, Claude Code ou tout agent compatible de manipuler les données publiques :

- **Recherche** : smart_search (expansion Mistral), expand_query, analyze_results
- **Datasets** : info, resources (avec schéma), data (fuzzy matching colonnes), download (500 Mo streaming), metrics, schema
- **APIs** : info, spec OpenAPI, appel proxy, recherche
- **Catalogue** : résumé, catégories, derniers datasets/APIs, health check
- **Pattern clé** : chaque outil tente le proxy enrichi FlowDataGouv puis retombe sur l'API directe data.gouv.fr

## Les défis rencontrés et les solutions apportées

### Défi 1 : Enrichir 73 000 datasets hétérogènes

Chaque jeu de données arrive avec un titre, une description et des tags libres. Pas de catégorisation standardisée, pas de score de qualité, pas de localisation géographique exploitable.

**Solution** : enrichissement par Mistral AI en batch de 10. Chaque dataset reçoit une catégorie (18 possibles), une sous-catégorie, un scope géographique (national/régional/départemental/communal), un résumé en langage naturel, et un score de qualité de 1 à 5. Le tout sans altérer la donnée source.

### Défi 2 : Fiabiliser les agents IA sur de la donnée imparfaite

Premier constat : 30% de taux d'erreur sur les appels MCP. Les agents IA inventent des noms de colonnes ("annee" au lieu de "Année"), les filtres cassent silencieusement, les erreurs déclenchent des boucles de retry.

**Solutions** :
- Fuzzy matching des colonnes (normalisation accents, lowercase, substring match)
- Correction silencieuse plutôt que rejet (l'agent reçoit ses données du premier coup)
- Schéma retourné avec chaque erreur (l'agent peut se corriger en un appel)
- Proxy avec fallback direct vers data.gouv.fr (le service ne s'interrompt jamais)
- Descriptions d'outils réécrites pour guider les agents

**Résultat** : taux d'erreur passé de 30% à ~2%.

### Défi 3 : Auditer 400 000 ressources

Comment vérifier si les 385 000 fichiers référencés sur data.gouv.fr sont réellement accessibles ?

**Solution** : un script TypeScript (`scripts/audit-platform.ts`) qui effectue un HEAD request sur chaque ressource avec gestion de la concurrence, retry, détection du réseau intranet de l'État (RIE), et export CSV en streaming. Le scan complet dure 8 heures et produit un CSV de 139 Mo analysable.

```bash
# Scan complet
npx tsx scripts/audit-platform.ts --full

# Échantillon rapide (10 min)
npx tsx scripts/audit-platform.ts --sample 1000
```

### Défi 4 : Visualiser la santé de l'open data français

À partir des données brutes (73k datasets enrichis + 385k health checks), produire un rapport lisible par un décideur.

**Solution** : un pipeline Python en 4 scripts qui génère 22 figures (carte de France par département, courbe de Lorenz, heatmaps, profils d'organisations) et assemble un rapport Word de 22 pages.

Le pipeline complet est dans [`analysis/`](analysis/).

## Architecture technique

```
Navigateur (React 19)
    |
    +--- Portail Recherche (/explore)
    |    Mistral expansion + moteur in-memory 73k items + re-ranking sémantique
    |
    +--- Détail dataset/API
    |    REST data.gouv.fr + preview multi-format + cache LRU
    |
    v
Next.js 16 (App Router) + API Routes
    |
    +--- Moteur recherche in-memory (scoring v2, 7 champs pondérés, facettes)
    +--- Proxy enrichi Mistral (expansion, rerank, analyse)
    +--- Cache téléchargement LRU (10 Go, streaming)
    v
MCP Server (19 outils, TypeScript)
    |
    +--- Proxy FlowDataGouv (enrichi Mistral) + Fallback direct data.gouv.fr
    +--- Logs structurés NDJSON + endpoint /stats
```

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Framework | Next.js 16, React 19, TypeScript |
| UI | Tailwind CSS 4 + shadcn/ui |
| IA enrichissement | Mistral AI (small + large) |
| Moteur recherche | In-memory sur 73k items (scoring v2, facettes, cache) |
| API source | data.gouv.fr API v1 + v2, Tabular API, Metric API |
| MCP | @modelcontextprotocol/sdk (TypeScript, HTTP/SSE) |
| Base entreprises | SQLite + FTS5 (29M entreprises SIRENE) |
| Audit | TypeScript (scripts/audit-platform.ts) |
| Analyse | Python (pandas, scikit-learn, matplotlib, geopandas, python-docx) |

## Scripts d'analyse

Le dossier [`analysis/`](analysis/) contient le pipeline Python complet pour reproduire l'audit :

| Script | Rôle |
|--------|------|
| `01_prepare.py` | Chargement store.json + CSV audit, feature engineering, mapping départemental |
| `02_revelations.py` | 19 figures (carte France, Lorenz, profils orgs, saisonnalité...) |
| `02b_usage.py` | Analyse d'usage via API Metrics (top 20 datasets, evergreen vs éphémères) |
| `03_report.py` | Génération du rapport Word en 3 actes |

Le script d'audit automatisé est dans [`scripts/audit-platform.ts`](scripts/audit-platform.ts).

Prérequis et instructions détaillées dans [`analysis/README.md`](analysis/README.md).

## Remerciements

- L'équipe [data.gouv.fr](https://www.data.gouv.fr) et la DINUM pour la plateforme et l'API qui rendent ce type d'exploration possible
- [Anthropic](https://anthropic.com) (Claude) pour le développement et l'infrastructure
- [Mistral AI](https://mistral.ai) pour l'enrichissement sémantique et le dialogue

## Licence

MIT

## Contact

Guillaume CLEMENT
- LinkedIn : [guillaume-clement-erp-cloud](https://www.linkedin.com/in/guillaume-clement-erp-cloud/)
- Démo : [demo-fli.fr](https://demo-fli.fr)
- Code : [github.com/FLI-GCT/FlowDataGouv](https://github.com/FLI-GCT/FlowDataGouv)
