const { CACHE_CONFIG } = require('../config/config');

let TOTAL_DOCS_CACHE = 0;
let CACHE_LAST_UPDATED = null;
const CACHE_REFRESH_INTERVAL = CACHE_CONFIG.CACHE_REFRESH_INTERVAL;

const termRankingCache = new Map();
const CACHE_MAX_SIZE = CACHE_CONFIG.CACHE_MAX_SIZE;

function getCachedTermRanking(terms) {
  const cacheKey = terms.sort().join('|');
  return termRankingCache.get(cacheKey);
}

function setCachedTermRanking(terms, ranking) {
  const cacheKey = terms.sort().join('|');
  
  // Prevent memory leak
  if (termRankingCache.size >= CACHE_MAX_SIZE) {
    const firstKey = termRankingCache.keys().next().value;
    termRankingCache.delete(firstKey);
  }
  
  termRankingCache.set(cacheKey, ranking);
}

module.exports = {
  TOTAL_DOCS_CACHE,
  CACHE_LAST_UPDATED,
  CACHE_REFRESH_INTERVAL,
  getCachedTermRanking,
  setCachedTermRanking,
  setTotalDocsCache: (value) => { TOTAL_DOCS_CACHE = value; },
  setCacheLastUpdated: (value) => { CACHE_LAST_UPDATED = value; },
  getTotalDocsCache: () => TOTAL_DOCS_CACHE,
  getCacheLastUpdated: () => CACHE_LAST_UPDATED,
};