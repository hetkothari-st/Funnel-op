import csv
import json
import io
import urllib.request
from datetime import datetime

# Motilal Oswal ScripMaster CSV endpoints (public, no auth required)
SOURCES = [
    {"url": "https://openapi.motilaloswal.com/getscripmastercsv?name=NSEFO", "expiry_time": "14:30:00"},
    {"url": "https://openapi.motilaloswal.com/getscripmastercsv?name=BSEFO", "expiry_time": "00:00:00"},
]

# Symbols we care about
TARGETS = {'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'BSX', 'BKX'}

def parse_csv_from_url(url, expiry_time):
    """Download and parse ScripMaster CSV from Motilal Oswal API."""
    print(f"Downloading {url}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    response = urllib.request.urlopen(req, timeout=30)
    content = response.read().decode('utf-8')

    reader = csv.DictReader(io.StringIO(content))
    contracts = []
    count = 0

    for row in reader:
        sym = row.get('scripshortname', '')
        if sym not in TARGETS:
            continue

        # Parse expiry date from scripname (e.g., "NIFTY 21-Apr-2026 CE 29100")
        parts = row['scripname'].strip().split()
        date_str = None
        for p in parts:
            for fmt in ('%d-%b-%Y', '%d-%B-%Y'):
                try:
                    dt = datetime.strptime(p, fmt)
                    date_str = dt.strftime('%Y-%m-%dT') + expiry_time
                    break
                except ValueError:
                    continue
            if date_str:
                break

        if not date_str:
            continue

        # Normalize strike to 5 decimal places (matches MTClient XML format)
        try:
            strike = f"{float(row['strikeprice']):.5f}"
        except (ValueError, KeyError):
            strike = row.get('strikeprice', '0.00000')

        contracts.append({
            't': row['scripcode'],
            's': sym,
            'e': date_str,
            'st': strike,
            'p': row['optiontype'],
            'd': row.get('scripfullname', row['scripname'])
        })
        count += 1

    print(f"  Parsed {count} contracts.")
    return contracts


if __name__ == "__main__":
    out_file = r"c:\Users\SMARTTOUCH\Desktop\siddhu_bhaiya_api_test\src\contracts_nsefo.json"

    all_contracts = []

    for source in SOURCES:
        try:
            contracts = parse_csv_from_url(source["url"], source["expiry_time"])
            all_contracts.extend(contracts)
        except Exception as e:
            print(f"Warning: Failed to fetch {source['url']}: {e}")

    # Sort combined contracts by ExpiryDate
    print("Sorting all contracts by expiry...")
    all_contracts.sort(key=lambda x: x['e'])

    with open(out_file, 'w') as f:
        json.dump(all_contracts, f)

    print(f"Finished. Extracted {len(all_contracts)} total contracts to {out_file}")
