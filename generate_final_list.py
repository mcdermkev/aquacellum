import pandas as pd
import json
from candidates import candidates

# Load species database
df_species = pd.read_parquet('local_species.parquet')
df_species['Genus_lower'] = df_species['Genus'].str.lower()
df_species['Species_lower'] = df_species['Species'].str.lower()

# Load common names database for secondary lookups
df_comnames = pd.read_parquet('local_comnames.parquet')

# Deduplicate candidates by scientific name
seen = set()
unique_candidates = []
for item in candidates:
    sci_name = f"{item[0]} {item[1]}".strip().lower()
    if sci_name in seen:
        continue
    seen.add(sci_name)
    unique_candidates.append(item)

print(f"Total unique candidates in our python list: {len(unique_candidates)}")

matched_count = 0
unmatched_list = []
final_list = []

for genus, species, commonName, category, priorityTier, difficulty, tempRange, phRange in unique_candidates:
    g_lower = genus.strip().lower()
    s_lower = species.strip().lower()
    
    # Try exact match on Genus + Species
    match = df_species[(df_species['Genus_lower'] == g_lower) & (df_species['Species_lower'] == s_lower)]
    
    specCode = None
    if not match.empty:
        specCode = int(match.iloc[0]['SpecCode'])
        matched_count += 1
    else:
        unmatched_list.append((genus, species))
        
    final_list.append({
        "priorityTier": priorityTier,
        "commonName": commonName,
        "scientificName": f"{genus} {species}",
        "specCode": specCode,
        "tempRangeCelsius": tempRange,
        "phRange": phRange,
        "difficulty": difficulty,
        "category": category
    })

print(f"Successfully matched: {matched_count}")
print(f"Unmatched: {len(unmatched_list)}")
if unmatched_list:
    print("Some unmatched ones:")
    for g, s in unmatched_list[:20]:
        print(f"  {g} {s}")

# Write to a temporary JSON file to inspect
with open("temp_output.json", "w") as f:
    json.dump(final_list, f, indent=2)
