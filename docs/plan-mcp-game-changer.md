# Plan MCP Game Changer - Améliorations pour agents IA

## 1. Profiling automatique des ressources

### ✅ Phase 1 réalisée (2026-03-14) : `datagouv_resource_schema`
Expose les colonnes, types et formats d'une ressource tabulaire via l'endpoint `/profile/` de la Tabular API. Les LLMs appellent `resource_schema` AVANT `resource_data` pour connaître les noms exacts de colonnes et éviter le brute-force (cascades de 400).

Retourne pour chaque colonne :
- `name` : nom exact de la colonne
- `type` : type Python détecté (string, int, float...)
- `format` : format sémantique détecté (siren, region, departement, year, pays...)

### Phase 2 à faire : profiling enrichi
Aller au-delà du schema basique :
- Min/max pour les numériques, plages pour les dates
- % de valeurs nulles par colonne
- Cardinalité (nombre de valeurs distinctes)
- Exemples de valeurs (top 5)

**Outil MCP potentiel** : `datagouv_profile_resource` (au-dessus de `resource_schema`)
**Cache** : `data/profiles/{resource_id}.json` avec TTL 7 jours

## 2. Détection de colonnes pivot (INSEE, SIRET, code postal...)
Tagger automatiquement les colonnes qui sont des identifiants standards français :
- CODE_INSEE / code_commune (regex 5 chiffres, lookup table)
- SIRET/SIREN (14/9 chiffres, clé de Luhn)
- Code postal (5 chiffres, plage 01000-98999)
- Code département (2-3 caractères)
- Coordonnées GPS (latitude/longitude)

**Outil MCP** : intégré dans `datagouv_profile_resource`
**Impact** : un agent qui cherche des données sur Dijon reçoit directement "filtre CODE_INSEE = 21231"

## 3. Cross-dataset : suggestions de jointures
Quand un agent consulte un dataset, suggérer des datasets partageant les mêmes colonnes pivot :
- "Tu regardes les prénoms par commune ? Voici 3 datasets avec CODE_INSEE : revenus, démographie, élections"
- Basé sur les profils déjà calculés (étape 1+2)
- Scoring par qualité de jointure (couverture des valeurs communes)

**Outil MCP** : `datagouv_suggest_joins`
**Pré-requis** : profiling d'un volume critique de ressources populaires

## 4. Tracker de ressources cassées
Stocker les échecs de téléchargement (404, timeout, fichier vide) :
- Indiquer à l'agent "cette ressource est morte depuis X jours"
- Suggérer une ressource alternative du même dataset
- Permettre aux agents de ne pas perdre de temps sur des liens morts

**Outil MCP** : `datagouv_resource_status`
**Stockage** : `data/broken-resources.json`
**Plan détaillé** : voir plan existant dans les plans Claude Code

## 5. Résumé statistique à la volée
Un seul appel pour décider si une ressource est utile :
- Nombre de lignes, colonnes
- Période temporelle couverte
- Granularité géographique
- % de valeurs manquantes global
- Fraîcheur (dernière mise à jour réelle vs déclarée)

**Outil MCP** : `datagouv_summarize_resource`
**Différence avec profiling** : plus léger, réponse en une phrase

## 6. Requêtes multi-ressources en un appel
Orchestration interne pour éviter les allers-retours :
- "Donne-moi les données de qualité de l'air à Lyon en 2024"
- Le MCP fait : recherche → sélection → profiling → filtrage → réponse
- Réduit de 5 appels séquentiels à 1 seul

**Outil MCP** : `datagouv_query` (requête en langage naturel sur les données)
**Complexité** : élevée, nécessite Mistral pour l'orchestration

---

## Priorités suggérées
1. **Profiling + colonnes pivot** (1+2) - fondation pour tout le reste — schema basique ✅ (resource_schema), profiling enrichi à faire
2. **Ressources cassées** (4) - quick win, plan déjà écrit
3. **Résumé statistique** (5) - variante légère du profiling
4. **Cross-dataset** (3) - le vrai game changer, dépend de 1+2
5. **Requêtes multi-ressources** (6) - le plus ambitieux

## Notes
- Chaque feature est indépendante et peut être livrée seule
- Le profiling (1) est la brique de base qui débloque 2, 3 et 5
- Date de création : 2026-03-05
