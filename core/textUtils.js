//  text  normalization

function normalizeArabicPersian(text) {
  if (!text) return '';
  
  return text
    .replace(/[إأٱآا]/g, 'ا')
    .replace(/[ىيئ]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[ھۀ]/g, 'ه')
    .replace(/ک/g, 'ك')
    .replace(/ؤ/g, 'و')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/پ/g, 'ب')
    .replace(/چ/g, 'ج')
    .replace(/ژ/g, 'ز')
    .replace(/گ/g, 'ك');
}

// fuzzy matching functions and phonetic similarity

function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      
        matrix[i][j - 1] + 1,      
        matrix[i - 1][j - 1] + cost 
      );
    }
  }

  return matrix[len1][len2];
}

const phoneticSimilarityMap = {
  'ت': ['ط', 'ث'],
  'ط': ['ت', 'ظ'],
  'ث': ['ت', 'س'],
  'د': ['ض', 'ذ'],
  'ض': ['د', 'ظ'],
  'ذ': ['د', 'ز', 'ظ'],
  'س': ['ص', 'ث'],
  'ص': ['س', 'ض'],
  'ز': ['ذ', 'ظ'],
  'ظ': ['ز', 'ذ', 'ض', 'ط'],
  'ق': ['ك', 'غ'],
  'ك': ['ق', 'خ'],
  'ه': ['ح', 'خ'],
  'ح': ['ه', 'خ'],
  'خ': ['ح', 'ه', 'ك'],
  'ع': ['غ'],
  'غ': ['ع', 'ق'],
  'ب': ['ن', 'ت'],
  'ن': ['ب', 'ي'],
  'ي': ['ن'],
  'و': ['ؤ'],
  'ا': ['ى']
};

function arePhoneticallySimilar(char1, char2) {
  if (char1 === char2) return true;
  
  const normalized1 = normalizeArabicPersian(char1);
  const normalized2 = normalizeArabicPersian(char2);
  
  if (normalized1 === normalized2) return true;
  
  const similar = phoneticSimilarityMap[char1];
  return similar && similar.includes(char2);
}

function calculatePhoneticDistance(word1, word2) {
  const len1 = word1.length;
  const len2 = word2.length;
  
  const lengthDiff = Math.abs(len1 - len2);
  if (lengthDiff > 3) return 100; 
  
  let distance = lengthDiff * 2; 
  const maxLen = Math.max(len1, len2);
  
  for (let i = 0; i < maxLen; i++) {
    const char1 = word1[i] || '';
    const char2 = word2[i] || '';
    
    if (char1 === char2) {
      continue;
    } else if (arePhoneticallySimilar(char1, char2)) {
      distance += 0.5; 
    } else {
      distance += 2;
    }
  }
  
  return distance;
}

function generateFuzzyVariants(word) {
  if (!word || word.length < 3) return [word];
  
  const variants = new Set([word]);
  const normalized = normalizeArabicPersian(word);
  variants.add(normalized);
  
  const maxTranspositions = Math.min(5, word.length - 1);
  for (let i = 0; i < maxTranspositions; i++) {
    const transposed = 
      word.substring(0, i) + 
      word[i + 1] + 
      word[i] + 
      word.substring(i + 2);
    variants.add(transposed);
    variants.add(normalizeArabicPersian(transposed));
  }
  
  const maxPhonetic = Math.min(3, word.length);
  for (let i = 0; i < maxPhonetic; i++) {
    const char = word[i];
    const similar = phoneticSimilarityMap[char];
    
    if (similar && similar.length > 0) {
      const replacement = similar[0];
      const variant = word.substring(0, i) + replacement + word.substring(i + 1);
      variants.add(variant);
    }
  }
  
  const prefixes = ['ال', 'و', 'ف', 'ب'];
  prefixes.forEach(prefix => {
    if (word.startsWith(prefix)) {
      variants.add(word.substring(prefix.length));
    } else if (variants.size < 15) {
      variants.add(prefix + word);
    }
  });
  
  return Array.from(variants);
}

function findFuzzyMatches(word, text, threshold = 0.7) {
  if (!word || !text) return [];
  
  const normalizedWord = normalizeArabicPersian(word.toLowerCase());
  const normalizedText = normalizeArabicPersian(text.toLowerCase());
  const textWords = normalizedText.split(/\s+/);
  
  const matches = [];
  const wordVariants = generateFuzzyVariants(normalizedWord);
  
  textWords.forEach((textWord, index) => {
    if (textWord.length < 2) return;
    
    if (textWord === normalizedWord || wordVariants.includes(textWord)) {
      matches.push({
        match: textWord,
        score: 1.0,
        position: index,
        matchType: 'exact'
      });
      return;
    }
    
    const lengthDiff = Math.abs(textWord.length - normalizedWord.length);
    if (lengthDiff > 3) return;
    
    if (lengthDiff <= 2) {
      const levDistance = levenshteinDistance(normalizedWord, textWord);
      if (levDistance > 3) return;
      
      const maxLen = Math.max(normalizedWord.length, textWord.length);
      const levSimilarity = 1 - (levDistance / maxLen);
      
      if (levSimilarity >= 0.6) {
        const phoneticDist = calculatePhoneticDistance(normalizedWord, textWord);
        const phoneticSimilarity = 1 / (1 + phoneticDist / 10);
        const combinedScore = (levSimilarity * 0.6) + (phoneticSimilarity * 0.4);
        
        if (combinedScore >= threshold) {
          matches.push({
            match: textWord,
            score: combinedScore,
            position: index,
            matchType: 'fuzzy',
            levDistance: levDistance,
            phoneticDist: phoneticDist
          });
        }
      }
    }
  });
  
  return matches.sort((a, b) => b.score - a.score);
}

function calculateFuzzyMatchBonus(documentText, queryWords) {
  // Keep it for backward compatibility but return 0
  return 0;
}

function getWordRoot(word) {
  if (!word || word.length < 3) return word;
  
  let cleaned = word;
  const prefixes = ['ال', 'و', 'ف', 'ب', 'ل', 'ك'];
  for (const prefix of prefixes) {
    if (cleaned.startsWith(prefix) && cleaned.length > prefix.length + 2) {
      cleaned = cleaned.substring(prefix.length);
      break;
    }
  }
  
  if (cleaned.length >= 4) {
    return cleaned.substring(0, 4);
  } else if (cleaned.length >= 3) {
    return cleaned.substring(0, 3);
  }
  return cleaned;
}

function getFuzzyScore(term1, term2) {
  const distance = levenshteinDistance(term1, term2);
  const maxLength = Math.max(term1.length, term2.length);
  return 1 - (distance / maxLength);
}

module.exports = {
  normalizeArabicPersian,
  levenshteinDistance,
  getFuzzyScore,
  phoneticSimilarityMap,
  arePhoneticallySimilar,
  calculatePhoneticDistance,
  generateFuzzyVariants,
  findFuzzyMatches,
  calculateFuzzyMatchBonus,
  getWordRoot,
};