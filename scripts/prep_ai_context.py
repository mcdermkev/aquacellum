import json
import os

def generate_ai_textbook():
    # Look for the source data in the root directory paths
    source_path = "local_data/supabase_migration_source.json"
    output_path = "local_data/aquacellum_expert_context.txt"
    
    if not os.path.exists(source_path):
        print(f"Error: Could not locate {source_path}")
        return

    with open(source_path, 'r', encoding='utf-8') as f:
        species_list = json.load(f)

    print(f"Parsing {len(species_list)} species into token-dense matrix maps...")
    
    with open(output_path, 'w', encoding='utf-8') as out:
        out.write("[AQUADEX BIOLOGICAL REFERENCE REGISTRY - STRICT SCALED METRICS]\n")
        out.write("METRIC RULES: Temp/pH are scaled x10. Ex: 235 = 23.5C. 72 = pH 7.2.\n\n")
        
        for s in species_list:
            try:
                # Match the exact flattened keys from your Supabase source
                # Multiply by 10 and turn into integers to maintain EVM standard rules
                min_temp = int(float(s['min_temp']) * 10)
                max_temp = int(float(s['max_temp']) * 10)
                min_ph = int(float(s['min_ph']) * 10)
                max_ph = int(float(s['max_ph']) * 10)
                
                common_name = s.get('common_name', 'Unknown')
                scientific_name = s.get('scientific_name', 'Unknown')
                difficulty = s.get('difficulty', 'Intermediate')
                
                # Format into a single compact line for high-speed local inference mapping
                block = f"COMMON:{common_name}|SCIENTIFIC:{scientific_name}|TEMP_MIN:{min_temp}|TEMP_MAX:{max_temp}|PH_MIN:{min_ph}|PH_MAX:{max_ph}|DIFF:{difficulty}\n"
                out.write(block)
            except Exception as e:
                # Skip broken records safely if any values are null
                continue
            
    print(f"Success! Local expert textbook built cleanly at: {output_path}")

if __name__ == "__main__":
    generate_ai_textbook()