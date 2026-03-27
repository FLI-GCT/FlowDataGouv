#!/usr/bin/env python3
"""
FlowDataGouv — Rapport serveur complet (7 jours glissants)
Usage: python3 scripts/server-report.py [--days=7]

PIÈGES ET PROBLÈMES RENCONTRÉS (documentation pour reproduction):

  1. QUOTING SHELL SSH
     Problème: f-strings Python avec strftime et accolades cassent les heredocs SSH
     Solution: ne JAMAIS inliner du Python dans un ssh "...", utiliser un fichier .py
     Commande: scp le script puis ssh python3 scripts/server-report.py

  2. NGINX LOGS ROTATÉS
     Problème: logrotate crée access.log.1 (texte) et access.log.{2..7}.gz (gzip)
     Solution: gzip.open pour .gz, open pour les autres, errors="replace" partout
     Piège: les .gz ne sont pas forcément séquentiels, vérifier l'existence

  3. PM2 ENV VARS DISPARUES
     Problème: `pm2 restart all` ne recharge PAS l'ecosystem.config.cjs
     → MCP_LOG_FILE / MARTINE_LOG_FILE = undefined → /stats retourne 0
     Solution: toujours `pm2 delete all && pm2 start ecosystem.config.cjs`
     Vérif: `pm2 env 0 | grep LOG`

  4. SQLITE COLD CACHE (CRITIQUE)
     Problème: better-sqlite3 est synchrone. LIKE %...% sur 29M lignes = 2-30s
     selon que le cache OS est chaud ou froid (base de 4.7 Go)
     Symptôme: 504 Gateway Timeout après chaque restart PM2
     Solution: FTS5 uniquement (2ms), pas de fallback LIKE full scan
     Voir: src/lib/sirene/db.ts

  5. FTS5 INJECTION
     Problème: les inputs utilisateur passés à FTS5 MATCH peuvent contenir
     des opérateurs FTS5 (AND, OR, NOT, NEAR, *, (), etc.)
     Solution: sanitize dans db.ts — strip ['"*(){}[]:^~@!\\] + mots réservés
     Les prepared statements (?) protègent le SQL, mais pas la syntaxe FTS5

  6. ENCODING BINAIRE DANS NGINX
     Problème: des bots TLS/mining envoient du binaire brut, nginx les log
     → UnicodeDecodeError si on ne gère pas
     Solution: errors="replace" sur TOUS les open()

  7. LOGS PM2 ÉCRASÉS AU RESTART
     Problème: pm2 delete écrase out.log/error.log
     → les recherches catalogue et SIRENE loggées avant le restart sont perdues
     Solution: les logs NDJSON (martine.ndjson, mcp-tools.ndjson) persistent
     car ils sont en append-only, pas gérés par PM2

  8. TIMESTAMPS
     Tous les logs sont en UTC (serveur configuré en UTC)
     Les heures affichées dans le rapport sont UTC, pas heure de Paris

  9. IP ANONYMISATION
     Les IPs dans ce rapport sont les vraies IPs (pas de proxy CloudFlare)
     Ne pas partager publiquement
"""

import gzip, os, json, sys, subprocess, re
from datetime import datetime, timedelta
from collections import Counter, defaultdict
from urllib.parse import unquote_plus

DAYS = 7
for arg in sys.argv[1:]:
    if arg.startswith("--days="):
        DAYS = int(arg.split("=")[1])

NOW = datetime.now()
CUTOFF = NOW - timedelta(days=DAYS)
SEP = "=" * 72


def section(title):
    print(f"\n{SEP}")
    print(f"  {title}")
    print(SEP)


# ─────────────────────────────────────────────────────────
# 1. SANTÉ SERVEUR
# ─────────────────────────────────────────────────────────
section("1. SANTE SERVEUR")

