# FlowDataGouv

Plateforme open source pour explorer les 73 000+ datasets et APIs ouvertes de data.gouv.fr. Recherche intelligente Mistral, moteur de recherche facette in-memory, catalogue enrichi par IA, taxonomie a 3 niveaux.

Projet personnel de [Guillaume CLEMENT](https://www.linkedin.com/in/guillaume-clement-erp-cloud/).

## Principe : IA quand necessaire, code quand suffisant

| Action | Methode |
|--------|---------|
| Chercher des datasets/APIs | Moteur in-memory + expansion Mistral (correction, mots-cles, auto-filtres) |
| Filtrage facettaire | 6 facettes dynamiques cross-filter + date + qualite |
| Filtrage geo hierarchique | National / Regional → regions / Departemental → depts / Communal → communes |
| Scoring pertinence | Scoring v2 per-field (7 champs ponderes + keyword decay + breadth bonus + popularite) |
| Re-ranking semantique | Mistral reordonne le top 20 page 1 par pertinence semantique |
| Explorer le catalogue | SSR + ISR (10 min) depuis catalog.json, fallback client-side |
| Voir detail dataset/API | REST direct data.gouv.fr + metriques + interrogation CSV (filtrage/tri par colonne) |
| Previsualiser ressources | Multi-format : CSV/JSON/GeoJSON/XML/ZIP/Image/PDF (lecture partielle, strip geometries, cap reponse) |
| Telecharger ressources | Cache LRU disque (streaming, eviction par derniere utilisation, 10Go defaut) |
| Enrichissement catalogue | Mistral batch (categorisation, geo, resume, qualite) |
| Normalisation taxonomie | Mistral Large (clustering sous-categories) |

## Fonctionnalites

- **73 000+ datasets** indexes, enrichis et categorises par IA
- **Recherche intelligente** : Mistral corrige les fautes, genere des mots-cles, **coche automatiquement les filtres** (categories, geo)
- **Moteur de recherche in-memory** : scoring v2 per-field sur 73k items, keyword weight decay, breadth bonus, evite les faux positifs ("yonne" ≠ "bayonne")
- **Re-ranking semantique** : Mistral reordonne le top 20 resultats (page 1) par pertinence semantique (cache 1h, timeout 1.5s, fallback silencieux)
- **Cache resultats** : TTL 5 min, max 200 entrees, invalide automatiquement quand store.json change
- **Facettes dynamiques** : categories, sous-categories (searchable), territoire hierarchique, date, qualite, types, licences
- **Filtres geo hierarchiques** : National / Regional → liste des regions / Departemental → departements / Communal → communes (avec recherche)
- **Filtres modernes** : presets date rapides (7j, 30j, 3 mois, 1 an) + score qualite (etoiles)
- **Cross-facet counting** : chaque facette exclut son propre filtre pour des comptages precis
- **Taxonomie 3 niveaux** : 18 categories > sous-categories > sous-sous-categories
- **Categorisation geographique** : national / regional / departemental / communal + zone precise
- **Preview multi-format** : CSV, JSON/GeoJSON (arbre collapsible, strip geometries), XML (coloration syntaxique), ZIP (listing contenu), images, PDF — lecture partielle (2 MB max), cap reponse 80 KB, limite env `PREVIEW_MAX_MB`
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
| Preview JSON | `react-json-view-lite` (arbre collapsible, zero-dep) |
| Preview XML | `react-syntax-highlighter` (PrismLight, XML only) |
| Preview ZIP | `jszip` (listing contenu cote serveur) |
| IA enrichissement | Mistral AI (`mistral-small-latest`) via `@mistralai/mistralai` |
| IA normalisation | Mistral AI (`mistral-large-latest`) pour clustering taxonomique |
| IA recherche | Mistral AI (`mistral-small-latest`) pour expansion de requetes + re-ranking semantique |
| Moteur recherche | In-memory sur store.json (word-boundary, scoring v2 per-field, facettes, cache resultats) |
| API source | REST direct `data.gouv.fr/api/1` |
| MCP | `@modelcontextprotocol/sdk` (TypeScript, stdio) |

## Architecture

```
Navigateur (React 19)
    |
    |--- Landing (/) — SSR + ISR (revalidate 10 min)
    |    HeroSearch → /explore?q=...
    |    QueryExamples (6 requetes cliquables)
    |    CatalogSummary (pre-rendu serveur depuis catalog.json)
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
    |    Preview multi-format (JSON tree, XML highlight, ZIP listing, images, PDF)
    |    Telechargement via /api/download/{id} (cache LRU disque)
    |
    v
API Routes Next.js
    |
    |--- /api/catalog/search      POST — Recherche intelligente (Mistral expansion + scoring v2 + rerank + facettes + logging)
    |--- /api/catalog/summary     GET  — Stats legeres (~50KB : categories, top, geo)
    |--- /api/sync/catalog        POST — Sync incrementale (fetch + enrich + normalize + build)
    |--- /api/catalog             GET  — Sert data/catalog.json complet
    |--- /api/search/expand       POST — Expansion Mistral (correction + mots-cles)
    |--- /api/search/analyze      POST — Analyse agentique (regroupement par theme)
    |--- /api/download/[id]       GET  — Proxy telechargement avec cache LRU disque
    |--- /api/download/stats      GET  — Stats cache (taille, utilisation, nb fichiers)
    |--- /api/datagouv/call       POST — Proxy REST vers data.gouv.fr (Cache-Control 5 min sur donnees stables)
    |--- /api/datagouv/download   GET  — Proxy inline (images, PDF) avec whitelist content-type
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
Les phrases longues (3+ mots) sont decoupees en tokens significatifs. Les compounds de 2 mots sont gardes intacts (evite les faux positifs) :
```
"Trouve tout sur l'Yonne ou sur Dijon" → ["Yonne", "Dijon"]
"identifiant entreprise" → ["identifiant entreprise"]  (PAS ["identifiant", "entreprise"])
"numero SIREN" → ["numero SIREN"]  (PAS ["numero", "SIREN"])
```
Les stop words francais et termes administratifs generiques sont filtres.

### Scoring v2 per-field avec keyword weight decay

| Champ | Poids |
|-------|-------|
| Titre | 10 |
| Organisation | 5 |
| Tags | 4 |
| Themes | 3 |
| Resume | 3 |
| Zone geo | 2 (guard: ignore si vide) |
| Description | 1 |
| Popularite (log10) | +2.5 |
| Qualite | +1.0 |
| HVD (High Value Dataset) | +3 |

**Keyword weight decay** — le premier keyword (intention principale) a le poids max, les suivants (synonymes/qualificatifs) contribuent moins :
```
keyword[0] → 1.0  (intention principale)
keyword[1] → 0.6
keyword[2] → 0.4
keyword[3+] → 0.3
```

**Breadth bonus** — +15% par keyword supplementaire matchant le meme champ (cap a 2 extra).

### Re-ranking semantique (Mistral)

Sur la page 1 (tri par pertinence), les 20 premiers resultats sont re-ordonnes par Mistral Small :
- Cache 1h, timeout 1.5s, fallback silencieux si erreur/timeout
- Privilegie les sources primaires, les datasets nationaux de reference, la qualite et la popularite
- Rate limit partage avec l'expansion (un seul check)

### Cache resultats

Cache in-memory des resultats de recherche (TTL 5 min, max 200 entrees). Invalide automatiquement quand store.json change. Optimise les requetes repetees identiques.

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

### Pipeline de recherche complet

```
Requete utilisateur
  → Expansion Mistral (correction + mots-cles + filtres suggeres)
  → Scoring v2 per-field (keyword weight decay + breadth bonus)
  → Filtrage facettaire (categories, geo, types, date, qualite)
  → Re-ranking Mistral (top 20, page 1 uniquement)
  → Logging consolide (requete + Mistral + top 3 resultats)
  → Reponse JSON
```

### Expansion Mistral → auto-filtrage
La requete est enrichie par Mistral Small, puis les filtres sont **coches automatiquement** :
1. Correction des fautes d'orthographe (bandeau discret)
2. Generation de 3-5 mots-cles pertinents (scoring boost avec weight decay)
3. Detection de categories implicites → **auto-coche dans le FacetPanel**
4. Detection de zones geographiques → **auto-coche geoScope + geoArea** + injection comme keywords (scoring boost)
5. Reconnaissance des regions/departements **meme sans accents** et avec anciennes appellations ("rhone alpes" → Auvergne-Rhone-Alpes, "paca" → Provence-Alpes-Cote d'Azur)
6. L'utilisateur peut decocher les filtres auto-appliques normalement → reset coherent

### Logging consolide

Chaque requete de recherche est loguee avec :
- Requete originale, correction Mistral, mots-cles generes
- Filtres auto-coches par Mistral (categories, geo, areas)
- Filtres utilisateur manuels
- Total resultats, statut rerank, temps de reponse
- Top 3 resultats (titre, score, vues)

```
[search] q="ecoles rhone alpes" corrected="ecoles Rhone-Alpes" kw=[...] mistral=[cat=education-recherche, geo=regional, area=Auvergne-Rhone-Alpes] → 2644 results (reranked) (2901ms)
  1. "Lycees publics - Auvergne-Rhone-alpes" [18.4] 666v
  2. "Departements de france" [18.4] 40663v
  3. "Reseau interurbain Cars Region Express" [18.7] 3870v
```

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

## Rate limiting (API Mistral)

Les routes qui appellent Mistral AI sont protegees par un rate limiter in-memory (500 req/24h par IP par defaut).

| Route | Comportement |
|-------|-------------|
| `/api/catalog/search` | Rate limit **uniquement si le cache Mistral (expansion ou rerank) ne contient pas la requete** |
| `/api/search/expand` | Rate limit systematique |
| `/api/search/analyze` | Rate limit systematique |

### Fonctionnement

- Store `Map<string, {count, resetAt}>` en memoire, nettoyage periodique des entrees expirees
- **Cache-aware** : si l'expansion Mistral est deja en cache, aucun token consomme (evite double comptage)
- Headers de reponse 429 : `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`
- Logs anonymises sur 429 : dernier octet IPv4 / dernier groupe IPv6 mis a zero
- Cote frontend (`/explore`) : message utilisateur "Limite de recherches par 24h atteinte"

> **Note PM2 cluster** : en mode cluster (x2), le store n'est pas partage entre workers. La limite effective est donc ~1000 req/24h. Pour une limite stricte, utiliser Redis.

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
| Preview | Toutes les previsualisations lisent depuis le cache disque |
| Monitoring | `GET /api/download/stats` → `{ totalSize, maxSize, entryCount, utilizationPercent }` |

## Preview multi-format

Le systeme de previsualisation route chaque ressource vers le viewer adapte selon son format :

| Format | Viewer | Methode |
|--------|--------|---------|
| CSV, TSV | `DataTable` + `DataChart` | API tabulaire data.gouv.fr (filtrage/tri par colonne) |
| XLSX, XLS, Parquet | `DataTable` + `DataChart` | API tabulaire uniquement (binaire non previewable sans) |
| JSON, JSONL, GeoJSON | `JsonTreeViewer` (`react-json-view-lite`) | Lecture partielle (2 MB), strip geometries GeoJSON, cap 80 KB |
| XML | `XmlViewer` (`react-syntax-highlighter` PrismLight) | Telechargement texte via cache disque |
| ZIP, GTFS, 7z, RAR, GZ | `ZipViewer` | Listing `jszip` cote serveur (noms, tailles, dossiers) |
| JPG, PNG, GIF, WebP, SVG | `ImageViewer` | Proxy inline `/api/datagouv/download` |
| PDF | `PdfViewer` | Iframe via proxy inline |

### Protections performance

- **Limite de taille** : `PREVIEW_MAX_MB` (defaut 50) — fichiers trop gros masquent le bouton "Visualiser"
- **Lecture partielle** : JSON lu a max 2 MB du fichier, meme pour des fichiers de 50 MB
- **Strip GeoJSON** : les coordonnees de geometries sont remplacees par `[Polygon, ~1234 coords]`
- **Cap reponse** : le JSON envoye au navigateur ne depasse jamais 80 KB (reduction progressive des items)
- **Binaire detecte** : contenu avec caracteres de controle refuse (pas de garbage a l'ecran)

## Ecosysteme MCP + Claude Cowork

### Serveur MCP (mcp/)

18 outils MCP en 4 categories, TypeScript + `@modelcontextprotocol/sdk`, transport stdio + Streamable HTTP :

| Categorie | Outils |
|-----------|--------|
| Recherche intelligente (3) | `smart_search`, `expand_query`, `analyze_results` |
| Datasets & Ressources (6) | `dataset_info`, `dataset_resources`, `resource_data` (filtrage/tri par colonne), `download_resource`, `resource_info`, `dataset_metrics` |
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

### Configuration Claude Code

Le fichier `.mcp.json` a la racine du projet connecte automatiquement Claude Code au serveur MCP :

```json
{
  "mcpServers": {
    "datagouv-mcp": {
      "type": "http",
      "url": "https://demo-fli.fr/mcp"
    }
  }
}
```

> Pour un serveur local, remplacer l'URL par `http://localhost:8000/mcp`.

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
| `RATE_LIMIT_MAX` | Non | Requetes max par jour par IP (routes Mistral) | `500` |
| `DOWNLOAD_CACHE_MAX_GB` | Non | Taille max du cache telechargement (Go) | `10` |
| `PREVIEW_MAX_MB` | Non | Taille max fichier pour previsualisation (Mo) | `50` |

## Structure du projet

```
src/
├── app/
│   ├── page.tsx                         # Landing page (async SSR + ISR 10 min)
│   ├── layout.tsx                       # Layout global (AppHeader + AppFooter)
│   ├── explore/
│   │   ├── page.tsx                     # Portail recherche facettee
│   │   ├── dataset/[id]/page.tsx        # Detail dataset
│   │   └── api/[id]/page.tsx            # Detail API
│   ├── mcp/page.tsx                     # Explorateur MCP
│   └── api/
│       ├── catalog/search/route.ts      # Recherche intelligente (expansion + scoring v2 + rerank + logging)
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
│   │                                    # JsonTreeViewer, XmlViewer, ZipViewer, ImageViewer,
│   │                                    # PdfViewer, DatasetCard, DataserviceCard, ResourceCard
│   ├── layout/                          # AppHeader, AppFooter, HeroSearch
│   ├── shared/                          # MarkdownRenderer, McpStatusBadge
│   └── ui/                              # shadcn/ui (15 composants dont checkbox)
├── lib/
│   ├── catalog/search-engine.ts         # Moteur recherche in-memory (scoring v2, keyword decay, cache resultats)
│   ├── cache/download-cache.ts          # Cache LRU disque (streaming, eviction, concurrence)
│   ├── sync/catalog.ts                  # Pipeline sync (1700+ lignes)
│   ├── search/expand.ts                 # Expansion Mistral (correction + mots-cles + filtres + geo sans accents)
│   ├── search/rerank.ts                 # Re-ranking Mistral (top 20, cache 1h, timeout 1.5s)
│   ├── search/analyze.ts               # Analyse agentique (disponible via API)
│   ├── datagouv/api.ts                  # Client REST data.gouv.fr (preview lit depuis cache)
│   ├── rate-limit.ts                    # Rate limiter in-memory (IP anonymisee, cache-aware)
│   ├── constants.ts                     # RATE_LIMIT, MISTRAL_MODEL, SITE_NAME
│   └── utils.ts
data/
├── store.json                           # Base persistante (~55 MB, 73k+ items enrichis)
├── catalog.json                         # Catalog frontend (~30 MB)
└── taxonomy.json                        # Mapping normalise des sous-categories
```

## Deploiement production

```bash
# Build (postbuild copie automatiquement static/, public/ et .env.local dans standalone/)
npm run build

# Lien symbolique vers data/ (une seule fois)
ln -sf $(pwd)/data .next/standalone/data

# Demarrer avec PM2
pm2 start ecosystem.config.cjs
pm2 save
```

> **Note** : le script `postbuild` (dans `package.json`) copie automatiquement `.next/static`, `public/` et `.env.local` dans `.next/standalone/`. Ne jamais supprimer `.next/` sans rebuilder ensuite.

Voir `.env.production.example` pour les variables de production.

### Nginx (reverse proxy)

Configuration recommandee pour Nginx en front de PM2 :

```nginx
# IPv4 + IPv6 (obligatoire si DNS a un enregistrement AAAA)
listen 443 ssl;
listen [::]:443 ssl;

# Gzip (Next.js compress: false, compression cote Nginx)
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css application/json application/javascript
           text/xml application/xml application/xml+rss text/javascript;

# Rate limiting Nginx (en complement du rate limit applicatif Mistral)
limit_req_zone $binary_remote_addr zone=app:10m rate=120r/m;
limit_req zone=app burst=30 nodelay;

# Headers securite (deja dans next.config.ts, doublon Nginx optionnel)
proxy_pass http://127.0.0.1:3000;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

> **Important** : `compress: false` dans `next.config.ts` est intentionnel — la compression est geree par Nginx pour eviter la double compression. Reduction typique : ~80% sur les reponses JSON/HTML.

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

## Confidentialite et securite

- Aucun cookie, aucun pistage
- Logs anonymises RGPD (dernier octet IP mis a zero, coherent Nginx/applicatif)
- Rate limiting : 500 req/24h par IP sur routes Mistral, 500 req/h proxy applicatif, 120 req/min Nginx global
- IA Mistral (LLM francais, aucune donnee vers les US)
- Headers securite : CSP, HSTS, X-Frame-Options, X-Content-Type-Options (via `next.config.ts`)
- fail2ban SSH, Let's Encrypt SSL, mises a jour automatiques (unattended-upgrades)

## Roadmap MCP

Voir [docs/plan-mcp-game-changer.md](docs/plan-mcp-game-changer.md) pour les evolutions prevues :

1. **Profiling automatique des ressources** : types de colonnes, min/max, nulls, cardinalite
2. **Detection de colonnes pivot** : INSEE, SIRET, code postal, GPS
3. **Cross-dataset** : suggestions de jointures entre datasets partageant les memes identifiants
4. **Tracker de ressources cassees** : signaler les liens morts, suggerer des alternatives
5. **Resume statistique a la volee** : un appel pour decider si une ressource est utile
6. **Requetes multi-ressources** : orchestration en un seul appel via Mistral

## Licence

[MIT License](LICENSE)
