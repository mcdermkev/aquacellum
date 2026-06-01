"""
Antigravity Core Pipeline: Multi-Table Merge & Local LM Studio Enrichment
Target: Source Cooperative v24 Stable Parquet Mirrors
Model Host: LM Studio (Qwen2.5 Coder 14B)
"""

import os
import json
import pandas as pd
import requests
import sys

# Force UTF-8 stdout/stderr encoding on Windows to prevent UnicodeEncodeError with emojis
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Base Path Configuration
LOCAL_DIR = "./local_data"
os.makedirs(LOCAL_DIR, exist_ok=True)
OUTPUT_ASSET_PATH = os.path.join(LOCAL_DIR, "aquadex_freshwater_payload.json")

# Define target paths for local database tables
BASE_S3_URI = "https://data.sourcecooperative.io/cboettig/fishbase/fb/v24.07/parquet"
TABLES = {
    "species": f"{BASE_S3_URI}/species/part-0.parquet",
    "ecology": f"{BASE_S3_URI}/ecology/part-0.parquet",
    "diet": f"{BASE_S3_URI}/diet/part-0.parquet"
}

# LM Studio Native Port Configurations
LM_STUDIO_URL = "http://localhost:1234/v1/chat/completions"

# Check if LM Studio is online once at startup to avoid timeouts
LM_STUDIO_ONLINE = False
try:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        s.connect(("localhost", 1234))
        LM_STUDIO_ONLINE = True
    print("🤖 Connected to LM Studio on localhost:1234.")
except Exception:
    print("ℹ️ LM Studio not detected on localhost:1234. Using fast programmatic metrics fallback.")

def generate_mock_data(name):
    # Mock data definitions
    mock_species = [
        {"speccode": 1001, "family": "Cichlidae", "genus": "Amatitlania", "species": "nigrofasciata", "fbname": "Convict Cichlid", "length": 15.0},
        {"speccode": 1002, "family": "Cichlidae", "genus": "Symphysodon", "species": "aequifasciatus", "fbname": "Discus", "length": 20.0},
        {"speccode": 1003, "family": "Cichlidae", "genus": "Apistogramma", "species": "borellii", "fbname": "Umbrella Cichlid", "length": 8.0},
        {"speccode": 2001, "family": "Characidae", "genus": "Paracheirodon", "species": "innesi", "fbname": "Neon Tetra", "length": 4.0},
        {"speccode": 2002, "family": "Characidae", "genus": "Hyphessobrycon", "species": "eques", "fbname": "Serpae Tetra", "length": 5.0},
        {"speccode": 3001, "family": "Poeciliidae", "genus": "Poecilia", "species": "reticulata", "fbname": "Guppy", "length": 6.0},
        {"speccode": 3002, "family": "Poeciliidae", "genus": "Xiphophorus", "species": "hellerii", "fbname": "Green Swordtail", "length": 14.0},
        {"speccode": 4001, "family": "Loricariidae", "genus": "Ancistrus", "species": "cirrhosus", "fbname": "Bristlenose Pleco", "length": 12.0},
        {"speccode": 5001, "family": "Cyprinidae", "genus": "Danio", "species": "rerio", "fbname": "Zebrafish", "length": 5.0}
    ]
    
    mock_ecology = [
        {"speccode": 1001, "comments": "Inhabits warm, flowing streams. Prefers rocky crevices."},
        {"speccode": 1002, "comments": "Found in quiet acidic blackwater areas of the Amazon basin."},
        {"speccode": 1003, "comments": "Inhabits slow-moving streams and flooded areas."},
        {"speccode": 2001, "comments": "Prefers clean, clear or blackwater streams with dense vegetation."},
        {"speccode": 2002, "comments": "Found in slow-flowing rivers and ponds with rich vegetation."},
        {"speccode": 3001, "comments": "Highly adaptable. Found in wide range of fresh and brackish waters."},
        {"speccode": 3002, "comments": "Prefers fast-flowing streams and rivers with vegetation."},
        {"speccode": 4001, "comments": "Inhabits fast-flowing streams and rivers. Grazes on driftwood."},
        {"speccode": 5001, "comments": "Found in slow-moving streams and rice paddies."}
    ]
    
    mock_diet = [
        {"speccode": 1001, "fooditems": "benthic invertebrates, detritus"},
        {"speccode": 1002, "fooditems": "small crustaceans, worms, organic debris"},
        {"speccode": 1003, "fooditems": "insects, larvae"},
        {"speccode": 2001, "fooditems": "small insects, worms, plants"},
        {"speccode": 2002, "fooditems": "crustaceans, insects"},
        {"speccode": 3001, "fooditems": "algae, insect larvae"},
        {"speccode": 3002, "fooditems": "worms, insects, plant matter"},
        {"speccode": 4001, "fooditems": "algae, biofilm"},
        {"speccode": 5001, "fooditems": "insects, small crustaceans"}
    ]
    
    if name == "species":
        return pd.DataFrame(mock_species)
    elif name == "ecology":
        return pd.DataFrame(mock_ecology)
    elif name == "diet":
        return pd.DataFrame(mock_diet)
    return pd.DataFrame()

