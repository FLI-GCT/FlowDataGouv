# FlowDataGouv

> Etude ponctuelle sur l'open data francais, menee de janvier a mars 2026.
> Ce projet est archive. Pour acceder aux donnees publiques francaises,
> nous recommandons le [MCP officiel de data.gouv.fr](https://github.com/datagouv/mcp-data.gouv.fr).

Projet personnel de [Guillaume CLEMENT](https://www.linkedin.com/in/guillaume-clement-erp-cloud/).

**Principe : IA quand necessaire, code quand suffisant.**

## Ce que ce projet a explore

FlowDataGouv est une plateforme experimentale d'exploration des 73 000+ jeux de donnees publiques de [data.gouv.fr](https://www.data.gouv.fr). Le projet combinait recherche intelligente (Mistral AI), un serveur MCP de 19 outils pour agents IA, et un audit automatise de l'integralite des 385 000 ressources du catalogue.

Les resultats :
- Une **interface web complete** avec recherche augmentee par IA, visualisation multi-format et exploration tabulaire
- **Martine**, un agent conversationnel propulse par Mistral avec tool calling natif, capable d'interroger et croiser les donnees en langage naturel
- Un **rapport d'analyse complet** : "Comment j'ai audite la totalite des donnees publiques francaises avec des Agents IA", disponible dans [`analysis/`](analysis/)

### En chiffres

| | |
|---|---|
| Datasets indexes et enrichis par IA | 73 974 |
| Ressources auditees (HEAD request) | 384 928 |
| Outils MCP pour agents IA | 19 |
| Categories thematiques | 18 |
| Organisations analysees | 3 656 |
| Duree du scan complet | 8 heures |
| Taux de disponibilite (hors intranet) | ~83% |

## La plateforme web

### Recherche augmentee par IA

La recherche combine un moteur in-memory sur 73 000 items avec Mistral AI :

1. **Expansion de requete** : Mistral corrige les fautes, genere des mots-cles semantiques, et coche automatiquement les filtres pertinents (categories, zones geographiques)
2. **Scoring multi-champs** : 7 champs ponderes (titre x10, organisation x5, tags x4...) avec keyword weight decay et breadth bonus
3. **Re-ranking semantique** : Mistral reordonne les 20 premiers resultats par pertinence contextuelle
4. **Facettes dynamiques** : 18 categories, sous-categories searchable, territoire hierarchique (national > regional > departemental > communal), date, qualite, licence

### Exploration des donnees

- **Preview multi-format** : CSV (tableau interactif avec tri/filtre par colonne), JSON/GeoJSON (arbre collapsible, strip des geometries lourdes), XML (coloration syntaxique), ZIP (listing du contenu), images, PDF
- **Interrogation tabulaire** : filtrage et tri directement sur les fichiers CSV/XLS heberges sur data.gouv.fr via la Tabular API
- **Detail dataset** : metriques (vues, telechargements mensuels), ressources, licence, frequence de mise a jour, organisation
- **OpenAPI Viewer** : navigation des specs API avec "Try It" integre et proxy CORS
- **Visualisation des tendances** : graphiques d'evolution annuelle des datasets par categorie, scope geographique et organisation

### Martine - agent conversationnel

Martine est un agent IA accessible via le chat du site et un widget flottant. Elle utilise le tool calling natif de Mistral pour interroger les donnees :

- **Architecture** : boucle agent Mistral avec 6 outils (search, details, explore, filter, categories, stats), max 5 rounds de tool calling, puis streaming de la reponse finale
- **Outils** : recherche de datasets, exploration tabulaire, filtrage de donnees, statistiques du catalogue
- **Frontend** : composants structures par outil (cartes datasets, tableaux de donnees, vues categories) avec traces d'outils collapsibles
- **Sessions** : gestion en memoire avec TTL 30 min et sliding window de 30 messages

### Serveur MCP (19 outils)

Un serveur MCP TypeScript permet a Claude Desktop, Claude Code ou tout agent compatible de manipuler les donnees publiques :

- **Recherche** : smart_search (expansion Mistral), expand_query, analyze_results
- **Datasets** : info, resources (avec schema), data (fuzzy matching colonnes), download (500 Mo streaming), metrics, schema
- **APIs** : info, spec OpenAPI, appel proxy, recherche
- **Catalogue** : resume, categories, derniers datasets/APIs, health check
- **Pattern cle** : chaque outil tente le proxy enrichi FlowDataGouv puis retombe sur l'API directe data.gouv.fr

## Les defis rencontres et les solutions apportees

### Defi 1 : Enrichir 73 000 datasets heterogenes

Chaque jeu de donnees arrive avec un titre, une description et des tags libres. Pas de categorisation standardisee, pas de score de qualite, pas de localisation geographique exploitable.

**Solution** : enrichissement par Mistral AI en batch de 10. Chaque dataset recoit une categorie (18 possibles), une sous-categorie, un scope geographique (national/regional/departemental/communal), un resume en langage naturel, et un score de qualite de 1 a 5. Le tout sans alterer la donnee source.

### Defi 2 : Fiabiliser les agents IA sur de la donnee imparfaite

Premier constat : 30% de taux d'erreur sur les appels MCP. Les agents IA inventent des noms de colonnes ("annee" au lieu de "Annee"), les filtres cassent silencieusement, les erreurs declenchent des boucles de retry.

**Solutions** :
- Fuzzy matching des colonnes (normalisation accents, lowercase, substring match)
- Correction silencieuse plutot que rejet (l'agent recoit ses donnees du premier coup)
- Schema retourne avec chaque erreur (l'agent peut se corriger en un appel)
- Proxy avec fallback direct vers data.gouv.fr (le service ne s'interrompt jamais)
- Descriptions d'outils reecrites pour guider les agents

**Resultat** : taux d'erreur passe de 30% a ~2%.

### Defi 3 : Auditer 400 000 ressources

Comment verifier si les 385 000 fichiers references sur data.gouv.fr sont reellement accessibles ?

**Solution** : un script TypeScript (`scripts/audit-platform.ts`) qui effectue un HEAD request sur chaque ressource avec gestion de la concurrence, retry, detection du reseau intranet de l'Etat (RIE), et export CSV en streaming. Le scan complet dure 8 heures et produit un CSV de 139 Mo analysable.

```bash
# Scan complet
npx tsx scripts/audit-platform.ts --full

# Echantillon rapide (10 min)
npx tsx scripts/audit-platform.ts --sample 1000
```

### Defi 4 : Visualiser la sante de l'open data francais

A partir des donnees brutes (73k datasets enrichis + 385k health checks), produire un rapport lisible par un decideur.

**Solution** : un pipeline Python en 4 scripts qui genere 22 figures (carte de France par departement, courbe de Lorenz, heatmaps, profils d'organisations) et assemble un rapport Word de 22 pages.

Le pipeline complet est dans [`analysis/`](analysis/).

## Architecture technique

```
Navigateur (React 19)
    |
    +--- Portail Recherche (/explore)
    |    Mistral expansion + moteur in-memory 73k items + re-ranking semantique
    |
    +--- Detail dataset/API
    |    REST data.gouv.fr + preview multi-format + cache LRU
    |
    v
Next.js 16 (App Router) + API Routes
    |
    +--- Moteur recherche in-memory (scoring v2, 7 champs ponderes, facettes)
    +--- Proxy enrichi Mistral (expansion, rerank, analyse)
    +--- Cache telechargement LRU (10 Go, streaming)
    v
MCP Server (19 outils, TypeScript)
    |
    +--- Proxy FlowDataGouv (enrichi Mistral) + Fallback direct data.gouv.fr
    +--- Logs structures NDJSON + endpoint /stats
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

| Script | Role |
|--------|------|
| `01_prepare.py` | Chargement store.json + CSV audit, feature engineering, mapping departemental |
| `02_revelations.py` | 19 figures (carte France, Lorenz, profils orgs, saisonnalite...) |
| `02b_usage.py` | Analyse d'usage via API Metrics (top 20 datasets, evergreen vs ephemeres) |
| `03_report.py` | Generation du rapport Word en 3 actes |

Le script d'audit automatise est dans [`scripts/audit-platform.ts`](scripts/audit-platform.ts).

Prerequisites et instructions detaillees dans [`analysis/README.md`](analysis/README.md).

## Remerciements

- L'equipe [data.gouv.fr](https://www.data.gouv.fr) et la DINUM pour la plateforme et l'API qui rendent ce type d'exploration possible
- [Anthropic](https://anthropic.com) (Claude) pour le developpement et l'infrastructure
- [Mistral AI](https://mistral.ai) pour l'enrichissement semantique et le dialogue

## Licence

MIT

## Contact

Guillaume CLEMENT
- LinkedIn : [guillaume-clement-erp-cloud](https://www.linkedin.com/in/guillaume-clement-erp-cloud/)
- Demo : [demo-fli.fr](https://demo-fli.fr)
- Code : [github.com/FLI-GCT/FlowDataGouv](https://github.com/FLI-GCT/FlowDataGouv)
