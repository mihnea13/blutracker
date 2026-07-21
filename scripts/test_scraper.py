import os, json
from pathlib import Path

os.environ["BLURAY_USERNAME"]   = "mihnea_1309"
os.environ["BLURAY_PASSWORD"]   = "Xv>8#Kf;6t-$dXJ"
os.environ["BLURAY_PROFILE_ID"] = "972303"

import sys
sys.path.insert(0, str(Path(__file__).parent))
import scraper

scraper.OUT_FILE = Path(__file__).parent / "test_collection.json"
scraper.main()

with open(scraper.OUT_FILE) as f:
    data = json.load(f)

print(f"\n=== REZULTAT FINAL ===")
print(f"Total: {len(data['movies'])} filme")
watched = [m for m in data['movies'] if m['watchDates']]
print(f"Cu watch dates: {len(watched)}")
print(f"\nPrimele 5 cu date:")
for m in watched[:5]:
    print(f"  {m['title']:<35} watched={m['watchDates']}  count={m['watchedCount']}")
print(f"\nFara date (primele 5):")
for m in [x for x in data['movies'] if not x['watchDates']][:5]:
    print(f"  {m['title']}")
