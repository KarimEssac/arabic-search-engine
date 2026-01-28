const { CONFIG } = require('../config/config');
const { normalizeArabicPersian, getWordRoot, generateFuzzyVariants, findFuzzyMatches } = require('../core/textUtils');

function calculateKeywordScoreWithFuzzy(queryWords, keyTerms, documentText, questionAnalysis) {
  if (!documentText || queryWords.length === 0) return 0;
  
  const normalizedDoc = normalizeArabicPersian(documentText.toLowerCase());
  let exactMatchCount = 0;
  let fuzzyMatchCount = 0;
  let rootMatchCount = 0;
  let conceptMatchCount = 0;
  
  const foundConcepts = new Set();
  
  // step 1: Exact + Root Matching 
  let singleWordFrequency = 0; 
  
  queryWords.forEach(word => {
    const normalizedWord = normalizeArabicPersian(word.toLowerCase());

    if (normalizedDoc.includes(normalizedWord)) {
      exactMatchCount++;
      
      if (queryWords.length === 1) {
        const regex = new RegExp(normalizedWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const matches = normalizedDoc.match(regex);
        singleWordFrequency = matches ? matches.length : 1;
      }
      
      if (keyTerms.includes(normalizedWord)) {
        conceptMatchCount += 0.5;
      }
    } else {
      const root = getWordRoot(normalizedWord);
      if (root && normalizedDoc.includes(root)) {
        rootMatchCount += 0.7;
      }
    }
  });
  
  const initialScore = exactMatchCount + (rootMatchCount * 0.7);
  const maxPossible = queryWords.length;
  const exactRatio = maxPossible > 0 ? initialScore / maxPossible : 0;
  
  // step 2: Fuzzy Matching - it's optional
  const shouldUseFuzzy = CONFIG.FUZZY_ENABLED && 
                         exactRatio < CONFIG.FUZZY_MIN_EXACT_SCORE;
  
  if (shouldUseFuzzy) {
    const fuzzyStart = Date.now();
    const fuzzyEligibleWords = queryWords
      .filter(word => word.length >= CONFIG.FUZZY_MIN_WORD_LENGTH)
      .slice(0, CONFIG.FUZZY_MAX_TERMS); 
    
    if (fuzzyEligibleWords.length > 0) {
      if (!global.fuzzyLoggedThisSearch) {
        global.fuzzyLoggedThisSearch = true;
      }
      
      fuzzyEligibleWords.forEach(word => {
        const normalizedWord = normalizeArabicPersian(word.toLowerCase());

        if (normalizedDoc.includes(normalizedWord)) return;
        const root = getWordRoot(normalizedWord);
        if (root && normalizedDoc.includes(root)) return;
        
        const variants = generateFuzzyVariants(normalizedWord);
        let foundVariant = false;
        
        for (const variant of variants) {
          if (normalizedDoc.includes(variant)) {
            fuzzyMatchCount += 0.85;
            foundVariant = true;
            break;
          }
        }
        
        if (!foundVariant) {
          const fuzzyMatches = findFuzzyMatches(normalizedWord, documentText, 0.80);
          if (fuzzyMatches.length > 0) {
            fuzzyMatchCount += fuzzyMatches[0].score * 0.9;
          }
        }
      });
    }
  }
  
  if (questionAnalysis.concepts && questionAnalysis.concepts.length > 0) {
  questionAnalysis.concepts.forEach(concept => {
    const normalized = normalizeArabicPersian(concept.toLowerCase());
    if (normalizedDoc.includes(normalized)) {
      foundConcepts.add(concept);
      conceptMatchCount += 1.0;
    } else {
      const root = getWordRoot(normalized);
      if (root && normalizedDoc.includes(root)) {
        conceptMatchCount += 0.5;
      }
    }
  });
}
  const totalMatches = exactMatchCount + fuzzyMatchCount + rootMatchCount + conceptMatchCount;
  const maxPossibleScore = queryWords.length + (questionAnalysis.concepts ? questionAnalysis.concepts.length : 0);
  let score = maxPossibleScore > 0 ? totalMatches / maxPossibleScore : 0;
  
  if (queryWords.length === 1 && exactMatchCount >= 1) {
    score = Math.max(score, 0.95);
    
    if (singleWordFrequency > 1) {
      const frequencyBoost = Math.min(0.05, singleWordFrequency * 0.005);
      score = Math.min(1.0, score + frequencyBoost);
    }
  }
  
  if (foundConcepts.size >= 2) {
    score *= 1.3;
  }
  
  if (fuzzyMatchCount > 0) {
    score *= 1.1;
  }
  
  return Math.min(1.0, score);
}

module.exports = {
  calculateKeywordScoreWithFuzzy,
};