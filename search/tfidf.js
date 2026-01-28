const { normalizeArabicPersian } = require('../core/textUtils');

// Scalable TF-IDF Vector Generation

async function buildVocabularyFromBatch(documents) {
  const vocabulary = new Map();
  let wordIndex = 0;
  
  documents.forEach(doc => {
    const text = doc.textSnippet || '';
    const normalized = normalizeArabicPersian(text);
    const words = normalized.split(/\s+/).filter(w => w.length > 1);
    
    words.forEach(word => {
      if (!vocabulary.has(word)) {
        vocabulary.set(word, wordIndex++);
      }
    });
  });
  
  return vocabulary;
}

function generateTFIDFVectorSync(text, vocabulary, idfMap, totalDocs) {
  const vector = new Array(vocabulary.size).fill(0);
  
  const normalized = normalizeArabicPersian(text);
  const words = normalized.split(/\s+/).filter(w => w.length > 1);
  
  if (words.length === 0) return vector;
  
  const termFreq = new Map();
  words.forEach(word => {
    termFreq.set(word, (termFreq.get(word) || 0) + 1);
  });
  
  termFreq.forEach((count, word) => {
    const idx = vocabulary.get(word);
    if (idx !== undefined) {
      const tf = count / words.length;
      const idf = idfMap.get(word) || Math.log(totalDocs);
      vector[idx] = tf * idf;
    }
  });
  
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    return vector.map(val => val / magnitude);
  }
  
  return vector;
}


function cosineSimilarity(vec1, vec2) {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) {
    return 0;
  }

  let dotProduct = 0;
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
  }

  return Math.max(0, Math.min(1, dotProduct));
}

function cosineSimilarity(vec1, vec2) {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) {
    return 0;
  }

  let dotProduct = 0;
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
  }

  return Math.max(0, Math.min(1, dotProduct));
}


module.exports = {
  buildVocabularyFromBatch,
  generateTFIDFVectorSync,
  cosineSimilarity,
};