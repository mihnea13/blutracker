#!/usr/bin/env python3
"""
BluTracker — blu-ray.com scraper (cu logging persistat)
Env vars: BLURAY_USERNAME, BLURAY_PASSWORD, BLURAY_PROFILE_ID

Scrie doua fisiere in data/:
  collection.json   — datele filmelor (folosit de PWA)
  scraper_log.txt    — log detaliat al rularii (pentru debug, committed pe GitHub)
"""

import json, os, re, sys, time, unicodedata
from datetime import datetime
from pathlib import Path
import requests
from bs4 import BeautifulSoup

USERNAME   = os.environ.get("BLURAY_USERNAME",   "")
PASSWORD   = os.environ.get("BLURAY_PASSWORD",   "")
PROFILE_ID = os.environ.get("BLURAY_PROFILE_ID", "")
OUT_FILE   = Path(__file__).parent.parent / "data" / "collection.json"
LOG_FILE   = Path(__file__).parent.parent / "data" / "scraper_log.txt"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
XHR_HEADERS = {
    **HEADERS,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
}

FEAT_TOWATCH = re.compile(r'#features_towatch', re.IGNORECASE)
FEAT_WATCHED = re.compile(r'#features_watched', re.IGNORECASE)
TV_RX        = re.compile(
    r'\(TV Series\)'
    r'|\(TV Mini.?Series\)'
    r'|\(Season\s+\d'
    r'|:\s+Season\s+\d'
    r'|\(Complete Series\)'
    r'|\(Seasons?\s+\d'
    r'|\(TV\)',
    re.IGNORECASE
)
MOVIE_URL_RX = re.compile(r'https://www\.blu-ray\.com/([A-Za-z0-9][^/"?]+)/(\d{4,})/')
YEAR_IN_TITLE_TAG_RX = re.compile(r'\((\d{4})\)')

# ── LISTA MANUALA DE SERIALE TV ────────────────────────────────
# Pagina de listare (collection.php?action=hybrid&letter=X) nu include
# marcajul "(TV Series)" in atributul alt/title al link-ului pentru toate
# intrarile — unele scapa de regex-ul TV_RX. Adauga aici orice serial nou
# care ajunge gresit in colectie (titlu exact, minuscule):
KNOWN_TV_TITLES = {
    "code geass: lelouch of the rebellion",
    "house of the dragon",
    "human planet",
    "lost",
    "planet earth",
}

def is_excluded(title: str) -> bool:
    if TV_RX.search(title):
        return True
    if title.lower().strip() in KNOWN_TV_TITLES:
        return True
    return False

# ── LOG BUFFER ─────────────────────────────────────────────────
LOG_LINES = []

def log(msg=""):
    """Printeaza normal SI adauga la logul persistat."""
    print(msg)
    LOG_LINES.append(msg)


def fetch_year_from_page(s: requests.Session, href: str) -> str:
    """
    Fetch pagina individuala a filmului pentru a extrage anul, atunci cand
    pagina de listare nu il include (cazul "Graveyard of Honor ()").
    Anul apare sigur in <title> sau meta og:title al paginii individuale.
    """
    try:
        r = s.get(href, timeout=8)
        m = re.search(r'<title>([^<]+)</title>', r.text)
        if m:
            ym = YEAR_IN_TITLE_TAG_RX.search(m.group(1))
            if ym:
                return ym.group(1)
        m2 = re.search(r'property="og:title"\s+content="[^"]*\((\d{4})\)', r.text)
        if m2:
            return m2.group(1)
    except Exception:
        pass
    return ""


def login(s: requests.Session) -> bool:
    s.get("https://forum.blu-ray.com/login.php", timeout=15)
    s.post("https://forum.blu-ray.com/login.php",
           data={"vb_login_username": USERNAME, "vb_login_password": PASSWORD,
                 "vb_login_md5password": "", "vb_login_md5password_utf": "",
                 "do": "login", "cookieuser": "1", "s": "", "securitytoken": "guest"},
           timeout=15, allow_redirects=True)
    ok = "bbuserid" in s.cookies
    log(f"  {'✓' if ok else '✗'} Login {'reusit' if ok else 'esuat'}")
    return ok


