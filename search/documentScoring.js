const { normalizeArabicPersian, getWordRoot } = require('../core/textUtils');

function detectPhraseMatches(documentText, query) {
  if (!documentText || !query) return 0;
  
  const queryNorm = normalizeArabicPersian(query.toLowerCase());
  const docNorm = normalizeArabicPersian(documentText.toLowerCase());
  
  const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 1);
  let phraseScore = 0;
  
  for (let n = 2; n <= Math.min(5, queryWords.length); n++) {
    for (let i = 0; i <= queryWords.length - n; i++) {
      const phrase = queryWords.slice(i, i + n).join(' ');
      if (phrase.length > 5 && docNorm.includes(phrase)) {
        phraseScore += Math.min(0.15, n * 0.08);
      }
    }
  }
  
  return Math.min(0.4, phraseScore);
}

function calculateContextualRelevance(documentText, keyTerms, questionAnalysis) {
  if (!documentText || keyTerms.length === 0) return 0;
  
  const normalizedDoc = normalizeArabicPersian(documentText.toLowerCase());
  const sentences = normalizedDoc.split(/[.!؟।]/);
  
  let maxSentenceScore = 0;
  let sentencesWithMultipleTerms = 0;
  
  sentences.forEach(sentence => {
    if (sentence.trim().length < 10) return;
    
    let termsFound = 0;
    
    keyTerms.forEach(term => {
      const normalized = normalizeArabicPersian(term.toLowerCase());
      const termRoot = getWordRoot(normalized);
  
      if (sentence.includes(normalized) || 
          (termRoot && sentence.includes(termRoot))) {
        termsFound++;
      }
    });
    
    if (termsFound >= 2) {
      sentencesWithMultipleTerms++;
    }
    
    const sentenceScore = termsFound / keyTerms.length;
    if (sentenceScore > maxSentenceScore) {
      maxSentenceScore = sentenceScore;
    }
  });
  
  const multiSentenceBonus = sentencesWithMultipleTerms >= 2 ? 0.10 : 0;
  
  return Math.min(0.35, (maxSentenceScore * 0.20) + multiSentenceBonus);
}

function validateAnswerType(documentText, questionAnalysis) {
  if (!documentText || !questionAnalysis.questionType) return 0;
  
  const normalized = normalizeArabicPersian(documentText.toLowerCase());
  let score = 0;
  
  if (questionAnalysis.questionType === 'who') {
    const personIndicators = [
      'النبي', 'الرسول', 'حضرة', 'شخص', 'رجل', 'امرأة', 
      'الامام', 'العالم', 'الشيخ', 'المؤمن', 'المؤمنون'
    ];
    const matches = personIndicators.filter(ind => normalized.includes(ind)).length;
    score += Math.min(0.25, matches * 0.1);
  }
  
  if (questionAnalysis.questionType === 'when') {
    const timeIndicators = [
      'سنة', 'عام', 'يوم', 'شهر', 'قبل', 'بعد', 'خلال',
      'وقت', 'زمن', 'تاريخ', 'حين', 'عندما'
    ];
    const matches = timeIndicators.filter(ind => normalized.includes(ind)).length;
    score += Math.min(0.25, matches * 0.1);
  }
  
  if (questionAnalysis.questionType === 'where') {
    const placeIndicators = [
      'في', 'بلد', 'مدينة', 'مكان', 'موضع', 'ارض',
      'دار', 'بيت', 'مسجد', 'قرية'
    ];
    const matches = placeIndicators.filter(ind => normalized.includes(ind)).length;
    score += Math.min(0.25, matches * 0.1);
  }
  
  if (questionAnalysis.questionType === 'how') {
    const methodIndicators = [
      'بواسطة', 'وسيلة', 'طريقة', 'منهج', 'اسلوب',
      'كيفية', 'ثم', 'اولا', 'ثانيا', 'الخطوة'
    ];
    const matches = methodIndicators.filter(ind => normalized.includes(ind)).length;
    score += Math.min(0.25, matches * 0.08);
  }
  
  if (questionAnalysis.questionType === 'why') {
    const causalIndicators = [
      'لانه', 'لأنه', 'بسبب', 'السبب', 'لذلك', 'لهذا',
      'نتيجة', 'علة', 'ذلك ان', 'فان'
    ];
    const matches = causalIndicators.filter(ind => normalized.includes(ind)).length;
    score += Math.min(0.3, matches * 0.1);
  }
  
  return score;
}

function detectNegationContext(documentText, keyTerms) {
  if (!documentText || keyTerms.length === 0) return 0;
  
  const normalized = normalizeArabicPersian(documentText.toLowerCase());
  const negationWords = ['لا', 'ليس', 'لم', 'لن', 'ما', 'غير', 'ليست'];
  
  let negationPenalty = 0;
  const words = normalized.split(/\s+/);
  
  keyTerms.forEach(term => {
    const termNorm = normalizeArabicPersian(term.toLowerCase());
    
    words.forEach((word, idx) => {
      if (word.includes(termNorm) || termNorm.includes(word)) {
        for (let i = Math.max(0, idx - 3); i < idx; i++) {
          if (negationWords.includes(words[i])) {
            negationPenalty += 0.15;
          }
        }
      }
    });
  });
  
  return Math.min(0.4, negationPenalty);
}


module.exports = {
  detectPhraseMatches,
  calculateContextualRelevance,
  validateAnswerType,
  detectNegationContext,
};