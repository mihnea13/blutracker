#!/usr/bin/env python3
"""
BluTracker — blu-ray.com scraper (final, testat)
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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

FEAT_TOWATCH = re.compile(r'#features_towatch', re.IGNORECASE)
FEAT_WATCHED = re.compile(r'#features_watched', re.IGNORECASE)

# Regex fara $ la sfarsit — gaseste URL-uri in mijlocul HTML-ului
MOVIE_URL_RX = re.compile(
    r'https://www\.blu-ray\.com/([A-Za-z0-9][^/"?]+)/(\d{4,})/'
)

# ── FILTRE ───────────────────────────────────────────────────
TV_RX = re.compile(r'\(TV Series\)', re.IGNORECASE)
INCLUDE_DVD = False  # True = include si DVD-urile

def is_excluded(title: str) -> bool:
    return bool(TV_RX.search(title))


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


def parse_letter_page(html: str, seen_ids: set) -> list[dict]:
    """
    Extrage filme dintr-o pagina filtrata pe litera.
    URL-urile filmelor apar de 2x in HTML (link titlu + link poster).
    Le deduplicam prin seen_ids.
    """
    soup = BeautifulSoup(html, "html.parser")
    movies = []

    # Gasim toate link-urile cu structura /Title/ID/
    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        m = MOVIE_URL_RX.search(href)
        if not m:
            continue

        movie_id = m.group(2)
        if movie_id in seen_ids:
            continue

        # Titlu: din atributul alt sau din textul linkului
        title = (a.get("alt") or a.get("title") or a.get_text()).strip()
        title = re.sub(r'\s*\(\d{4}\)\s*$', '', title).strip()
        if not title:
            continue
        if is_excluded(title):
            continue

        # Poster: imaginea din interiorul link-ului
        img = a.find("img")
        poster = ""
        if img:
            poster = img.get("src") or img.get("data-src") or ""

        # Deduplica titluri (ediatii multiple ale aceluiasi film)
        norm = re.sub(r'[^a-z0-9]', '', title.lower())
        if norm in seen_ids:
            continue
        seen_ids.add(movie_id)
        seen_ids.add(norm)
        movies.append({
            "title":           title,
            "blurayComId":     movie_id,
            "posterUrl":       poster,
            "watchDates":      [],
            "hasFeatures":     False,
            "featuresWatched": False,
            "userComment":     "",
        })

    return movies


def get_owned_collection(s: requests.Session) -> list[dict]:
    all_movies = []
    seen_ids   = set()
    letters    = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ") + ["0"]

    for letter in letters:
        url = (f"https://www.blu-ray.com/community/collection.php"
               f"?u={PROFILE_ID}&action=hybrid&letter={letter}")
        try:
            resp = s.get(url, timeout=15)
            if resp.status_code != 200:
                print(f"  {letter}: HTTP {resp.status_code}, skip")
                continue

            batch = parse_letter_page(resp.text, seen_ids)
            if batch:
                print(f"  {letter}: +{len(batch)} filme")
                all_movies.extend(batch)

        except Exception as e:
            print(f"  {letter}: eroare {e}")

        time.sleep(0.4)

    return all_movies


def enrich_with_reviews(s: requests.Session, movies: list[dict]) -> None:
    """Cauta #features tags in review-urile utilizatorului."""
    by_id = {m["blurayComId"]: m for m in movies}
    print("\n  Cauta #features tags...")

    for page in range(1, 20):
        url = (f"https://www.blu-ray.com/community/reviews.php"
               f"?u={PROFILE_ID}&action=movies&page={page}")
        try:
            resp = s.get(url, timeout=15)
            if resp.status_code != 200:
                break
            soup = BeautifulSoup(resp.text, "html.parser")

            # Fiecare review bloc
            found = 0
            blocks = soup.find_all(attrs={"data-productid": True})
            if not blocks:
                break

            for block in blocks:
                text = block.get_text()
                if not (FEAT_TOWATCH.search(text) or FEAT_WATCHED.search(text)):
                    continue

                # Gaseste movie ID din link
                link = block.find("a", href=MOVIE_URL_RX)
                movie_id = ""
                if link:
                    mm = MOVIE_URL_RX.search(link["href"])
                    if mm:
                        movie_id = mm.group(2)

                if movie_id and movie_id in by_id:
                    by_id[movie_id]["hasFeatures"]    = True
                    by_id[movie_id]["featuresWatched"] = bool(FEAT_WATCHED.search(text))
                    by_id[movie_id]["userComment"]     = text.strip()[:500]
                    found += 1

            if found:
                print(f"    Pagina {page}: {found} cu #features")

        except Exception as e:
            print(f"    Review pagina {page}: eroare {e}")
            break

        time.sleep(0.5)


def main():
    if not all([USERNAME, PASSWORD, PROFILE_ID]):
        print("Lipsesc env vars: BLURAY_USERNAME, BLURAY_PASSWORD, BLURAY_PROFILE_ID", file=sys.stderr)
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

    print("3. Review-uri / #features...")
    enrich_with_reviews(s, movies)

    output = {
        "lastUpdated": datetime.utcnow().isoformat() + "Z",
        "movies": movies,
    }
    OUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n✓ Salvat: {OUT_FILE}")
    print(f"  {len(movies)} filme, {sum(1 for m in movies if m['hasFeatures'])} cu features")


if __name__ == "__main__":
    main()
