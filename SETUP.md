# BluTracker — Ghid de Instalare

## Ce vei obține
O aplicație web PWA instalabilă pe iPhone care tracked-uiește colecția ta Blu-ray/DVD: filme văzute/nevăzute, commentary tracks, și features/extras, sincronizată cu blu-ray.com.

---

## Arhitectura (recapitulare)
```
GitHub Actions (scraper Python) → data/collection.json
GitHub Pages (PWA static)       → aplicația web
Firebase Firestore               → tracking data personal
```

---

## PASUL 1 — Firebase

### 1.1 Crează proiectul Firebase
1. Mergi la [console.firebase.google.com](https://console.firebase.google.com)
2. **Add project** → numele tău ales (ex: `blutracker`)
3. Dezactivează Google Analytics (nu e nevoie)

### 1.2 Activează Firestore
1. Build → **Firestore Database** → Create database
2. **Start in production mode**
3. Alege regiunea cea mai apropiată (ex: `europe-west3` pentru Frankfurt)
4. Done

### 1.3 Setează regulile Firestore
Firestore → Rules → înlocuiește cu:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
**Publish**

### 1.4 Activează Authentication
1. Build → **Authentication** → Get started
2. Sign-in method → **Anonymous** → Enable → Save

### 1.5 Obține config
1. Project Settings (roată) → General → **Your apps** → `</>` (Web)
2. **Register app** → Add Firebase SDK → notează obiectul `firebaseConfig`

---

## PASUL 2 — Repo GitHub

### 2.1 Crează repository-ul
1. [github.com/new](https://github.com/new) → Repository name: `blutracker` (sau ce vrei)
2. ✓ **Public** (necesar pentru GitHub Pages gratuit)
3. Create repository

### 2.2 Inițializează local
Deschide un terminal în `f:\OneDrive - ...\PWA_movies`:
```bash
git init
git add .
git commit -m "init BluTracker"
git remote add origin https://github.com/USERNAME/blutracker.git
git push -u origin main
```

### 2.3 Activează GitHub Pages
1. Repository → Settings → Pages
2. Source: **Deploy from a branch**
3. Branch: `main` / folder: `/ (root)`
4. Save

Aplicația va fi disponibilă la: `https://USERNAME.github.io/blutracker/`

---

## PASUL 3 — Configurare app

### 3.1 Completează js/config.js
Deschide fișierul `js/config.js` și înlocuiește valorile placeholder cu cele din Firebase:
```javascript
const FIREBASE_CONFIG = {
  apiKey:            "AIza...",
  authDomain:        "blutracker-xxxxx.firebaseapp.com",
  projectId:         "blutracker-xxxxx",
  storageBucket:     "blutracker-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123:web:abc123",
};
```
Salvează, commit și push:
```bash
git add js/config.js
git commit -m "add firebase config"
git push
```

> ⚠️ **Repo-ul e public** — nu pune parole sau chei secrete în config.js.
> Firebase config nu e un secret (e inclus oricum în HTML-ul paginii oricărei app Firebase).
> Datele sunt protejate de Firebase Auth + regulile Firestore.

---

## PASUL 4 — Setare scraper (opțional, pentru sync cu blu-ray.com)

### 4.1 Adaugă GitHub Secrets
Repository → Settings → Secrets and variables → Actions → **New repository secret**:

| Secret | Valoare |
|--------|---------|
| `BLURAY_USERNAME` | username-ul tău de pe blu-ray.com |
| `BLURAY_PASSWORD` | parola ta |
| `BLURAY_PROFILE_ID` | ID-ul profilului (vezi URL: `profile.php?profileid=XXXXX`) |

### 4.2 Ajustează scraper-ul
Blu-ray.com poate schimba structura HTML-ului. Dacă scraper-ul nu găsește date:
1. Deschide pagina ta de colecție în Chrome
2. DevTools → Inspector (F12)
3. Caută elementele care conțin titlurile filmelor
4. Actualizează selectorii CSS în `scripts/scraper.py` (marcate cu `# TODO`)

### 4.3 Test manual
```bash
pip install -r scripts/requirements.txt
BLURAY_USERNAME=user BLURAY_PASSWORD=pass BLURAY_PROFILE_ID=12345 python scripts/scraper.py
```

### 4.4 Rulare automată
Scraper-ul rulează automat în fiecare **Luni la 6:00 UTC** via GitHub Actions.
Pentru a rula manual: Actions → "Sync blu-ray.com Collection" → **Run workflow**

---

## PASUL 5 — Primul import de date

### 5.1 Dacă scraper-ul funcționează
1. Rulează manual din GitHub Actions
2. Așteaptă ca `data/collection.json` să fie actualizat
3. Deschide PWA → butonul **⟳ Sync** din header
4. Datele se importă automat (filme + watch history + features tags din comentarii)

### 5.2 Dacă scraper-ul nu e încă configurat
1. Deschide PWA → butonul **⟳ Sync**
2. Va importa cele **38 de filme din Excel** cu commentary data
3. Adaugă singur filmele rămase: vor apărea automat când scraper-ul va rula

---

## PASUL 6 — Instalare pe iPhone

1. Safari → deschide `https://USERNAME.github.io/blutracker/`
2. Butonul Share (□↑) → **Add to Home Screen**
3. Confirmă → icon-ul apare pe Home Screen
4. Deschide — rulează fullscreen, fără bara Safari

---

## Structura datelor

Fiecare film în Firestore are structura:
```javascript
{
  title:              "Apocalypse Now",
  blurayComId:        "12345",
  posterUrl:          "https://...",
  isOwned:            true,
  watchHistory:       [{ date: "2023-11-10", addedAt: "..." }],
  commentaryTracks:   [{ watched: false, watchDate: null }],
  hasGenericFeatures: true,
  genericFeaturesWatched: false,
  specialFeatures:    [
    { id: "sf_1234", name: "Heart of Darkness (1991)", watched: false, watchDate: null }
  ],
  lastSynced: "...",
  addedAt:    "...",
}
```

---

## Funcționalități

| Tab | Ce face |
|-----|---------|
| 📽 Nevăzute | Filmele neîncepute, buton "Marchează văzut" cu setup disc |
| ✓ Văzute | Istoricul vizionărilor, adaugă vizionare nouă |
| 🎙 Comentarii | Tracking per track, sortare by status, 🎲 Random |
| 🎞 Extras | Features generice + features speciale cu denumire |

### La prima marcare ca văzut
Apar câmpuri pentru:
- Data vizionării (default azi)
- Număr commentary tracks (0–20)
- Toggle "Are extras / features"

### Random Commentary
Butonul 🎲 din tab-ul Comentarii alege aleator un film cu commentary tracks nevăzute, deschide secțiunea lui și o evidențiază.

### Feature special
Exemplu: "Heart of Darkness (1991)" pe Apocalypse Now:
1. Tab Extras → Apocalypse Now → deschide secțiunea
2. "+ Feature special" → introdu "Heart of Darkness (1991)" → Adaugă
3. Apare cu ★ și poate fi bifat separat (cu dată)

---

## Troubleshooting

**PWA nu se instalează pe iPhone**
- Trebuie deschis în Safari (nu Chrome/Firefox)
- Site-ul trebuie să fie HTTPS (GitHub Pages e automat)

**Datele nu se salvează**
- Verifică că `FIREBASE_CONFIG` din `js/config.js` e completat corect
- Verifică consola browser (F12) pentru erori Firebase
- Asigură-te că regulile Firestore sunt setate corect

**Datele se resetează la reinstalare**
- Normal: auth anonimă e legată de dispozitivul/browser-ul curent
- Dacă ștergi Safari data sau dezinstalezi PWA, auth se resetează
- Datele rămân în Firestore — re-sync va reîncărca totul

**Poze (postere) nu apar**
- Poster-ele vin din blu-ray.com via scraper
- Fără scraper → placeholder-e generate automat (inițiale + culoare)
- Opțional: adaugă TMDB_API_KEY în `js/config.js` pentru postere mai bune
