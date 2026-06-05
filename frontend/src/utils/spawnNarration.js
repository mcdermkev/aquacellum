/**
 * Spawn Thread Narration — Poseidon auto-generates narration for spawn lifecycle events.
 * 
 * Triggered when grow-out checkpoints are added or spawn stages transition.
 * Generates a concise, mode-appropriate narration line that contextualizes
 * the spawn's progress relative to species averages and historical data.
 */

import { db } from '../db';

const POSEIDON_API_URL = '/api/poseidon';

/**
 * Generate a Poseidon narration for a spawn checkpoint event.
 * 
 * @param {Object} params
 * @param {number} params.spawnId - The spawn ID
 * @param {string} params.checkpointType - One of: fry_count, cull, sold, loss, moved, note, stage_transition
 * @param {number} params.count - The count associated with the checkpoint
 * @param {string} params.note - Optional note from the user
 * @param {Object} params.yieldSummary - Current funnel: { eggs, fry, alive, sold, lost, survivalRate }
 * @param {string} params.speciesName - Common name of the species being bred
 * @param {string} params.mode - 'casual' or 'pro'
 * @returns {Promise<string|null>} The narration text, or null if generation fails
 */
export async function generateSpawnNarration({
  spawnId,
  checkpointType,
  count,
  note,
  yieldSummary,
  speciesName,
  mode = 'casual'
}) {
  // Respect the Poseidon enabled/disabled setting
  if (localStorage.getItem('aquadex_poseidon_enabled') === 'false') {
    return null;
  }

  // Build a focused prompt for narration generation
  const daysSinceSpawn = await getSpawnAgeDays(spawnId);
  
  const context = [
    `Species: ${speciesName || 'Unknown'}`,
    `Spawn ID: #${spawnId}`,
    `Days since spawn: ${daysSinceSpawn ?? '?'}`,
    `Event: ${checkpointType} (count: ${count || 0})`,
    note ? `User note: "${note}"` : '',
    yieldSummary ? `Current yield: ${yieldSummary.eggs} eggs → ${yieldSummary.fry} fry → ${yieldSummary.alive} alive, ${yieldSummary.sold} sold, ${yieldSummary.lost} lost/culled (${yieldSummary.survivalRate}% survival)` : '',
  ].filter(Boolean).join('\n');

  const narrationPrompt = `Generate a single concise narration line (max 120 characters) for this spawn milestone. 
Write as Poseidon — the data/intelligence layer observing a breeder's spawn progress.
${mode === 'pro' ? 'Use clinical, data-forward tone. No emoji.' : 'Use warm but factual tone. One emoji max.'}
Context:
${context}

Respond ONLY with the narration line text, nothing else. No JSON wrapping.`;

  try {
    const response = await fetch(POSEIDON_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: narrationPrompt,
        mode,
        sessionData: {},
        conversationHistory: []
      })
    });

    if (!response.ok) return null;

    const data = await response.json();
    
    // The API returns structured JSON, extract the message
    const narration = data.message || null;
    
    // Store the narration in the grow-out record
    if (narration) {
      await storeNarration(spawnId, checkpointType, narration);
    }

    return narration;
  } catch (err) {
    console.warn('[Spawn Narration] Failed to generate:', err);
    return null;
  }
}

/**
 * Get the age of a spawn in days (from first checkpoint or spawn creation).
 */
async function getSpawnAgeDays(spawnId) {
  try {
    const checkpoints = await db.spawnGrowout
      .where('spawnId')
      .equals(spawnId)
      .sortBy('timestamp');
    
    if (checkpoints.length === 0) return 0;
    
    const firstTimestamp = checkpoints[0].timestamp;
    const now = Math.round(Date.now() / 1000);
    return Math.round((now - firstTimestamp) / 86400);
  } catch {
    return null;
  }
}

/**
 * Store a narration line in the spawn's grow-out history.
 */
async function storeNarration(spawnId, triggerType, narrationText) {
  try {
    await db.spawnGrowout.add({
      spawnId,
      timestamp: Math.round(Date.now() / 1000),
      type: 'narration',
      count: 0,
      note: narrationText,
      meta: { source: 'poseidon', trigger: triggerType }
    });
  } catch (err) {
    console.warn('[Spawn Narration] Failed to store:', err);
  }
}

/**
 * Get all narration lines for a spawn.
 */
export async function getSpawnNarrations(spawnId) {
  try {
    const all = await db.spawnGrowout
      .where('spawnId')
      .equals(spawnId)
      .toArray();
    
    return all
      .filter(c => c.type === 'narration')
      .sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}
