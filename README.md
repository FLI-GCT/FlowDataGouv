# FlowDataGouv

Plateforme open source pour explorer les 73 000+ datasets et APIs ouvertes de data.gouv.fr. Recherche intelligente Mistral, moteur de recherche facette in-memory, catalogue enrichi par IA, taxonomie a 3 niveaux.

Projet personnel de [Guillaume CLEMENT](https://www.linkedin.com/in/guillaume-clement-erp-cloud/).

## Principe : IA quand necessaire, code quand suffisant

| Action | Methode |
|--------|---------|
| Chercher des datasets/APIs | Moteur in-memory + expansion Mistral (correction, mots-cles, auto-filtres) |
| Filtrage facettaire | 6 facettes dynamiques cross-filter + date + qualite |
| Filtrage geo hierarchique | National / Regional → regions / Departemental → depts / Communal → communes |
| Scoring pertinence | Word-boundary matching multi-champs (7 champs ponderes + popularite) |
| Explorer le catalogue | CatalogSummary leger (~50KB) + catalog pre-construit (73k items) |
| Voir detail dataset/API | REST direct data.gouv.fr + metriques + interrogation CSV |
| Telecharger ressources | Cache LRU disque (streaming, eviction par derniere utilisation, 10Go defaut) |
| Enrichissement catalogue | Mistral batch (categorisation, geo, resume, qualite) |
| Normalisation taxonomie | Mistral Large (clustering sous-categories) |

## Fonctionnalites

- **73 000+ datasets** indexes, enrichis et categorises par IA
- **Recherche intelligente** : Mistral corrige les fautes, genere des mots-cles, **coche automatiquement les filtres** (categories, geo)
- **Moteur de recherche in-memory** : scoring word-boundary sur 73k items, evite les faux positifs ("yonne" ≠ "bayonne")
- **Facettes dynamiques** : categories, sous-categories (searchable), territoire hierarchique, date, qualite, types, licences
- **Filtres geo hierarchiques** : National / Regional → liste des regions / Departemental → departements / Communal → communes (avec recherche)
- **Filtres modernes** : presets date rapides (7j, 30j, 3 mois, 1 an) + score qualite (etoiles)
- **Cross-facet counting** : chaque facette exclut son propre filtre pour des comptages precis
- **Taxonomie 3 niveaux** : 18 categories > sous-categories > sous-sous-categories
- **Categorisation geographique** : national / regional / departemental / communal + zone precise
- **Cache telechargement LRU** : proxy serveur avec cache disque (streaming, eviction par derniere utilisation, `DOWNLOAD_CACHE_MAX_GB` configurable)
- **OpenAPI Viewer Swagger-like** : navigation des specs API avec "Try It" integre
- **RGPD** : Mistral AI (LLM francais), aucune donnee envoyee vers les US
- **Serveur MCP** : 18 outils pour Claude Cowork / Claude Desktop / Claude Code
- **Plugin Cowork** : 7 skills + 8 commandes slash

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| UI | Tailwind CSS 4 + shadcn/ui (15 composants) + Lucide icons |
| Graphiques | Recharts 3 (import dynamique, `ssr: false`) |
| IA enrichissement | Mistral AI (`mistral-small-latest`) via `@mistralai/mistralai` |
| IA normalisation | Mistral AI (`mistral-large-latest`) pour clustering taxonomique |
| IA recherche | Mistral AI (`mistral-small-latest`) pour expansion de requetes |
| Moteur recherche | In-memory sur store.json (word-boundary, facettes, scoring) |
| API source | REST direct `data.gouv.fr/api/1` |
| MCP | `@modelcontextprotocol/sdk` (TypeScript, stdio) |

## Architecture

```
Navigateur (React 19)
    |
    |--- Landing (/)
    |    HeroSearch → /explore?q=...
    |    QueryExamples (6 requetes cliquables)
    |    CatalogSummary (stats, categories, top datasets, geo)
    |
    |--- Portail Recherche (/explore)
    |    Barre de recherche (Enter/clic uniquement)
    |    Mistral auto-coche les filtres (categories, geoScopes, geoAreas)
    |    Bandeau correction de faute discret
    |    FacetPanel hierarchique :
    |      Theme (18 cat) → Sous-theme (searchable)
    |      Territoire : National / Regional→regions / Departemental→depts / Communal→communes
    |      Mise a jour (presets 7j/30j/3mois/1an)
    |      Qualite (etoiles 2+/3+/4+)
    |      Type (dataset/API), Licence (searchable)
    |    ResultCard (titre, resume, badges, tags, org, metriques)
    |    ActiveFilters (pills avec suppression, inclut filtres auto-coches)
    |    Pagination + tri (relevance, vues, DL, date, qualite)
    |
    |--- Detail (/explore/dataset/[id], /explore/api/[id])
    |    REST direct data.gouv.fr → metriques, ressources, specs OpenAPI
    |    Telechargement via /api/download/{id} (cache LRU disque)
    |
    v
API Routes Next.js
    |
    |--- /api/catalog/search      POST — Recherche intelligente (Mistral + scoring + facettes)
    |--- /api/catalog/summary     GET  — Stats legeres (~50KB : categories, top, geo)
    |--- /api/sync/catalog        POST — Sync incrementale (fetch + enrich + normalize + build)
    |--- /api/catalog             GET  — Sert data/catalog.json complet
    |--- /api/search/expand       POST — Expansion Mistral (correction + mots-cles)
    |--- /api/search/analyze      POST — Analyse agentique (regroupement par theme)
    |--- /api/download/[id]       GET  — Proxy telechargement avec cache LRU disque
    |--- /api/download/stats      GET  — Stats cache (taille, utilisation, nb fichiers)
    |--- /api/datagouv/call       POST — Proxy REST vers data.gouv.fr
    |--- /api/dataservice/proxy   POST — Proxy CORS pour "Try It" OpenAPI
    |--- /api/health              GET  — Health check
    v
data/
    |--- store.json           (~55 MB) Base persistante des 73k+ items enrichis
    |--- catalog.json         (~30 MB) Catalog pre-construit pour le frontend
    |--- taxonomy.json                  Mapping normalise des sous-categories
    |--- download-cache/               Cache LRU des fichiers telecharges
```

## Moteur de recherche

Le moteur in-memory (`src/lib/catalog/search-engine.ts`) charge store.json en memoire et offre :

### Word-boundary matching
```
"yonne" → matche "Yonne", "l'Yonne", "de Yonne"
"yonne" → ne matche PAS "bayonne", "Bayonne"
```
Utilise des regex `\b` pre-compilees par keyword.

### Normalisation des keywords
Les phrases longues sont decoupees en tokens significatifs :
```
"Trouve tout sur l'Yonne ou sur Dijon" → ["Yonne", "Dijon"]
```
Les stop words francais et termes administratifs generiques sont filtres.

### Scoring multi-champs
| Champ | Poids |
|-------|-------|
| Titre | 10 |
| Zone geo | 8 |
| Organisation | 5 |
| Tags | 4 |
| Themes | 3 |
| Resume | 3 |
| Description | 1 |
| Popularite (log) | +0.5 |

### Facettes cross-filter
6 facettes classiques + 2 filtres avances, chaque facette exclut son propre filtre pour des comptages precis :
- **categories** : 18 themes (environnement, transport, sante, etc.)
- **subcategories** : sous-themes enrichis par Mistral (searchable, 1168 valeurs)
- **geoScopes** : national, regional, departemental, communal (hierarchique avec sous-niveaux)
- **geoAreas** : nom exact de zone avec recherche (6873 communes, 513 departements, etc.)
- **types** : dataset, dataservice
- **licenses** : lov2, odc-odbl, cc-by, etc. (searchable)
- **dateAfter** : presets rapides (7 derniers jours, 30j, 3 mois, 1 an)
- **qualityMin** : score minimum (2+, 3+, 4+) avec affichage etoiles

### Expansion Mistral → auto-filtrage
La requete est enrichie par Mistral Small, puis les filtres sont **coches automatiquement** :
1. Correction des fautes d'orthographe (bandeau discret)
2. Generation de 3-5 mots-cles pertinents (scoring boost)
3. Detection de categories implicites → **auto-coche dans le FacetPanel**
4. Detection de zones geographiques → **auto-coche geoScope + geoArea** + injection comme keywords (scoring boost)
5. L'utilisateur peut decocher les filtres auto-appliques normalement → reset coherent

## Systeme de sync et enrichissement

Le coeur du projet est le pipeline de sync dans `src/lib/sync/catalog.ts` :

### Pipeline

1. **Fetch** : recupere les datasets + APIs depuis data.gouv.fr (incremental)
2. **Enrich** : Mistral categorise par batch de 10 (cat, sub, sub2, geo, area, resume, themes, qualite)
3. **Normalize** : Mistral Large clusterise les sous-categories libres en groupes canoniques
4. **Build** : construit catalog.json avec taxonomie 3 niveaux + stats + geo

### Enrichissement Mistral

- Batch de 10 datasets par appel, concurrency 5 (limite Mistral: 6 req/s)
- Retry automatique avec detection rate-limit (429 → pause 5s)
- Checkpoint toutes les 500 enrichissements (resilient aux interruptions)
- Priorite par popularite (views + downloads)
- ~5.7 items/s, ~3h pour 73k items

### Normalisation taxonomique

**Mode incremental** (par defaut quand `taxonomy.json` existe) :
- 0 nouvelles sous-categories → conserve la taxonomie existante (aucun appel Mistral)
- 1-4 nouvelles sous-categories → ajoutees au groupe "Autres" (aucun appel Mistral)
- 5+ nouvelles sous-categories → re-clusterise uniquement cette categorie via Mistral Large
- Categories sans changement → inchangees

**Mode complet** (`?force_normalize=true` ou aucun `taxonomy.json`) :
- Re-clusterise TOUTES les sous-categories (~18 appels Mistral Large + sub2)

### Taxonomie 3 niveaux

```
Niveau 1 : 18 categories fixes
    environnement, transport-mobilite, logement-urbanisme,
    geographie-cartographie, collectivites-administration,
    economie-emploi, social-solidarite, finances-fiscalite,
    elections-democratie, culture-patrimoine, education-recherche,
    energie, tourisme-loisirs-sport, agriculture-alimentation,
    numerique-technologie, justice-securite, sante, divers

Niveau 2 : ~100 sous-categories (guidance + libre par Mistral)

Niveau 3 : sous-sous-categories (libre par Mistral)
```

### API de sync (`/api/sync/catalog`)

Endpoint POST protege par `SYNC_SECRET` (obligatoire).

| Parametre | Description |
|-----------|-------------|
| `enrich_only=true` | Skip fetch, enrich + rebuild uniquement |
| `rebuild_only=true` | Skip fetch + enrich, rebuild catalog uniquement |
| `max=5000` | Limiter les enrichissements par run |
| `reset=true` | Effacer tous les enrichissements (re-enrichir from scratch) |
| `normalize=true` | Lancer la normalisation taxonomique (incremental par defaut) |
| `force_normalize=true` | Forcer une re-normalisation complete |
| `normalize_model=X` | Modele pour normalisation (defaut: `mistral-large-latest`) |

### Taches cron recommandees

```bash
# Sync quotidienne (fetch + enrich + rebuild) — 15-30 min
0 3 * * * curl -s -X POST "https://mon-site.fr/api/sync/catalog?max=5000" \
  -H "Authorization: Bearer $SYNC_SECRET"

# Normalisation hebdomadaire (incremental) — < 2 min
0 5 * * 0 curl -s -X POST "https://mon-site.fr/api/sync/catalog?rebuild_only=true&normalize=true" \
  -H "Authorization: Bearer $SYNC_SECRET"

# Re-normalisation complete mensuelle — 10-15 min
0 4 1 * * curl -s -X POST "https://mon-site.fr/api/sync/catalog?rebuild_only=true&normalize=true&force_normalize=true" \
  -H "Authorization: Bearer $SYNC_SECRET"
```

## Cache telechargement LRU

Les telechargements de ressources passent par `/api/download/{resourceId}` au lieu d'un lien direct vers data.gouv.fr. Les fichiers sont caches sur le serveur avec eviction LRU.

| Aspect | Detail |
|--------|--------|
| Stockage | `data/download-cache/{resourceId}` (binaire) + `_index.json` (metadata) |
| Limite | `DOWNLOAD_CACHE_MAX_GB` env var (defaut 10 Go) |
| Eviction | Par **date de derniere utilisation** (pas date de telechargement) |
| Streaming | `fetch → Readable.fromWeb → createWriteStream` (jamais de fichier entier en RAM) |
| Concurrence | Map `inProgress` pour eviter double-fetch simultane du meme fichier |
| PM2 cluster | Index lu depuis disque a chaque acces, ecriture atomique (temp + rename) |
| Fallback | Si erreur cache → redirect 302 vers URL originale data.gouv.fr |
| Preview | `downloadAndParseResource()` lit depuis le cache si le fichier est deja cache |
| Monitoring | `GET /api/download/stats` → `{ totalSize, maxSize, entryCount, utilizationPercent }` |

## Ecosysteme MCP + Claude Cowork

### Serveur MCP (mcp/)

18 outils MCP en 4 categories, TypeScript + `@modelcontextprotocol/sdk`, transport stdio + Streamable HTTP :

| Categorie | Outils |
|-----------|--------|
| Recherche intelligente (3) | `smart_search`, `expand_query`, `analyze_results` |
| Datasets & Ressources (6) | `dataset_info`, `dataset_resources`, `resource_data`, `download_resource`, `resource_info`, `dataset_metrics` |
| APIs & Dataservices (4) | `api_info`, `api_spec`, `api_call`, `search_apis` |
| Catalogue & Decouverte (5) | `catalog_summary`, `categories`, `latest_datasets`, `latest_apis`, `health` |

```bash
cd mcp
npm install && npm run build
node dist/index.js     # stdio
node dist/http.js      # Streamable HTTP (port 8000)
```

### Plugin Cowork

7 skills (expertise automatique) + 8 commandes slash :

| Commande | Description |
|----------|-------------|
| `/datagouv:search` | Recherche intelligente |
| `/datagouv:explore` | Explorer un dataset |
| `/datagouv:analyze` | Analyse thematique |
| `/datagouv:territory` | Profil territorial |
| `/datagouv:api-test` | Tester une API |
| `/datagouv:dashboard` | Vue d'ensemble |
| `/datagouv:data-query` | Interroger des donnees |
| `/datagouv:compare` | Comparer territoires/themes |

### Configuration Claude Desktop

```json
{
  "mcpServers": {
    "datagouv-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["<chemin>/FlowDataGouv/mcp/dist/index.js"],
      "env": { "FLOWDATA_URL": "http://localhost:3000" }
    }
  }
}
```

## Pages

| Route | Description |
|-------|-------------|
| `/` | Landing : HeroSearch, QueryExamples, CatalogSummary, LatestContent |
| `/explore` | Portail recherche facettee (FacetPanel, ResultCard, ActiveFilters, Pagination) |
| `/explore/dataset/[id]` | Detail dataset : infos, ressources, metriques, interrogation CSV |
| `/explore/api/[id]` | Detail API : infos, spec OpenAPI Swagger-like avec "Try It" |
| `/mcp` | Explorateur d'outils MCP |

## Installation

```bash
git clone https://github.com/FLI-GCT/FlowDataGouv.git
cd FlowDataGouv
npm install
cp .env.example .env.local
# Editer .env.local avec votre cle Mistral API
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000).

## Variables d'environnement

| Variable | Requis | Description | Defaut |
|----------|--------|-------------|--------|
| `MISTRAL_API_KEY` | Oui | Cle API Mistral | - |
| `MISTRAL_MODEL` | Non | Modele Mistral pour enrichissement | `mistral-small-latest` |
| `SYNC_SECRET` | Oui | Secret pour proteger l'API de sync (obligatoire pour `/api/sync/catalog`) | - |
| `RATE_LIMIT_MAX` | Non | Requetes max par jour par IP | `20` |
| `DOWNLOAD_CACHE_MAX_GB` | Non | Taille max du cache telechargement (Go) | `10` |

## Structure du projet

```
src/
├── app/
│   ├── page.tsx                         # Landing page
│   ├── layout.tsx                       # Layout global (AppHeader + AppFooter)
│   ├── explore/
│   │   ├── page.tsx                     # Portail recherche facettee
│   │   ├── dataset/[id]/page.tsx        # Detail dataset
│   │   └── api/[id]/page.tsx            # Detail API
│   ├── mcp/page.tsx                     # Explorateur MCP
│   └── api/
│       ├── catalog/search/route.ts      # Recherche intelligente (Mistral + scoring + facettes)
│       ├── catalog/summary/route.ts     # Stats legeres (~50KB)
│       ├── sync/catalog/route.ts        # Sync pipeline (fetch + enrich + normalize)
│       ├── catalog/route.ts             # Sert catalog.json complet
│       ├── search/expand/route.ts       # Expansion Mistral (correction + mots-cles)
│       ├── search/analyze/route.ts      # Analyse agentique des resultats
│       ├── download/[resourceId]/route.ts # Proxy telechargement avec cache LRU
│       ├── download/stats/route.ts      # Stats cache telechargement
│       ├── datagouv/call/route.ts       # Proxy REST data.gouv.fr
│       ├── dataservice/proxy/route.ts   # Proxy CORS pour Try It OpenAPI
│       └── health/route.ts              # Health check
├── components/
│   ├── explore/                         # FacetPanel (hierarchique), ResultCard, ActiveFilters,
│   │                                    # ResultsToolbar
│   ├── landing/                         # CatalogSummary, QueryExamples, LatestContent
│   ├── data/                            # DataTable, DataChart, MetricsChart, OpenApiViewer,
│   │                                    # DatasetCard, DataserviceCard, ResourceCard
│   ├── layout/                          # AppHeader, AppFooter, HeroSearch
│   ├── shared/                          # MarkdownRenderer, McpStatusBadge
│   └── ui/                              # shadcn/ui (15 composants dont checkbox)
├── lib/
│   ├── catalog/search-engine.ts         # Moteur recherche in-memory (word-boundary, facettes, date, qualite)
│   ├── cache/download-cache.ts          # Cache LRU disque (streaming, eviction, concurrence)
│   ├── sync/catalog.ts                  # Pipeline sync (1700+ lignes)
│   ├── search/expand.ts                 # Expansion Mistral (correction + mots-cles + filtres)
│   ├── search/analyze.ts               # Analyse agentique (disponible via API)
│   ├── datagouv/api.ts                  # Client REST data.gouv.fr (preview lit depuis cache)
│   ├── constants.ts                     # RATE_LIMIT, MISTRAL_MODEL, SITE_NAME
│   └── utils.ts
data/
├── store.json                           # Base persistante (~55 MB, 73k+ items enrichis)
├── catalog.json                         # Catalog frontend (~30 MB)
└── taxonomy.json                        # Mapping normalise des sous-categories
```

## Deploiement production

```bash
# Build
npm run build

# Copier les fichiers statiques dans le standalone
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
ln -sf $(pwd)/data .next/standalone/data

# Demarrer avec PM2
pm2 start ecosystem.config.cjs
pm2 save
```

Voir `.env.production.example` pour les variables de production.

### Taches cron recommandees

```bash
# Sync quotidienne (fetch + enrich + rebuild) — 15-30 min
0 3 * * * curl -s -X POST "http://localhost:3000/api/sync/catalog?max=5000" \
  -H "Authorization: Bearer $SYNC_SECRET"

# Normalisation hebdomadaire (incremental) — < 2 min
0 5 * * 0 curl -s -X POST "http://localhost:3000/api/sync/catalog?rebuild_only=true&normalize=true" \
  -H "Authorization: Bearer $SYNC_SECRET"

# Re-normalisation complete mensuelle — 10-15 min
0 4 1 * * curl -s -X POST "http://localhost:3000/api/sync/catalog?rebuild_only=true&normalize=true&force_normalize=true" \
  -H "Authorization: Bearer $SYNC_SECRET"
```

## Confidentialite

- Aucun cookie
- Aucun pistage
- Logs anonymises (IP tronquee, RGPD)
- IA Mistral (LLM francais, aucune donnee vers les US)

## Licence

[Apache License 2.0](LICENSE)
