const { CONFIG } = require('../config/config');
const { normalizeArabicPersian, levenshteinDistance } = require('../core/textUtils');

function calculateTextSimilarity(text1, text2) {
  const norm1 = normalizeArabicPersian(text1 || '');
  const norm2 = normalizeArabicPersian(text2 || '');
  
  if (norm1 === norm2) return 1.0;
  
  const len1 = norm1.length;
  const len2 = norm2.length;
  if (len1 === 0 || len2 === 0) return 0;
  
  const lengthDiff = Math.abs(len1 - len2);
  if (lengthDiff > Math.max(len1, len2) * 0.5) {
    return 0;
  }
  
  const lengthRatio = Math.min(len1, len2) / Math.max(len1, len2);
  
  const words1 = new Set(norm1.split(/\s+/).filter(w => w.length > 1));
  const words2 = new Set(norm2.split(/\s+/).filter(w => w.length > 1));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  const jaccardSimilarity = intersection.size / union.size;
  
  const maxLen = Math.max(len1, len2);
  const levDistance = levenshteinDistance(norm1, norm2);
  const levSimilarity = 1 - (levDistance / maxLen);
  
  const combinedSimilarity = (jaccardSimilarity * 0.5) + (levSimilarity * 0.3) + (lengthRatio * 0.2);
  
  return combinedSimilarity;
}

// fast hash generation for deduplication
function generateTextHash(text) {
  if (!text) return '';
  const normalized = normalizeArabicPersian(text.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
  
  const snippet = normalized.substring(0, 100);
  return `${snippet}_${normalized.length}`;
}

function generateLocationHash(result) {
  return `${result.fileId}_${result.pageIndex}`;
}

// two-phase deduplication
function deduplicateResults(results, similarityThreshold = 0.85) {
  
  if (results.length === 0) {
    return results;
  }
  
  const startTime = Date.now();
  let fastDedupCount = 0;
  let slowDedupCount = 0;
  
  
  //phase 1: fast hash-based deduplication
  const phase1Start = Date.now();
  
  const seenHashes = new Map();        
  const seenLocations = new Map();     
  const fastFiltered = [];
  
  let phase1Comparisons = 0;
  
  for (const result of results) {
    let isDuplicate = false;
    let replacedResult = null;
    const locationHash = generateLocationHash(result);
    phase1Comparisons++;
    
    if (seenLocations.has(locationHash)) {
      const existing = seenLocations.get(locationHash);
      const textHash1 = generateTextHash(result.textSnippet);
      const textHash2 = generateTextHash(existing.textSnippet);
      
      if (textHash1 && textHash2 && textHash1 === textHash2) {
        isDuplicate = true;
        fastDedupCount++;
        if (result.reRankScore > existing.reRankScore) {
          seenLocations.set(locationHash, result);
          replacedResult = existing;
        }
      } else {
        // Don't mark as duplicate - let both through
      }
    } else {
      seenLocations.set(locationHash, result);
    }
    
    if (!isDuplicate) {
      const textHash = generateTextHash(result.textSnippet);
      phase1Comparisons++;
      
      if (textHash && seenHashes.has(textHash)) {
        const existing = seenHashes.get(textHash);
        isDuplicate = true;
        fastDedupCount++;

        if (result.reRankScore > existing.reRankScore) {
          seenHashes.set(textHash, result);
          replacedResult = existing;
        }
      } else if (textHash) {
        seenHashes.set(textHash, result);
      }
    }
    
    if (!isDuplicate) {
      fastFiltered.push(result);
    } else if (replacedResult) {

      const idx = fastFiltered.indexOf(replacedResult);
      if (idx !== -1) {
        fastFiltered.splice(idx, 1);
      }
      fastFiltered.push(result);
    }
  }
  
  const phase1Time = Date.now() - phase1Start;
  
  // Phase 2: slow similarity-based deduplication
  const uniqueResults = fastFiltered;
  
  const totalTime = Date.now() - startTime;
  
  
  return uniqueResults.sort((a, b) => b.reRankScore - a.reRankScore);
}

module.exports = {
  calculateTextSimilarity,
  generateTextHash,
  generateLocationHash,
  deduplicateResults,
};