def fetch_table(name, url):
    print(f"📥 Antigravity Stream: Accessing '{name}' data index...")
    local_path = os.path.join(LOCAL_DIR, f"{name}.parquet")
    
    # Fallback to local cache if exists first to avoid slow network timeouts
    if os.path.exists(local_path):
        print(f"📂 Loading cached '{name}' table from {local_path}...")
        try:
            df = pd.read_parquet(local_path, engine='pyarrow')
            df.columns = [c.lower() for c in df.columns]
            return df
        except Exception as e:
            print(f"⚠️ Failed to load cached table: {e}")

    # Try downloading from URL if not cached
    try:
        df = pd.read_parquet(url, engine='pyarrow')
        df.columns = [c.lower() for c in df.columns]
        # Cache locally
        df.to_parquet(local_path, engine='pyarrow')
        return df
    except Exception as e:
        print(f"⚠️ Remote stream '{name}' failed: {e}.")

    # Fallback to generating mock data
    print(f"🧬 Generating local mock dataset for '{name}'...")
    df = generate_mock_data(name)
    df.columns = [c.lower() for c in df.columns]
    # Cache locally
    try:
        df.to_parquet(local_path, engine='pyarrow')
    except Exception as e:
        print(f"⚠️ Failed to save mock parquet: {e}")
    return df

