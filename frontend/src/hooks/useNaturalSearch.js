import { useState, useCallback, useRef } from 'react';

/**
 * useNaturalSearch — Converts natural language queries into structured species filters
 * via the Poseidon parse-search API endpoint.
 * 
 * Returns parsed filters that can be applied to useSpeciesSearch.
 * Includes debouncing to avoid calling the API on every keystroke.
 */

const PARSE_SEARCH_URL = '/api/parse-search';
const DEBOUNCE_MS = 600;
const MIN_QUERY_LENGTH = 8; // Don't parse very short queries

export function useNaturalSearch({ onFiltersReady, tankContext } = {}) {
  const [isParsing, setIsParsing] = useState(false);
  const [lastParsed, setLastParsed] = useState(null);
  const [explanation, setExplanation] = useState('');
  const debounceRef = useRef(null);

  /**
   * Parse a natural language query into structured filters.
   * Debounced — call this on every keystroke, it'll only fire after the user stops typing.
   */
  const parseQuery = useCallback((query) => {
    // Clear previous debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Don't parse short queries or if Poseidon is disabled
    if (!query || query.trim().length < MIN_QUERY_LENGTH) {
      setLastParsed(null);
      setExplanation('');
      return;
    }

    if (localStorage.getItem('aquadex_poseidon_enabled') === 'false') {
      // Do basic local parsing without API
      const localResult = parseLocally(query);
      setLastParsed(localResult);
      setExplanation(localResult.explanation || '');
      if (onFiltersReady) onFiltersReady(localResult);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setIsParsing(true);
      try {
        const response = await fetch(PARSE_SEARCH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query.trim(), tankContext }),
        });

        if (!response.ok) throw new Error('Parse failed');

        const data = await response.json();
        setLastParsed(data);
        setExplanation(data.explanation || '');

        if (onFiltersReady) onFiltersReady(data);
      } catch (err) {
        console.warn('[Natural Search] Parse failed:', err);
        // Fall back to local parsing
        const localResult = parseLocally(query);
        setLastParsed(localResult);
        setExplanation(localResult.explanation || '');
        if (onFiltersReady) onFiltersReady(localResult);
      } finally {
        setIsParsing(false);
      }
    }, DEBOUNCE_MS);
  }, [onFiltersReady, tankContext]);

  /**
   * Immediately parse without debounce (for submit/enter key).
   */
  const parseImmediate = useCallback(async (query) => {
    if (!query || query.trim().length < MIN_QUERY_LENGTH) return null;

    if (localStorage.getItem('aquadex_poseidon_enabled') === 'false') {
      const localResult = parseLocally(query);
      setLastParsed(localResult);
      setExplanation(localResult.explanation || '');
      if (onFiltersReady) onFiltersReady(localResult);
      return localResult;
    }

    setIsParsing(true);
    try {
      const response = await fetch(PARSE_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), tankContext }),
      });

      if (!response.ok) throw new Error('Parse failed');

      const data = await response.json();
      setLastParsed(data);
      setExplanation(data.explanation || '');
      if (onFiltersReady) onFiltersReady(data);
      return data;
    } catch {
      const localResult = parseLocally(query);
      setLastParsed(localResult);
      if (onFiltersReady) onFiltersReady(localResult);
      return localResult;
    } finally {
      setIsParsing(false);
    }
  }, [onFiltersReady, tankContext]);

  /**
   * Clear parsed state.
   */
  const clearParsed = useCallback(() => {
    setLastParsed(null);
    setExplanation('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return {
    isParsing,
    lastParsed,
    explanation,
    parseQuery,
    parseImmediate,
    clearParsed,
  };
}

/**
 * Client-side local parsing fallback (same logic as the API's local parser).
 */
function parseLocally(query) {
  const q = query.toLowerCase();
  const filters = {};
  let searchTerm = query;

  if (q.includes('beginner') || q.includes('easy')) filters.difficulty = 'Easy';
  else if (q.includes('intermediate') || q.includes('medium')) filters.difficulty = 'Medium';
  else if (q.includes('advanced') || q.includes('difficult')) filters.difficulty = 'Difficult';
  else if (q.includes('expert')) filters.difficulty = 'Expert';

  if (q.includes('warm') || q.includes('tropical')) filters.tempMin = 26;
  if (q.includes('cold') || q.includes('cool')) filters.tempMax = 22;

  const gallonMatch = q.match(/(\d+)\s*gal/i);
  if (gallonMatch) filters.minVolume = parseInt(gallonMatch[1], 10);

  const phMatch = q.match(/ph\s*(\d+\.?\d*)/i);
  if (phMatch) {
    const ph = parseFloat(phMatch[1]);
    filters.phMin = Math.max(4, ph - 0.5);
    filters.phMax = Math.min(10, ph + 0.5);
  }

  const sizeMatch = q.match(/under\s*(\d+)\s*cm/i) || q.match(/less than\s*(\d+)\s*cm/i);
  if (sizeMatch) filters.maxSize = parseInt(sizeMatch[1], 10);

  if (q.includes('peaceful') || q.includes('community')) filters.temperament = 'peaceful';
  if (q.includes('aggressive')) filters.temperament = 'aggressive';

  searchTerm = query
    .replace(/\b(beginner|easy|intermediate|medium|advanced|difficult|expert)\b/gi, '')
    .replace(/\b(warm|cold|cool|tropical)\b/gi, '')
    .replace(/\b(peaceful|community|aggressive)\b/gi, '')
    .replace(/\d+\s*gal(lons?)?/gi, '')
    .replace(/ph\s*\d+\.?\d*/gi, '')
    .replace(/under\s*\d+\s*cm/gi, '')
    .replace(/less than\s*\d+\s*cm/gi, '')
    .replace(/\b(fish|for|that|can|live|in|a|my|tank|water|what|which|are|good)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { searchTerm, filters, explanation: 'Parsed locally', suggestedSpecies: [] };
}
