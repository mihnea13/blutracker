#!/usr/bin/env python3
"""
BluTracker — blu-ray.com collection scraper
Rulat de GitHub Actions (săptămânal sau manual).
Exportă data/collection.json cu filmele Owned + watch history + feature tags.

Variabile de mediu necesare (stocate ca GitHub Secrets):
  BLURAY_USERNAME  — username blu-ray.com
  BLURAY_PASSWORD  — parola blu-ray.com
  BLURAY_PROFILE_ID — ID-ul profilului tău (vezi URL-ul profilului)
"""

import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── CONFIGURARE ──────────────────────────────────────────────
USERNAME   = os.environ.get("BLURAY_USERNAME", "")
PASSWORD   = os.environ.get("BLURAY_PASSWORD", "")
PROFILE_ID = os.environ.get("BLURAY_PROFILE_ID", "")
OUT_FILE   = Path(__file__).parent.parent / "data" / "collection.json"

BASE = "https://www.blu-ray.com"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# Taguri features din comentariile utilizatorului (case-insensitive)
FEAT_TOWATCH  = re.compile(r'#features_towatch',  re.IGNORECASE)
FEAT_WATCHED  = re.compile(r'#features_watched',  re.IGNORECASE)


# ── LOGIN ─────────────────────────────────────────────────────
def login(session: requests.Session) -> bool:
    # Preia homepage-ul și găsește formularul de login
    resp = session.get(BASE, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Caută formularul de login în pagină
    form = (
        soup.find("form", {"id": re.compile(r"login", re.I)})
        or soup.find("form", {"action": re.compile(r"login", re.I)})
        or soup.find("form", {"class": re.compile(r"login", re.I)})
    )

    if not form:
        print("✗ Nu am găsit formularul de login în homepage.", file=sys.stderr)
        return False

    action = form.get("action", "")
    if action.startswith("/"):
        post_url = BASE + action
    elif action.startswith("http"):
        post_url = action
    else:
        post_url = BASE + "/" + action

    print(f"  Login URL detectat: {post_url}")

    # Colectează hidden fields
    form_data = {"username": USERNAME, "password": PASSWORD, "remember": "1"}
    for hidden in form.find_all("input", {"type": "hidden"}):
        name = hidden.get("name")
        if name:
            form_data[name] = hidden.get("value", "")

    resp = session.post(post_url, data=form_data, headers=HEADERS,
                        timeout=15, allow_redirects=True)

    if USERNAME.lower() in resp.text.lower() or "logout" in resp.text.lower():
        print(f"✓ Login reușit ca {USERNAME}")
        return True

    print("✗ Login eșuat. Verifică credențialele.", file=sys.stderr)
    return False


# ── COLECȚIE ──────────────────────────────────────────────────
def get_collection(session: requests.Session) -> list[dict]:
    """Preia toate filmele Owned din profilul utilizatorului."""
    movies = []
    page = 1
    
    while True:
        url = (
            f"{BASE}/community/profile.php"
            f"?profileid={PROFILE_ID}&tab=collection&page={page}"
        )
        resp = session.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        
        # TODO: ajustează selectorii după cum apare colecția pe blu-ray.com
        # Caută container-ele de film din pagina de colecție
        items = soup.select("div.collectionmovie, div.movie-item, li.collection-item")
        
        if not items:
            # Fallback: caută tabelul cu filme
            items = soup.select("table.collection tr[data-id], tr.movie-row")
        
        if not items:
            print(f"  Pagina {page}: niciun item găsit, stop.")
            break
        
        print(f"  Pagina {page}: {len(items)} filme")
        
        for item in items:
            movie = parse_collection_item(item)
            if movie:
                movies.append(movie)
        
        # Verifică dacă există pagina următoare
        next_btn = soup.find("a", string=re.compile(r"Next|»|›")) \
            or soup.find("a", {"class": re.compile(r"next|page-next")})
        if not next_btn:
            break
        
        page += 1
        time.sleep(1)  # Politicos cu serverul
    
    return movies


def parse_collection_item(item) -> dict | None:
    """
    Parsează un item din colecție.
    TODO: Ajustează selectorii după structura reală a HTML-ului de pe blu-ray.com
    """
    try:
        # Titlu
        title_el = (
            item.select_one("a.movie-title, span.title, h3 a, td.title a")
            or item.find("a", href=re.compile(r"/movies/"))
        )
        if not title_el:
            return None
        title = title_el.get_text(strip=True)
        
        # ID din URL: /movies/Movie-Name/id/12345/
        href = title_el.get("href", "")
        id_match = re.search(r'/(\d+)/?$', href)
        bluray_id = id_match.group(1) if id_match else ""
        
        # Poster
        img = item.find("img")
        poster_url = img.get("src", "") if img else ""
        if poster_url.startswith("//"):
            poster_url = "https:" + poster_url
        
        return {
            "title":        title,
            "blurayComId":  bluray_id,
            "posterUrl":    poster_url,
            "watchDates":   [],          # va fi umplut mai jos
            "hasFeatures":  False,
            "featuresWatched": False,
            "userComment":  "",
        }
    except Exception as e:
        print(f"  Eroare parsing item: {e}", file=sys.stderr)
        return None


# ── WATCH HISTORY ─────────────────────────────────────────────
def enrich_with_watches(session: requests.Session, movies: list[dict]) -> None:
    """
    Preia datele de vizionare de pe pagina fiecărui film.
    Caută și comentariul utilizatorului pentru taguri #features_.
    """
    print(f"\nÎmbogățire watch history pentru {len(movies)} filme…")
    
    for i, movie in enumerate(movies):
        if not movie["blurayComId"]:
            continue
        
        try:
            url = f"{BASE}/movies/{movie['blurayComId']}/"
            resp = session.get(url, headers=HEADERS, timeout=15)
            soup = BeautifulSoup(resp.text, "html.parser")
            
            # Watch dates — caută în secțiunea utilizatorului
            # TODO: selectorii pot diferi, verifică cu DevTools pe pagina unui film
            watch_dates = []
            
            # Varianta 1: dată ca text în "Watched on: ..." 
            watched_section = soup.find(string=re.compile(r"Watched on:|My Watch Dates"))
            if watched_section:
                parent = watched_section.parent
                date_els = parent.find_all(string=re.compile(r'\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4}'))
                for d in date_els:
                    norm = normalize_date(d.strip())
                    if norm:
                        watch_dates.append(norm)
            
            # Varianta 2: câmp "Seen" sau "Watch count" 
            seen_el = soup.find("span", {"class": re.compile(r"seen|watched|viewcount")})
            if seen_el and not watch_dates:
                # Uneori e doar un număr, nu date exacte
                pass
            
            movie["watchDates"] = sorted(set(watch_dates))
            
            # Caută comentariul utilizatorului pentru #features_ tags
            # Comentariile utilizatorului apar de obicei în secțiunea "My Review" sau "My Notes"
            user_comment_el = (
                soup.find("div", {"class": re.compile(r"user-review|my-review|user-note")})
                or soup.find("p", {"class": re.compile(r"user-comment|my-comment")})
            )
            if user_comment_el:
                comment_text = user_comment_el.get_text()
                movie["userComment"] = comment_text
                movie["hasFeatures"]     = bool(FEAT_TOWATCH.search(comment_text) or FEAT_WATCHED.search(comment_text))
                movie["featuresWatched"] = bool(FEAT_WATCHED.search(comment_text))
            
            if (i + 1) % 10 == 0:
                print(f"  {i + 1}/{len(movies)} procesate…")
            
            time.sleep(0.5)  # respectă rate limiting
            
        except Exception as e:
            print(f"  Eroare {movie['title']}: {e}", file=sys.stderr)


def normalize_date(s: str) -> str | None:
    """Normalizează data la format YYYY-MM-DD"""
    patterns = [
        (r'(\d{4})-(\d{2})-(\d{2})', lambda m: f"{m.group(1)}-{m.group(2)}-{m.group(3)}"),
        (r'(\d{1,2})/(\d{1,2})/(\d{4})', lambda m: f"{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"),
    ]
    for pat, fmt in patterns:
        m = re.search(pat, s)
        if m:
            try:
                d = fmt(m)
                datetime.strptime(d, "%Y-%m-%d")  # validare
                return d
            except ValueError:
                pass
    return None


# ── MAIN ─────────────────────────────────────────────────────
def main():
    if not USERNAME or not PASSWORD or not PROFILE_ID:
        print("Lipsesc variabilele de mediu: BLURAY_USERNAME, BLURAY_PASSWORD, BLURAY_PROFILE_ID", file=sys.stderr)
        sys.exit(1)
    
    session = requests.Session()
    session.headers.update(HEADERS)
    
    print("1. Login…")
    if not login(session):
        sys.exit(1)
    
    print("2. Preia colecție…")
    movies = get_collection(session)
    print(f"   {len(movies)} filme găsite")
    
    print("3. Îmbogățire cu watch history și features tags…")
    enrich_with_watches(session, movies)
    
    output = {
        "lastUpdated": datetime.utcnow().isoformat() + "Z",
        "movies": movies,
    }
    
    OUT_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n✓ Salvat: {OUT_FILE}")
    print(f"  {len(movies)} filme, {sum(len(m['watchDates']) for m in movies)} watch dates totale")


if __name__ == "__main__":
    main()