# ── PARSE ONE LETTER PAGE ─────────────────────────────────────
def parse_letter_page(s: requests.Session, html: str, seen_ids: set, letter: str, log_detail: dict) -> list[dict]:
    """
    log_detail acumuleaza detalii pentru scraper_log.txt:
      - filtered_tv: titluri respinse ca seriale TV
      - filtered_dup: titluri respinse ca duplicate (release_id sau titlu+an deja vazut)
      - year_resolved: cazuri unde anul a fost obtinut prin fetch suplimentar
    """
    soup = BeautifulSoup(html, "html.parser")
    movies = []
    raw_links_found = 0

    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        m = MOVIE_URL_RX.search(href)
        if not m:
            continue
        raw_links_found += 1
        release_id = m.group(2)
        if release_id in seen_ids:
            continue

        title_raw = (a.get("alt") or a.get("title") or a.get_text()).strip()
        year_m = re.search(r'\((\d{4})\)\s*$', title_raw)
        year = year_m.group(1) if year_m else ""
        title = re.sub(r'\s*\(\d{4}\)\s*$', '', title_raw).strip()

        if not title:
            continue
        if is_excluded(title):
            log_detail["filtered_tv"].append(f"{title} ({year})" if year else title)
            continue

        # NFKD descompune caractere unicode (ex: "³" superscript -> "3" normal),
        # esential pentru ca "Alien³" si "Alien" sa nu se coliziona la normalizare
        title_decomposed = unicodedata.normalize('NFKD', title)
        norm = re.sub(r'[^a-z0-9]', '', title_decomposed.lower())
        key = norm + '|' + year

        if key in seen_ids:
            # Coliziune. Daca anul lipsea, incearca sa-l obtii de pe pagina
            # individuala a filmului — ar putea fi doua filme distincte cu
            # titlu identic (ex. remake), pe care listarea nu le distinge.
            if not year:
                fetched_year = fetch_year_from_page(s, href)
                if fetched_year:
                    key2 = norm + '|' + fetched_year
                    if key2 not in seen_ids:
                        year = fetched_year
                        key = key2
                        log_detail.setdefault("year_resolved", []).append(
                            f"{title} → an confirmat {fetched_year} [letter={letter}]")
                    else:
                        log_detail["filtered_dup"].append(
                            f"{title} [letter={letter}] (an confirmat {fetched_year}, ediție deja existentă)")
                        continue
                else:
                    log_detail["filtered_dup"].append(
                        f"{title} [letter={letter}] (an indisponibil nici pe pagina proprie, tratat ca duplicat)")
                    continue
            else:
                log_detail["filtered_dup"].append(f"{title} ({year}) [letter={letter}]")
                continue

        img = a.find("img")
        poster = (img.get("src") or img.get("data-src") or "") if img else ""
        seen_ids.add(release_id)
        seen_ids.add(key)
        movies.append({
            "title":           title,
            "year":            year,
            "blurayComId":     release_id,
            "posterUrl":       poster,
            "watchDates":      [],
            "watchedCount":    0,
            "hasFeatures":     False,
            "featuresWatched": False,
            "userComment":     "",
        })

    log_detail["raw_links_seen"] = log_detail.get("raw_links_seen", 0) + raw_links_found
    return movies


# ── GET COLLECTION (litera cu litera) ─────────────────────────
def get_owned_collection(s: requests.Session) -> tuple[list[dict], dict]:
    all_movies = []
    seen_ids   = set()
    log_detail = {"filtered_tv": [], "filtered_dup": [], "raw_links_seen": 0, "per_letter": {}}

    for letter in list("ABCDEFGHIJKLMNOPQRSTUVWXYZ") + ["0"]:
        url = (f"https://www.blu-ray.com/community/collection.php"
               f"?u={PROFILE_ID}&action=hybrid&letter={letter}")
        try:
            resp = s.get(url, timeout=15)
            if resp.status_code != 200:
                log(f"  {letter}: HTTP {resp.status_code}, skip")
                log_detail["per_letter"][letter] = f"HTTP {resp.status_code}"
                continue
            batch = parse_letter_page(s, resp.text, seen_ids, letter, log_detail)
            log_detail["per_letter"][letter] = len(batch)
            if batch:
                log(f"  {letter}: +{len(batch)} filme")
                all_movies.extend(batch)
        except Exception as e:
            log(f"  {letter}: eroare {e}")
            log_detail["per_letter"][letter] = f"ERROR: {e}"
        time.sleep(0.4)

    return all_movies, log_detail


# ── FETCH PROPERTIES (watch dates + comment) ─────────────────
def fetch_properties(s: requests.Session, release_id: str) -> dict:
    try:
        r = s.get(
            "https://www.blu-ray.com/community/collection.php",
            params={"action": "properties", "p": release_id, "u": PROFILE_ID, "_": "1"},
            headers=XHR_HEADERS,
            timeout=10
        )
        if not r.text.strip().startswith("{"):
            return {}
        data = r.json()
        c = data.get("c", {})
        p_data = data.get("p", {})

        is_watched = int(c.get("watched") or 0) == 1

        watch_dates = []
        if is_watched:
            if c.get("watcheddate"):
                watch_dates.append(c["watcheddate"])
            if c.get("rewatcheddate"):
                watch_dates.append(c["rewatcheddate"])

        comment = (c.get("comment") or c.get("description") or "").strip()
        poster  = p_data.get("coverurl", "") or ""

        return {
            "watchDates":      sorted(set(d for d in watch_dates if d)),
            "watchedCount":    int(c.get("watchedcount") or 0) if is_watched else 0,
            "hasFeatures":     bool(FEAT_TOWATCH.search(comment) or FEAT_WATCHED.search(comment)),
            "featuresWatched": bool(FEAT_WATCHED.search(comment)),
            "userComment":     comment[:500],
            "posterUrl":       poster,
        }
    except Exception:
        return {}


