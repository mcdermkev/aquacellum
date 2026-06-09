process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function main() {
  // Try searching by genus-species
  const url = 'https://www.planetcatfish.com/common/species.php?species_id=98';
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
      'Accept-Language': 'en-US,en;q=0.5',
    }
  });
  console.log('Status:', r.status);
  const t = await r.text();
  console.log('Length:', t.length);
  console.log('First 500:', t.substring(0, 500));

  // Try the search URL
  console.log('\n--- Trying search ---');
  const searchUrl = 'https://www.planetcatfish.com/common/species.php?task=&genus=Corydoras&species=weitzmani';
  const r2 = await fetch(searchUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html',
    }
  });
  console.log('Search status:', r2.status);
  const t2 = await r2.text();
  console.log('Search length:', t2.length);
  if (t2.includes('Feeding')) console.log('Has Feeding section!');
  if (t2.includes('Breeding')) console.log('Has Breeding section!');
  
  // Extract feeding info
  const feedMatch = t2.match(/Feeding[\s\S]*?<\/tr>/i);
  if (feedMatch) console.log('Feed section:', feedMatch[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 300));
}

main().catch(e => console.error(e.message));
