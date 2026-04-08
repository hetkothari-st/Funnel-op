import xml.etree.ElementTree as ET
import json
import os

def parse_contracts(xml_path, tag_suffix):
    contracts = []
    # Using iterparse for memory efficiency (file is 500MB+)
    context = ET.iterparse(xml_path, events=('end',))
    
    # We are interested in NIFTY and BANKNIFTY for now to keep it lean
    # Added SENSEX (BSX) and BANKEX (BKX) aliases
    targets = {'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'BANKEX', 'BSX', 'BKX'}
    
    count = 0
    for event, elem in context:
        if elem.tag.endswith(tag_suffix):
            data = {}
            for child in elem:
                tag = child.tag.split('}')[-1]
                data[tag] = (child.text or "").strip()
            
            symbol = data.get('Symbol', '')
            
            if symbol in targets:
                # We only need a few fields for the search
                refined = {
                    't': data.get('TokenNo'),
                    's': symbol,
                    'e': data.get('ExpiryDate'),
                    'st': data.get('StrikePrice'),
                    'p': data.get('Series'), # CE/PE or XX/Futures
                    'd': data.get('SymbolDesc') or data.get('SymbolDescription')
                }
                contracts.append(refined)
                count += 1
            
            # Periodically report progress
            if count % 10000 == 0 and count > 0:
                print(f"Parsed {count} records from {tag_suffix}...")
                
            # Clear element to save memory
            elem.clear()
            
    return contracts

if __name__ == "__main__":
    # List of potential paths to check for each file type
    # It will use the first one that exists
    nse_paths = [
        r"D:\MTClient\MTClient\AppData\Contract\NSEFO.xml",
        r"C:\Users\SMARTTOUCH\Downloads\MTClient\NSEFO.xml",
        "NSEFO.xml"
    ]
    
    bse_paths = [
        r"D:\MTClient\MTClient\AppData\Contract\BSEFO.xml", 
        r"C:\Users\SMARTTOUCH\Downloads\MTClient\BSEFO.xml",
        "BSEFO.xml"
    ]

    mappings = []
    
    # helper to find first existing path
    def find_path(paths):
        for p in paths:
            if os.path.exists(p) and os.path.getsize(p) > 1024: # Check existence AND non-empty (>1KB)
                return p
        return None

    valid_nse = find_path(nse_paths)
    if valid_nse:
        mappings.append({"xml": valid_nse, "tag_suffix": "NSEFO", "exch_code": "NSEFO"})
    else:
        print("Warning: No valid (non-empty) NSEFO.xml found in known paths.")

    valid_bse = find_path(bse_paths)
    if valid_bse:
        mappings.append({"xml": valid_bse, "tag_suffix": "BSEFO", "exch_code": "BSEFO"})
    else:
        print("Warning: No valid (non-empty) BSEFO.xml found in known paths.")
    
    out_file = r"c:\Users\SMARTTOUCH\Desktop\siddhu_bhaiya_api_test\src\contracts_nsefo.json"
    
    all_contracts = []
    
    for m in mappings:
        if os.path.exists(m["xml"]):
            print(f"Parsing {m['xml']}...")
            contracts = parse_contracts(m["xml"], m["tag_suffix"])
            all_contracts.extend(contracts)
        else:
            print(f"Warning: {m['xml']} not found.")

    # Sort combined contracts by ExpiryDate
    print("Sorting all contracts by expiry...")
    all_contracts.sort(key=lambda x: x['e'])
            
    with open(out_file, 'w') as f:
        json.dump(all_contracts, f)
    
    print(f"Finished. Extracted {len(all_contracts)} total contracts to {out_file}")