# ── ENRICH ALL MOVIES WITH PROPERTIES ────────────────────────
def enrich_with_properties(s: requests.Session, movies: list[dict]) -> None:
    log(f"\n  Fetch watch dates pentru {len(movies)} filme...")
    ok_count = 0
    for i, movie in enumerate(movies):
        props = fetch_properties(s, movie["blurayComId"])
        if props:
            movie.update({k: v for k, v in props.items() if v or v == 0})
            if props.get("watchDates"):
                ok_count += 1
        if (i + 1) % 20 == 0:
            log(f"    {i+1}/{len(movies)} procesate ({ok_count} cu date)...")
        time.sleep(0.25)
    log(f"  Done: {ok_count}/{len(movies)} filme cu watch dates")


# ── MAIN ─────────────────────────────────────────────────────
def main():
    run_start = datetime.utcnow()
    log(f"═══ BluTracker Scraper Run — {run_start.isoformat()}Z ═══\n")

    if not all([USERNAME, PASSWORD, PROFILE_ID]):
        log("EROARE: Lipsesc BLURAY_USERNAME, BLURAY_PASSWORD, BLURAY_PROFILE_ID")
        _flush_log()
        sys.exit(1)

    s = requests.Session()
    s.headers.update(HEADERS)

    log("1. Login...")
    if not login(s):
        log("EROARE: Login esuat — verifica credentialele in GitHub Secrets.")
        _flush_log()
        sys.exit(1)

    log("\n2. Colectie (litera cu litera)...")
    movies, log_detail = get_owned_collection(s)
    log(f"\n   Total filme retinute: {len(movies)}")
    log(f"   Total link-uri /Titlu/ID/ vazute in HTML: {log_detail['raw_links_seen']}")

    if log_detail["filtered_tv"]:
        log(f"\n   Filtrate ca seriale TV ({len(log_detail['filtered_tv'])}):")
        for t in log_detail["filtered_tv"]:
            log(f"     - {t}")

    if log_detail.get("year_resolved"):
        log(f"\n   An rezolvat prin fetch suplimentar ({len(log_detail['year_resolved'])}):")
        for t in log_detail["year_resolved"]:
            log(f"     - {t}")

    if log_detail["filtered_dup"]:
        log(f"\n   Filtrate ca duplicate ({len(log_detail['filtered_dup'])}):")
        for t in log_detail["filtered_dup"]:
            log(f"     - {t}")

    if not movies:
        log("\nEROARE: Niciun film gasit.")
        _flush_log()
        sys.exit(1)

    log("\n3. Watch dates + comments...")
    enrich_with_properties(s, movies)

    output = {
        "lastUpdated": datetime.utcnow().isoformat() + "Z",
        "movies": movies,
    }
    OUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")

    watched_n = sum(1 for m in movies if m["watchDates"])
    feat_n    = sum(1 for m in movies if m["hasFeatures"])
    duration  = (datetime.utcnow() - run_start).total_seconds()

    log(f"\n✓ Salvat: {OUT_FILE}")
    log(f"  {len(movies)} filme  |  {watched_n} cu watch dates  |  {feat_n} cu features tags")
    log(f"  Durata rulare: {duration:.1f}s")

    # Listeaza toate titlurile finale, alfabetic, pentru verificare rapida
    log(f"\n── LISTA COMPLETA FILME ({len(movies)}) ──")
    for m in sorted(movies, key=lambda x: x["title"].lower()):
        yr = f" ({m['year']})" if m["year"] else ""
        wd = f" [watched: {','.join(m['watchDates'])}]" if m["watchDates"] else ""
        log(f"  {m['title']}{yr}  id={m['blurayComId']}{wd}")

    _flush_log()


def _flush_log():
    """Scrie tot bufferul de log in scraper_log.txt (suprascrie la fiecare rulare)."""
    try:
        LOG_FILE.write_text("\n".join(LOG_LINES) + "\n", encoding="utf-8")
        print(f"\n[Log salvat: {LOG_FILE}]")
    except Exception as e:
        print(f"[Nu s-a putut salva logul: {e}]")


if __name__ == "__main__":
    main()
