#!/usr/bin/env python3
"""
BluTracker — blu-ray.com scraper (final cu watch dates)
Env vars: BLURAY_USERNAME, BLURAY_PASSWORD, BLURAY_PROFILE_ID
"""

import json, os, re, sys, time
from datetime import datetime
from pathlib import Path
import requests
from bs4 import BeautifulSoup

USERNAME   = os.environ.get("BLURAY_USERNAME",   "")
PASSWORD   = os.environ.get("BLURAY_PASSWORD",   "")
PROFILE_ID = os.environ.get("BLURAY_PROFILE_ID", "")
OUT_FILE   = Path(__file__).parent.parent / "data" / "collection.json"

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
    r'\(TV Series\)'         # explicit marker
    r'|\(TV Mini.?Series\)'  # mini-series
    r'|\(Season\s+\d'        # "(Season 1"
    r'|:\s+Season\s+\d'      # ": Season 1"
    r'|\(Complete Series\)'  # box sets
    r'|\(Seasons?\s+\d'      # "(Seasons 1-3"
    r'|\(TV\)',               # "(TV)" alone
    re.IGNORECASE
)
MOVIE_URL_RX = re.compile(r'https://www\.blu-ray\.com/([A-Za-z0-9][^/"?]+)/(\d{4,})/')


# ── LOGIN ─────────────────────────────────────────────────────
def login(s: requests.Session) -> bool:
    s.get("https://forum.blu-ray.com/login.php", timeout=15)
    s.post("https://forum.blu-ray.com/login.php",
           data={"vb_login_username": USERNAME, "vb_login_password": PASSWORD,
                 "vb_login_md5password": "", "vb_login_md5password_utf": "",
                 "do": "login", "cookieuser": "1", "s": "", "securitytoken": "guest"},
           timeout=15, allow_redirects=True)
    ok = "bbuserid" in s.cookies
    print(f"  {'✓' if ok else '✗'} Login {'reusit' if ok else 'esuat'}")
    return ok


# ── PARSE ONE LETTER PAGE ─────────────────────────────────────
def parse_letter_page(html: str, seen_ids: set) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    movies = []
    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        m = MOVIE_URL_RX.search(href)
        if not m:
            continue
        release_id = m.group(2)
        if release_id in seen_ids:
            continue
        title_raw = (a.get("alt") or a.get("title") or a.get_text()).strip()
        # Extract year BEFORE stripping - critical for accurate TMDB matching
        year_m = re.search(r'\((\d{4})\)\s*$', title_raw)
        year = year_m.group(1) if year_m else ""
        title = re.sub(r'\s*\(\d{4}\)\s*$', '', title_raw).strip()
        if not title or TV_RX.search(title):
            continue
        # Deduplica si pe titlu normalizat
        norm = re.sub(r'[^a-z0-9]', '', title.lower())
        if norm in seen_ids:
            continue
        img = a.find("img")
        poster = (img.get("src") or img.get("data-src") or "") if img else ""
        seen_ids.add(release_id)
        seen_ids.add(norm)
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
    return movies


# ── GET COLLECTION (litera cu litera) ─────────────────────────
def get_owned_collection(s: requests.Session) -> list[dict]:
    all_movies = []
    seen_ids   = set()
    for letter in list("ABCDEFGHIJKLMNOPQRSTUVWXYZ") + ["0"]:
        url = (f"https://www.blu-ray.com/community/collection.php"
               f"?u={PROFILE_ID}&action=hybrid&letter={letter}")
        try:
            resp = s.get(url, timeout=15)
            if resp.status_code != 200:
                continue
            batch = parse_letter_page(resp.text, seen_ids)
            if batch:
                print(f"  {letter}: +{len(batch)} filme")
                all_movies.extend(batch)
        except Exception as e:
            print(f"  {letter}: eroare {e}")
        time.sleep(0.4)
    return all_movies


# ── FETCH PROPERTIES (watch dates + comment) ─────────────────
def fetch_properties(s: requests.Session, release_id: str) -> dict:
    """
    Apeleaza action=properties pentru un film — returneaza watch dates si comment.
    URL descoperit via DevTools: collection.php?action=properties&p=RELEASE_ID&u=UID
    """
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

        # c.watched == 1 inseamna ca filmul e efectiv marcat ca vazut de user
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
    except Exception as e:
        return {}


# ── ENRICH ALL MOVIES WITH PROPERTIES ────────────────────────
def enrich_with_properties(s: requests.Session, movies: list[dict]) -> None:
    print(f"\n  Fetch watch dates pentru {len(movies)} filme...")
    ok_count = 0
    for i, movie in enumerate(movies):
        props = fetch_properties(s, movie["blurayComId"])
        if props:
            movie.update({k: v for k, v in props.items() if v or v == 0})
            if props.get("watchDates"):
                ok_count += 1
        if (i + 1) % 20 == 0:
            print(f"    {i+1}/{len(movies)} procesate ({ok_count} cu date)...")
        time.sleep(0.25)
    print(f"  Done: {ok_count}/{len(movies)} filme cu watch dates")


# ── MAIN ─────────────────────────────────────────────────────
def main():
    if not all([USERNAME, PASSWORD, PROFILE_ID]):
        print("Lipsesc: BLURAY_USERNAME, BLURAY_PASSWORD, BLURAY_PROFILE_ID", file=sys.stderr)
        sys.exit(1)

    s = requests.Session()
    s.headers.update(HEADERS)

    print("1. Login...")
    if not login(s):
        sys.exit(1)

    print("2. Colectie (litera cu litera)...")
    movies = get_owned_collection(s)
    print(f"   Total: {len(movies)} filme")

    if not movies:
        print("EROARE: Niciun film gasit.", file=sys.stderr)
        sys.exit(1)

    print("3. Watch dates + comments...")
    enrich_with_properties(s, movies)

    output = {
        "lastUpdated": datetime.utcnow().isoformat() + "Z",
        "movies": movies,
    }
    OUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")

    watched_n = sum(1 for m in movies if m["watchDates"])
    feat_n    = sum(1 for m in movies if m["hasFeatures"])
    print(f"\n✓ Salvat: {OUT_FILE}")
    print(f"  {len(movies)} filme  |  {watched_n} cu watch dates  |  {feat_n} cu features tags")


if __name__ == "__main__":
    main()