with open("/proc/uptime") as f:
    up_secs = float(f.read().split()[0])
    days_up = int(up_secs // 86400)
    hours_up = int((up_secs % 86400) // 3600)
    mins_up = int((up_secs % 3600) // 60)
    print(f"  Uptime:  {days_up}j {hours_up}h {mins_up}m")

with open("/proc/loadavg") as f:
    parts = f.read().split()
    print(f"  Load:    {parts[0]} / {parts[1]} / {parts[2]}")

with open("/proc/meminfo") as f:
    mem = {}
    for line in f:
        key = line.split(":")[0]
        val = int(line.split(":")[1].strip().split()[0])
        mem[key] = val
    total_ram = mem["MemTotal"] / 1048576
    avail_ram = mem["MemAvailable"] / 1048576
    used_ram = total_ram - avail_ram
    ram_pct = used_ram / total_ram * 100
    print(f"  RAM:     {used_ram:.1f} Go / {total_ram:.1f} Go ({ram_pct:.0f}%)")
    swap_total = mem.get("SwapTotal", 0) / 1048576
    swap_free = mem.get("SwapFree", 0) / 1048576
    print(f"  Swap:    {swap_total - swap_free:.1f} Go / {swap_total:.1f} Go")

df_out = subprocess.check_output(["df", "-h", "/"], text=True).split("\n")[1].split()
print(f"  Disque:  {df_out[2]} / {df_out[1]} ({df_out[4]})")

sirene_path = "/var/lib/flowdatagouv/sirene.db"
if os.path.exists(sirene_path):
    size_gb = os.path.getsize(sirene_path) / (1024**3)
    print(f"  SIRENE:  {size_gb:.1f} Go")

# ─────────────────────────────────────────────────────────
# 2. PM2 PROCESSES
# ─────────────────────────────────────────────────────────
section("2. PM2 PROCESSES")

try:
    pm2_raw = subprocess.check_output(["pm2", "jlist"], text=True, stderr=subprocess.DEVNULL)
    pm2_data = json.loads(pm2_raw)
    now_ms = NOW.timestamp() * 1000
    print(f"  {'Nom':25} {'Status':8} {'Uptime':>8} {'Restarts':>9} {'RAM':>7} {'CPU':>5}")
    for p in pm2_data:
        e = p["pm2_env"]
        mem_mb = p["monit"]["memory"] / 1048576
        cpu = p["monit"]["cpu"]
        up_h = (now_ms - e["pm_uptime"]) / 3600000
        restarts = e["restart_time"]
        up_str = f"{up_h/24:.1f}j" if up_h > 24 else f"{up_h:.1f}h"
        print(f"  {p['name']:25} {e['status']:8} {up_str:>8} {restarts:>9} {mem_mb:>6.0f}M {cpu:>4}%")
except Exception as ex:
    print(f"  ERREUR PM2: {ex}")

# ─────────────────────────────────────────────────────────
# 3. NGINX — TRAFIC
# ─────────────────────────────────────────────────────────
cf = CUTOFF.strftime("%d/%m")
nw = NOW.strftime("%d/%m")
section(f"3. NGINX — TRAFIC {DAYS} JOURS ({cf} -> {nw})")

all_lines = []
log_files = ["/var/log/nginx/access.log", "/var/log/nginx/access.log.1"]
log_files += [f"/var/log/nginx/access.log.{i}.gz" for i in range(2, 15)]

for lf in log_files:
    if not os.path.exists(lf):
        continue
    try:
        opener = gzip.open if lf.endswith(".gz") else open
        with opener(lf, "rt", errors="replace") as fh:
            all_lines.extend(fh.readlines())
    except Exception:
        pass

filtered = []
for line in all_lines:
    try:
        s = line.index("[") + 1
        e = line.index("]")
        ds = line[s:e].split()[0]
        dt = datetime.strptime(ds, "%d/%b/%Y:%H:%M:%S")
        if dt >= CUTOFF:
            filtered.append((dt, line))
    except Exception:
        continue

T = len(filtered) or 1
print(f"  Total requetes:  {len(filtered)}")

ips = set()
daily = defaultdict(lambda: {"reqs": 0, "ips": set(), "codes": Counter(), "bytes": 0})
endpoints = Counter()
codes_all = Counter()
ua_cats = Counter()
ip_counter = Counter()
hourly = Counter()
search_queries_nginx = []

for dt, line in filtered:
    parts = line.split()
    if len(parts) < 10:
        continue
    ip = parts[0]
    ips.add(ip)
    ip_counter[ip] += 1
    day = dt.strftime("%Y-%m-%d")
    daily[day]["reqs"] += 1
    daily[day]["ips"].add(ip)
    hourly[dt.hour] += 1

    path = parts[6].split("?")[0]
    full_url = parts[6]
    code = parts[8]
    try:
        byt = int(parts[9])
    except ValueError:
        byt = 0
    daily[day]["bytes"] += byt
    codes_all[code] += 1
    daily[day]["codes"][code] += 1

    # Endpoint grouping
    if path.startswith("/mcp"):
        endpoints["/mcp"] += 1
    elif "/martine" in path and "/api/" in full_url:
        endpoints["/api/martine/*"] += 1
    elif path.startswith("/martine"):
        endpoints["/martine (page)"] += 1
    elif "/sirene" in path:
        endpoints["/api/sirene/*"] += 1
    elif "/catalog/search" in path:
        endpoints["/api/catalog/search"] += 1
        if "q=" in full_url:
            m = re.search(r"q=([^&\s]+)", full_url)
            if m:
                q = unquote_plus(m.group(1))
                if q:
                    search_queries_nginx.append(q)
    elif path.startswith("/api/"):
        endpoints["/api/* (other)"] += 1
    elif path.startswith("/_next/"):
        endpoints["/_next/ (static)"] += 1
    elif path == "/":
        endpoints["/ (accueil)"] += 1
    elif path.startswith("/explore"):
        endpoints["/explore/*"] += 1
    elif path.startswith("/entreprise"):
        endpoints["/entreprise"] += 1
    elif path.startswith("/statut"):
        endpoints["/statut"] += 1
    elif path.startswith("/mcp-guide"):
        endpoints["/mcp-guide"] += 1
    elif path.startswith("/dataset"):
        endpoints["/dataset/*"] += 1
    else:
        endpoints["other"] += 1

    # User agent classification
    ua = " ".join(parts[11:]).lower()
    if any(x in ua for x in ["bot", "crawl", "spider", "semrush", "ahref", "dataforseo", "bytespider", "gptbot"]):
        ua_cats["Bots/Crawlers"] += 1
    elif "curl" in ua:
        ua_cats["curl"] += 1
    elif "python" in ua:
        ua_cats["Python"] += 1
    elif "node" in ua or "axios" in ua:
        ua_cats["Node.js"] += 1
    elif "chrome" in ua and "mobile" in ua:
        ua_cats["Chrome Mobile"] += 1
    elif "chrome" in ua:
        ua_cats["Chrome Desktop"] += 1
    elif "firefox" in ua:
        ua_cats["Firefox"] += 1
    elif "safari" in ua:
        ua_cats["Safari"] += 1
    else:
        ua_cats["Other"] += 1

print(f"  IPs uniques:     {len(ips)}")
total_bytes = sum(d["bytes"] for d in daily.values())
print(f"  Bande passante:  {total_bytes / (1024**2):.0f} Mo")
print(f"  Moy/jour:        {len(filtered) // max(len(daily), 1)} req/j")
print()

# Daily table
print(f"  {'Date':12} {'Req':>7} {'IPs':>5} {'200':>6} {'301':>5} {'404':>6} {'5xx':>5} {'Mo':>7}")
total_5xx = 0
for day in sorted(daily.keys()):
    d = daily[day]
    c = d["codes"]
    c5 = sum(v for k, v in c.items() if k.startswith("5"))
    total_5xx += c5
    mb = d["bytes"] / (1024**2)
    print(f"  {day:12} {d['reqs']:7} {len(d['ips']):5} {c.get('200',0):6} {c.get('301',0):5} {c.get('404',0):6} {c5:5} {mb:7.1f}")

print()

# Hourly distribution
print("  --- Distribution horaire (UTC) ---")
if hourly:
    peak_hour = max(hourly, key=hourly.get)
    low_hour = min(hourly, key=hourly.get)
    max_h = max(hourly.values())
    for h in range(24):
        bar_len = int(hourly.get(h, 0) / max(max_h, 1) * 30)
        bar = "#" * bar_len
        marker = " << pic" if h == peak_hour else (" << creux" if h == low_hour else "")
        print(f"  {h:02}h {hourly.get(h, 0):5} {bar}{marker}")

print()
print("  --- Endpoints ---")
for ep, c in endpoints.most_common(15):
    print(f"  {ep:30} {c:7} ({c/T*100:.1f}%)")

print()
print("  --- Codes HTTP ---")
for code, c in sorted(codes_all.items(), key=lambda x: -x[1]):
    if c >= 2:
        print(f"  {code:6} {c:7} ({c/T*100:.1f}%)")

print()
print("  --- User Agents ---")
for ua, c in ua_cats.most_common():
    print(f"  {ua:20} {c:7} ({c/T*100:.1f}%)")

print()
print("  --- Top 15 IPs ---")
for ip, c in ip_counter.most_common(15):
    pct = c / T * 100
    label = ""
    try:
        import socket
        host = socket.gethostbyaddr(ip)[0]
        label = f" ({host[:35]})"
    except Exception:
        pass
    print(f"  {ip:20} {c:7} ({pct:.1f}%){label}")

# ─────────────────────────────────────────────────────────
# 4. RECHERCHES CATALOGUE (out.log)
# ─────────────────────────────────────────────────────────
section("4. RECHERCHES CATALOGUE (moteur in-memory)")

search_log = "/var/log/flowdatagouv/out.log"
catalog_searches = []
if os.path.exists(search_log):
    with open(search_log, errors="replace") as f:
        for line in f:
            if "[search]" not in line:
                continue
            m = re.search(r'q="(.+?)"', line)
            if m and m.group(1).strip():
                dm = re.match(r"(\d{4}-\d{2}-\d{2})", line)
                date = dm.group(1) if dm else "?"
                results_m = re.search(r"(\d+) results?", line)
                results = results_m.group(1) if results_m else "?"
                ms_m = re.search(r"\((\d+)ms\)", line)
                ms = ms_m.group(1) if ms_m else "?"
                catalog_searches.append({
                    "date": date, "query": m.group(1), "results": results, "ms": ms
                })

print(f"  Total recherches catalogue: {len(catalog_searches)}")
if catalog_searches:
    print()
    print(f"  {'Date':12} {'Duree':>6} {'Res.':>6}  Requete")
    for s in catalog_searches:
        print(f"  {s['date']:12} {s['ms']:>5}ms {s['results']:>6}  {s['query'][:60]}")

# ─────────────────────────────────────────────────────────
# 5. RECHERCHES SIRENE
# ─────────────────────────────────────────────────────────
section("5. RECHERCHES SIRENE")

sirene_searches = []
if os.path.exists(search_log):
    with open(search_log, errors="replace") as f:
        for line in f:
            if "[sirene]" not in line:
                continue
            m = re.search(r'q="(.+?)"', line)
            if m:
                dm = re.match(r"(\d{4}-\d{2}-\d{2})", line)
                date = dm.group(1) if dm else "?"
                sirene_searches.append({"date": date, "query": m.group(1)})

for dt, line in filtered:
    if "/api/sirene/search" in line and "q=" in line:
        m = re.search(r"q=([^&\s]+)", line)
        if m:
            q = unquote_plus(m.group(1))
            if q:
                sirene_searches.append({"date": dt.strftime("%Y-%m-%d"), "query": q})

if sirene_searches:
    seen = set()
    deduped = []
    for s in sirene_searches:
        key = f"{s['date']}:{s['query']}"
        if key not in seen:
            seen.add(key)
            deduped.append(s)
    print(f"  Total recherches SIRENE: {len(deduped)}")
    print()
    for s in deduped:
        print(f"  {s['date']:12}  {s['query']}")
else:
    print("  Aucune recherche SIRENE loggee")
    print("  (les logs out.log sont reinitialises au restart PM2)")

# ─────────────────────────────────────────────────────────
# 6. MARTINE (chat IA)
# ─────────────────────────────────────────────────────────
section("6. MARTINE — CONVERSATIONS & TOOLS")

martine_log = "/var/log/flowdatagouv/martine.ndjson"
martine_convos = []
martine_tools = []
martine_sessions = []

if os.path.exists(martine_log):
    with open(martine_log, errors="replace") as f:
        for line in f:
            try:
                e = json.loads(line.strip())
                if e["type"] == "conversation":
                    martine_convos.append(e)
                elif e["type"] == "tool_call":
                    martine_tools.append(e)
                elif e["type"] == "session":
                    martine_sessions.append(e)
            except Exception:
                pass

print(f"  Conversations: {len(martine_convos)}")
print(f"  Tool calls:    {len(martine_tools)}")
print(f"  Sessions:      {len(martine_sessions)}")

if martine_convos:
    durations = [c.get("total_ms", 0) for c in martine_convos]
    avg_ms = sum(durations) / len(durations)
    print(f"  Duree moyenne:  {avg_ms/1000:.1f}s")
    print()
    print(f"  {'Date':17} {'Tools':>5} {'Duree':>7}  Requete")
    for c in martine_convos:
        ts = c["ts"][:16].replace("T", " ")
        rounds = c.get("tool_rounds", 0)
        ms = c.get("total_ms", 0)
        q = c.get("query", "?")[:55]
        print(f"  {ts:17} {rounds:5} {ms/1000:6.1f}s  {q}")

if martine_tools:
    print()
    tool_counter = Counter(t["tool"] for t in martine_tools)
    print("  --- Tools utilises ---")
    for tool, count in tool_counter.most_common():
        avg = sum(t.get("duration_ms", 0) for t in martine_tools if t["tool"] == tool) / count
        errs = sum(1 for t in martine_tools if t["tool"] == tool and t["status"] != "ok")
        print(f"  {tool:30} {count:4}x  {avg:6.0f}ms avg  {errs} err")

# ─────────────────────────────────────────────────────────
# 7. MCP SERVER
# ─────────────────────────────────────────────────────────
section("7. MCP SERVER — TOOL CALLS")

mcp_log = "/var/log/flowdatagouv/mcp-tools.ndjson"
mcp_calls = []
if os.path.exists(mcp_log):
    with open(mcp_log, errors="replace") as f:
        for line in f:
            try:
                mcp_calls.append(json.loads(line.strip()))
            except Exception:
                pass

mcp_stderr = "/var/log/flowdatagouv/mcp-error.log"
mcp_stderr_calls = []
mcp_queries = []
if os.path.exists(mcp_stderr):
    with open(mcp_stderr, errors="replace") as f:
        for line in f:
            m = re.search(r"\[mcp\] (\w+)\((.*?)\) .{1,3} (ok|ERROR)", line)
            if m:
                tool = m.group(1)
                args = m.group(2)
                status = m.group(3)
                mcp_stderr_calls.append({"tool": tool, "args": args, "status": status, "line": line.strip()})
                qm = re.search(r'query="(.+?)"', args)
                if qm:
                    mcp_queries.append(qm.group(1))
            else:
                m2 = re.search(r"\[mcp\] (\w+) .{1,3} (ERROR|ok)", line)
                if m2:
                    mcp_stderr_calls.append({"tool": m2.group(1), "args": "", "status": m2.group(2), "line": line.strip()})

print(f"  NDJSON calls:    {len(mcp_calls)}")
print(f"  Stderr calls:    {len(mcp_stderr_calls)} (historique complet)")
print(f"  Queries uniques: {len(set(mcp_queries))}")

if mcp_stderr_calls:
    print()
    tool_counter = Counter(c["tool"] for c in mcp_stderr_calls)
    err_counter = Counter(c["tool"] for c in mcp_stderr_calls if c["status"] == "ERROR")
    print(f"  {'Outil':40} {'Calls':>6} {'Errors':>7}")
    for tool, count in tool_counter.most_common():
        errs = err_counter.get(tool, 0)
        print(f"  {tool:40} {count:6} {errs:7}")

if mcp_queries:
    print()
    print("  --- Toutes les queries MCP ---")
    qc = Counter(mcp_queries)
    for q, count in qc.most_common():
        prefix = f"{count}x " if count > 1 else "   "
        print(f"  {prefix}{q[:70]}")

# ─────────────────────────────────────────────────────────
# 8. ERREURS & ANOMALIES
# ─────────────────────────────────────────────────────────
section("8. ERREURS & ANOMALIES")

print(f"  Total 5xx (nginx): {total_5xx}")
if total_5xx > 0:
    for dt, line in filtered:
        parts = line.split()
        if len(parts) > 8 and parts[8].startswith("5"):
            path = parts[6].split("?")[0][:50]
            print(f"  {dt.strftime('%m-%d %H:%M')} {parts[8]} {path}")

print()
scan_paths = Counter()
for dt, line in filtered:
    parts = line.split()
    if len(parts) > 8 and parts[8] == "404":
        path = parts[6].split("?")[0]
        if any(x in path.lower() for x in [
            "wp-", ".env", "admin", "phpmyadmin", "login",
            "config", ".git", "backup", "cgi-bin", "xmlrpc",
            "shell", "eval", "setup", "install"
        ]):
            scan_paths[path] += 1

if scan_paths:
    print(f"  Tentatives de scan (404 suspects): {sum(scan_paths.values())}")
    for path, c in scan_paths.most_common(15):
        print(f"  {c:4}x  {path[:60]}")
else:
    print("  Pas de scan suspect detecte")

mcp_errors = [c for c in mcp_stderr_calls if c["status"] == "ERROR"]
if mcp_errors:
    print()
    print(f"  Erreurs MCP: {len(mcp_errors)}")
    for e in mcp_errors[-5:]:
        print(f"  {e['line'][:100]}")

# ─────────────────────────────────────────────────────────
# 9. SYNTHÈSE RECHERCHES — THÉMATIQUES
# ─────────────────────────────────────────────────────────
section("9. SYNTHESE RECHERCHES — PAR THEMATIQUE")

all_queries = []
for q in mcp_queries:
    all_queries.append(("MCP", q))
for c in martine_convos:
    q = c.get("query", "")
    if q and q.lower() not in ("bonjour", "hello", "hi", "salut"):
        all_queries.append(("Martine", q))
for s in catalog_searches:
    all_queries.append(("Catalogue", s["query"]))
for s in search_queries_nginx:
    all_queries.append(("Catalogue", s))

themes = {
    "Population / Demographie": ["population", "demographie", "démographie", "recensement", "habitant", "communes", "insee"],
    "Qualite air / Environnement": ["air", "pollution", "environnement", "ecologie", "écologie", "biodiversite", "biodiversité", "atmo", "co2", "énergie", "energie"],
    "Transport / Mobilite": ["transport", "mobilite", "mobilité", "velo", "vélo", "tramway", "bus", "metro", "métro", "trafic", "routier", "sytral", "tcl", "cyclable"],
    "Emploi / Recrutement": ["emploi", "recrutement", "tension", "salarie", "salarié", "effectif", "metier", "métier"],
    "Marches publics": ["marche", "marché", "commande publique", "decp", "achat", "cpv", "attribution"],
    "Entreprises / SIRENE": ["siren", "sirene", "entreprise", "societe", "société", "system", "santiane", "flowline", "egapro"],
    "Genealogie / Patronymes": ["genealogie", "généalogie", "patronyme", "nom de famille", "etat civil", "état civil", "decede", "décédé", "naissance", "registre"],
    "Budget / Finances": ["budget", "finance", "depense", "dépense", "loyer", "logement", "immobilier"],
    "Telecom / Audiovisuel": ["fibre", "arcep", "arcom", "telecom", "télécom", "reseau", "réseau", "audiovisuel", "visioconference", "visioconférence"],
    "Culture / Education": ["culture", "education", "éducation", "musee", "musée", "bibliotheque", "bibliothèque", "patrimoine", "tourisme"],
    "Geo / Cadastre": ["cadastre", "geo", "géo", "carte", "yonne"],
}

theme_counts = Counter()
theme_examples = defaultdict(list)
unclassified = []

for source, q in all_queries:
    q_lower = q.lower()
    classified = False
    for theme, keywords in themes.items():
        if any(kw in q_lower for kw in keywords):
            theme_counts[theme] += 1
            if len(theme_examples[theme]) < 3:
                theme_examples[theme].append(q[:50])
            classified = True
            break
    if not classified:
        unclassified.append((source, q))

print(f"  Total recherches classifiees: {sum(theme_counts.values())} / {len(all_queries)}")
print()
print(f"  {'Theme':35} {'Count':>6}  Exemples")
for theme, count in theme_counts.most_common():
    examples = " | ".join(theme_examples[theme][:2])[:55]
    print(f"  {theme:35} {count:6}  {examples}")

if unclassified:
    print()
    print(f"  Non classifiees ({len(unclassified)}):")
    for src, q in unclassified[:10]:
        print(f"  [{src:10}] {q[:60]}")

# ─────────────────────────────────────────────────────────
# 10. PROFILS UTILISATEURS
# ─────────────────────────────────────────────────────────
section("10. PROFILS UTILISATEURS DETECTES")

# Group MCP queries by session (consecutive queries within minutes)
if mcp_queries:
    print("  (Analyses basees sur les patterns de requetes MCP)")
    print()

    # Detect thematic clusters
    clusters = defaultdict(list)
    for q in mcp_queries:
        q_lower = q.lower()
        if any(x in q_lower for x in ["lyon", "dijon"]):
            clusters["Analyste territorial Lyon/Dijon"].append(q)
        elif any(x in q_lower for x in ["audiovisuel", "telecom", "télécom", "arcep", "fibre", "visio"]):
            clusters["Veille telecom/audiovisuel"].append(q)
        elif any(x in q_lower for x in ["genealogie", "généalogie", "patronyme", "santori", "registre"]):
            clusters["Genealogiste"].append(q)
        elif any(x in q_lower for x in ["emploi", "recrutement", "calvados", "normandie"]):
            clusters["Analyste emploi Normandie"].append(q)
        elif any(x in q_lower for x in ["marche", "marché", "decp", "commande publique"]):
            clusters["Prospecteur marches publics"].append(q)

    for profile, queries in sorted(clusters.items(), key=lambda x: -len(x[1])):
        print(f"  {profile} ({len(queries)} requetes):")
        for q in queries[:5]:
            print(f"    - {q[:65]}")
        if len(queries) > 5:
            print(f"    ... et {len(queries)-5} autres")
        print()

# ─────────────────────────────────────────────────────────
# 11. RÉSUMÉ EXÉCUTIF
# ─────────────────────────────────────────────────────────
section("11. RESUME EXECUTIF")

human_ua = sum(ua_cats.get(k, 0) for k in ["Chrome Desktop", "Chrome Mobile", "Firefox", "Safari"])
human_pct = human_ua / T * 100
bot_ua = sum(ua_cats.get(k, 0) for k in ["Bots/Crawlers", "Other"])
bot_pct = bot_ua / T * 100

print(f"  Periode:          {CUTOFF.strftime('%d/%m/%Y')} -> {NOW.strftime('%d/%m/%Y')}")
print(f"  Requetes:         {len(filtered)} ({len(filtered)//max(DAYS,1)}/j)")
print(f"  Visiteurs (IPs):  {len(ips)}")
print(f"  Trafic humain:    ~{human_pct:.0f}%")
print(f"  Trafic bot:       ~{bot_pct:.0f}%")
print(f"  Taux 5xx:         {total_5xx}/{len(filtered)} ({total_5xx/T*100:.1f}%)")
print(f"  Recherches total: {len(all_queries)}")
print(f"  Convos Martine:   {len(martine_convos)}")
print(f"  Calls MCP:        {len(mcp_stderr_calls)}")
print(f"  RAM:              {used_ram:.1f}/{total_ram:.1f} Go ({ram_pct:.0f}%)")
print(f"  Disque:           {df_out[2]}/{df_out[1]} ({df_out[4]})")
print()
print("  --- Alertes ---")
alerts = []
if ram_pct > 80:
    alerts.append(f"  [!] RAM critique: {ram_pct:.0f}%")
if int(df_out[4].rstrip("%")) > 80:
    alerts.append(f"  [!] Disque critique: {df_out[4]}")
if total_5xx > 50:
    alerts.append(f"  [!] 5xx eleves: {total_5xx}")
if sum(scan_paths.values()) > 100:
    alerts.append(f"  [!] Scanning intensif: {sum(scan_paths.values())} tentatives")
if not alerts:
    alerts.append("  [OK] Aucune alerte")
for a in alerts:
    print(a)

print(f"\n{SEP}")
ts = NOW.strftime("%Y-%m-%d %H:%M:%S")
print(f"  Rapport genere le {ts} UTC")
print(f"  Commande: python3 ~/FlowDataGouv/scripts/server-report.py [--days=N]")
print(SEP)