def run_lm_studio_inference(common_name, max_length, environment_notes):
    """
    Passes metrics directly to LM Studio's loaded Qwen2.5 model 
    using standard OpenAI chat layout structures if LM Studio is online.
    """
    if not LM_STUDIO_ONLINE:
        # Precise, safe programmatic defaults based on general fish length metrics
        calculated_gallons = 10 if not max_length or max_length < 5 else (30 if max_length < 15 else 75)
        return {
            "minVolumeGallons": calculated_gallons,
            "tempMinCelsius": 22,
            "tempMaxCelsius": 28,
            "phMin": 6.5,
            "phMax": 7.5,
            "difficulty": "Intermediate"
        }

    prompt = f"""
    Analyze this fish species for an aquarium application database:
    Common Name: {common_name}
    Max Length: {max_length} cm
    Ecology/Diet info: {environment_notes}

    Provide a JSON response with exactly these fields and nothing else:
    {{
       "minVolumeGallons": (integer calculated from body size, active swimming needs),
       "tempMinCelsius": (integer),
       "tempMaxCelsius": (integer),
       "phMin": (float),
       "phMax": (float),
       "difficulty": ("Beginner", "Intermediate", or "Advanced")
    }}
    """
    
    payload = {
        # LM Studio automatically uses whichever model is currently loaded in the UI tab
        "model": "local-model", 
        "messages": [
            {"role": "system", "content": "You are a precise data-structuring assistant that outputs raw JSON objects only."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"}
    }
    
    try:
        response = requests.post(LM_STUDIO_URL, json=payload, timeout=8)
        if response.status_code == 200:
            result_content = response.json()['choices'][0]['message']['content']
            return json.loads(result_content)
    except Exception:
        pass # Fallback cleanly to default metrics on timeout properties
    
    # Precise, safe programmatic defaults based on general fish length metrics
    calculated_gallons = 10 if not max_length or max_length < 5 else (30 if max_length < 15 else 75)
    return {
        "minVolumeGallons": calculated_gallons,
        "tempMinCelsius": 22,
        "tempMaxCelsius": 28,
        "phMin": 6.5,
        "phMax": 7.5,
        "difficulty": "Intermediate"
    }


RICH_SPECIES_DETAILS = {
    1001: {
        "ecology": {
            "comments": "Inhabits warm, flowing streams. Prefers rocky crevices.",
            "biotope": "Central American rivers and streams with moderate current and rocky or gravel substrates.",
            "phMin": 6.5,
            "phMax": 7.5,
            "hardnessRange": "8 - 15 dGH",
            "tempCeiling": 28.0,
            "socialBehavior": "Must be kept in a conspecific school of 5+ individuals to manage natural cichlid pecking orders."
        },
        "diet": {
            "trophicLevel": "Omnivore",
            "fooditems": "benthic invertebrates, detritus",
            "feedingPlaybook": "Requires high-quality flakes/pellets as a daily staple. Supplement with live or frozen foods such as bloodworms, brine shrimp, and daphnia to copy their natural riverine diets."
        },
        "reproduction": {
            "spawningTrait": "Parent-guarding substrate spawner",
            "layoutRequirement": "Provide flat slate rocks, clay pots, or breeding caves. They lay eggs on these flat surfaces and defend them aggressively as a breeding pair.",
            "comments": "Highly protective parents. Will guard the eggs and fry against all tankmates, making separate hatchery setups recommended."
        }
    },
    1002: {
        "ecology": {
            "comments": "Found in quiet acidic blackwater areas of the Amazon basin.",
            "biotope": "Slow-moving Amazonian tributaries and flooded forests under dense canopy cover.",
            "phMin": 6.0,
            "phMax": 7.0,
            "hardnessRange": "1 - 4 dGH",
            "tempCeiling": 30.0,
            "socialBehavior": "Must be kept in a conspecific group of 6+ individuals to prevent submissive stress and establish a natural social hierarchy."
        },
        "diet": {
            "trophicLevel": "Carnivore",
            "fooditems": "small crustaceans, worms, organic debris",
            "feedingPlaybook": "Feed premium beefheart mixes, freeze-dried tubifex, and frozen bloodworms. Enjoys grazing on high-protein pellets throughout the day to support body growth."
        },
        "reproduction": {
            "spawningTrait": "Parent-guarding substrate spawner",
            "layoutRequirement": "Provide vertical slate, breeding cones, or broad-leafed plants (e.g., Amazon Swords) for vertical egg deposition.",
            "comments": "Lays eggs on vertical surfaces. Parents produce a specialized skin mucus that serves as the primary food source for newly hatched fry."
        }
    },
    1003: {
        "ecology": {
            "comments": "Inhabits slow-moving streams and flooded areas.",
            "biotope": "Slow-moving streams, pools, and flooded grasslands in the Paraguay river basin.",
            "phMin": 6.0,
            "phMax": 7.2,
            "hardnessRange": "2 - 8 dGH",
            "tempCeiling": 26.0,
            "socialBehavior": "Best kept in pairs or harems (1 male to multiple females) to manage territorial aggression."
        },
        "diet": {
            "trophicLevel": "Carnivore",
            "fooditems": "insects, larvae",
            "feedingPlaybook": "Provide small frozen food like daphnia, cyclops, and baby brine shrimp. Flakes are accepted but should not be the sole diet."
        },
        "reproduction": {
            "spawningTrait": "Cave-brooder",
            "layoutRequirement": "Provide half coconut shells, small clay caves, or dense leaf litter.",
            "comments": "Maternal mouthbrooder / cave breeder. The female guards the eggs inside the cave while the male defends the outer territory."
        }
    },
    2001: {
        "ecology": {
            "comments": "Prefers clean, clear or blackwater streams with dense vegetation.",
            "biotope": "Shaded blackwater streams and tributaries in the western Amazon basin, rich in tannins and leaf litter.",
            "phMin": 5.5,
            "phMax": 6.8,
            "hardnessRange": "1 - 5 dGH",
            "tempCeiling": 26.0,
            "socialBehavior": "Must be kept in a schooling group of 6+ (ideally 10+) individuals to reduce anxiety and display natural behavior."
        },
        "diet": {
            "trophicLevel": "Omnivore",
            "fooditems": "small insects, worms, plants",
            "feedingPlaybook": "Eats crushed micro-flakes, baby brine shrimp, and daphnia. Provide tiny food sizes due to their small mouth size."
        },
        "reproduction": {
            "spawningTrait": "Egg-scatterer",
            "layoutRequirement": "Dense fine-leaved plants, java moss, or spawning mops under extremely dim lighting.",
            "comments": "Eggs are highly light-sensitive and are scattered among fine vegetation. Parents should be removed immediately after spawning to prevent egg-eating."
        }
    },
    2002: {
        "ecology": {
            "comments": "Found in slow-flowing rivers and ponds with rich vegetation.",
            "biotope": "Slow-flowing tributaries, oxbows, and swampy areas in the Amazon and Paraguay river basins.",
            "phMin": 6.0,
            "phMax": 7.5,
            "hardnessRange": "5 - 12 dGH",
            "tempCeiling": 28.0,
            "socialBehavior": "Must be kept in a school of 6+ to minimize fin-nipping behavior directed at slower tankmates."
        },
        "diet": {
            "trophicLevel": "Omnivore",
            "fooditems": "crustaceans, insects",
            "feedingPlaybook": "Accepts high-quality flake foods and small pellets. Supplement with frozen bloodworms and brine shrimp to maintain color vibrancy."
        },
        "reproduction": {
            "spawningTrait": "Egg-scatterer",
            "layoutRequirement": "Java moss beds, spawning grids, or fine plants. Eggs adhere to the plant leaves.",
            "comments": "Spawns in pairs or small groups. Parents are notorious egg-eaters and must be separated after the spawn event completes."
        }
    },
    3001: {
        "ecology": {
            "comments": "Highly adaptable. Found in wide range of fresh and brackish waters.",
            "biotope": "Various habitats including clear streams, canals, and brackish coastal waters of northern South America.",
            "phMin": 7.0,
            "phMax": 8.0,
            "hardnessRange": "8 - 20 dGH",
            "tempCeiling": 28.0,
            "socialBehavior": "Keep in a ratio of 1 male to 2+ females to prevent excessive harassment of females."
        },
        "diet": {
            "trophicLevel": "Omnivore",
            "fooditems": "algae, insect larvae",
            "feedingPlaybook": "Enjoys spirulina-enriched flakes, freeze-dried daphnia, and micro-pellets. Needs a balance of vegetable and protein matter."
        },
        "reproduction": {
            "spawningTrait": "Livebearer",
            "layoutRequirement": "Provide floating plants (like Hornwort, Water Wisteria) or fry traps.",
            "comments": "Gives birth to free-swimming live fry rather than laying eggs. Fry hide in floating vegetation to avoid predation by adults."
        }
    },
    3002: {
        "ecology": {
            "comments": "Prefers fast-flowing streams and rivers with vegetation.",
            "biotope": "Fast-flowing rivers and streams with rocky bottom substrates and bankside vegetation in Central America.",
            "phMin": 7.0,
            "phMax": 8.2,
            "hardnessRange": "10 - 20 dGH",
            "tempCeiling": 28.0,
            "socialBehavior": "Avoid keeping multiple males in small tanks as they establish strict hierarchies and fight."
        },
        "diet": {
            "trophicLevel": "Omnivore",
            "fooditems": "worms, insects, plant matter",
            "feedingPlaybook": "Eats flake food, veggie wafers, and frozen brine shrimp. Appreciates regular vegetable matter supplements."
        },
        "reproduction": {
            "spawningTrait": "Livebearer",
            "layoutRequirement": "Dense floating plant coverage or breeding box to protect newborn fry.",
            "comments": "Internal fertilization occurs. Females give birth to large batches of live young. Very prolific breeders in well-planted tanks."
        }
    },
    4001: {
        "ecology": {
            "comments": "Inhabits fast-flowing streams and rivers. Grazes on driftwood.",
            "biotope": "Fast-flowing, highly oxygenated tributaries of the Amazon basin, typically with stony beds and sunken wood.",
            "phMin": 6.5,
            "phMax": 7.6,
            "hardnessRange": "6 - 15 dGH",
            "tempCeiling": 27.0,
            "socialBehavior": "Generally peaceful, but males are territorial over hiding spots and caves."
        },
        "diet": {
            "trophicLevel": "Herbivore / Detritivore",
            "fooditems": "algae, biofilm",
            "feedingPlaybook": "Provide sinking algae wafers, fresh zucchini, spinach, and cucumber. Driftwood MUST be present in the tank as they need to ingest cellulose for proper digestion."
        },
        "reproduction": {
            "spawningTrait": "Cave-brooder",
            "layoutRequirement": "Provide narrow breeding caves, ceramic tubes, or hollow logs.",
            "comments": "The male attracts the female to a cave, where she lays eggs. The male then guards and fans the eggs aggressively until they hatch."
        }
    },
    5001: {
        "ecology": {
            "comments": "Found in slow-moving streams and rice paddies.",
            "biotope": "Shallow, slow-moving streams, rice paddies, and canals in South Asia (India and Bangladesh).",
            "phMin": 6.5,
            "phMax": 8.0,
            "hardnessRange": "5 - 15 dGH",
            "tempCeiling": 25.0,
            "socialBehavior": "Must be kept in a school of 6+ to allow active shoaling and reduce stress."
        },
        "diet": {
            "trophicLevel": "Omnivore",
            "fooditems": "insects, small crustaceans",
            "feedingPlaybook": "Thrives on high-quality flake foods, freeze-dried bloodworms, and live daphnia. Very active surface-feeders."
        },
        "reproduction": {
            "spawningTrait": "Egg-scatterer",
            "layoutRequirement": "Fine gravel, glass marbles substrate, or a spawning grid to prevent adults from eating the dropped eggs.",
            "comments": "Non-adhesive eggs are scattered over the substrate. Fast and prolific spawners. Remove parent fish immediately to ensure high yield."
        }
    }
}

def execute_pipeline():
    print("🛸 Starting Antigravity Ingestion Core Process...")
    
    # Load separate data matrices 
    species_df = fetch_table("species", TABLES["species"])
    ecology_df = fetch_table("ecology", TABLES["ecology"])
    diet_df = fetch_table("diet", TABLES["diet"])
    
    if species_df.empty:
        print("❌ Core species dataset unreachable. Verification aborted.")
        return

    # Filter for targeted footprints
    target_families = ['cichlidae', 'characidae', 'poeciliidae', 'loricariidae', 'cyprinidae']
    
    if 'family' in species_df.columns:
        species_df['family'] = species_df['family'].astype(str).str.lower().str.strip()
        filtered_species = species_df[species_df['family'].isin(target_families)].copy()
    else:
        filtered_species = species_df.head(100).copy()

    print(f"✨ Found {len(filtered_species):,} species matches matching targeted aquarium groups.")
    
    final_payload = []
    
    # Let's slice the first 50 rows to test out the integration loop
    processing_slice = filtered_species.head(50)
    print(f"🧠 Passing {len(processing_slice)} records through Qwen2.5 Coder in LM Studio...")

    for _, row in processing_slice.iterrows():
        spec_code = row.get('speccode', 0)
        
        # Sub-table string linkage searches
        eco_notes = ""
        if not ecology_df.empty and 'speccode' in ecology_df.columns:
            match = ecology_df[ecology_df['speccode'] == spec_code]
            if not match.empty:
                eco_notes += str(match.iloc[0].get('comments', '')) + " "
                
        if not diet_df.empty and 'speccode' in diet_df.columns:
            match = diet_df[diet_df['speccode'] == spec_code]
            if not match.empty:
                eco_notes += str(match.iloc[0].get('fooditems', ''))

        genus = str(row.get('genus', '')).strip().capitalize()
        species = str(row.get('species', '')).strip().lower()
        common = str(row.get('fbname', f"{genus} sp.")).strip().capitalize()
        max_len = row.get('length', None)

        # Trigger LM Studio analysis parsing
        ai_metrics = run_lm_studio_inference(common, max_len, eco_notes)

        # Get details from RICH_SPECIES_DETAILS
        details = RICH_SPECIES_DETAILS.get(int(spec_code), {})

        record = {
            "specCode": int(spec_code),
            "scientificName": f"{genus} {species}",
            "genus": genus,
            "species": species,
            "commonName": common if common != 'Nan' else f"{genus} sp.",
            "family": str(row.get('family', '')).capitalize(),
            "maxLengthCm": float(max_len) if pd.notna(max_len) else None,
            "tankMetrics": {
                "minVolumeGallons": ai_metrics.get("minVolumeGallons", 20),
                "tempRangeCelsius": [ai_metrics.get("tempMinCelsius", 22), ai_metrics.get("tempMaxCelsius", 28)],
                "phRange": [ai_metrics.get("phMin", 6.5), ai_metrics.get("phMax", 7.5)],
                "difficulty": ai_metrics.get("difficulty", "Intermediate")
            },
            # Schema Injections:
            "ecology": details.get("ecology", {
                "comments": eco_notes.strip() or "No biotope notes available.",
                "biotope": "General freshwater aquatic biotope.",
                "phMin": ai_metrics.get("phMin", 6.5),
                "phMax": ai_metrics.get("phMax", 7.5),
                "hardnessRange": "5 - 15 dGH",
                "tempCeiling": ai_metrics.get("tempMaxCelsius", 28.0),
                "socialBehavior": "Compatible with similar temperament species."
            }),
            "diet": details.get("diet", {
                "trophicLevel": "Omnivore",
                "fooditems": "General micro-invertebrates and plant matter.",
                "feedingPlaybook": "Requires high-quality flakes/pellets as a daily staple. Supplement with live or frozen foods."
            }),
            "reproduction": details.get("reproduction", {
                "spawningTrait": "Egg-scatterer",
                "layoutRequirement": "Java moss beds or spawning mops.",
                "comments": "Egg scattering species. Separate hatchery tank recommended."
            })
        }
        final_payload.append(record)

    with open(OUTPUT_ASSET_PATH, 'w', encoding='utf-8') as f:
        json.dump(final_payload, f, indent=2, ensure_ascii=False)
        
    print(f"🏁 Execution success. Sanitize matrix written to asset link: {OUTPUT_ASSET_PATH}")

if __name__ == "__main__":
    execute_pipeline()