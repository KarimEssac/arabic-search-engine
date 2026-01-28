const { normalizeArabicPersian, getWordRoot, generateFuzzyVariants } = require('../core/textUtils');

function detectQueryIntent(query) {
  const normalized = normalizeArabicPersian(query.toLowerCase());
  
  const wantsQuotes = normalized.includes('قال') || 
                      normalized.includes('نص') ||
                      normalized.includes('عبارة') ||
                      normalized.includes('ذكر');
  
  const wantsSummary = normalized.includes('ملخص') || 
                       normalized.includes('باختصار') ||
                       normalized.includes('مختصر');
  
  const wantsComparison = normalized.includes('الفرق') ||
                          normalized.includes('مقارنة') ||
                          normalized.includes('بين');
  
  const wantsList = normalized.includes('اذكر') ||
                    normalized.includes('عدد') ||
                    normalized.includes('اسرد');
  
  return {
    wantsQuotes,
    wantsSummary,
    wantsComparison,
    wantsList
  };
}

function expandQueryTerms(concepts) {
  const expanded = new Set(concepts);
  
  concepts.forEach(concept => {
    const normalized = normalizeArabicPersian(concept.toLowerCase());
    
    const root = getWordRoot(normalized);
    if (root && root.length >= 3) {
      expanded.add(root);
    }
    
    if (normalized.startsWith('ال')) {
      expanded.add(normalized.substring(2));
    } else {
      expanded.add('ال' + normalized);
    }
    
    const fuzzyVariants = generateFuzzyVariants(normalized);
    fuzzyVariants.forEach(variant => expanded.add(variant));
  });
  
  return Array.from(expanded);
}

function analyzeQuestion(query) {
  const cleanedQuery = query.replace(/[.,;:!?،؛؟«»""()[\]{}]/g, ' ').trim();
  const normalized = normalizeArabicPersian(cleanedQuery.toLowerCase());
  
  const questionPatterns = {
    who: ['من', 'من هو', 'من هي'],
    what: ['ما', 'ماذا', 'ما هو', 'ما هي'],
    when: ['متى', 'في اي', 'في ايه'],
    where: ['اين', 'في اين'],
    how: ['كيف', 'بماذا', 'كيف يستدل', 'كيفية'],
    why: ['لماذا', 'لم', 'ما سبب', 'ما السبب', 'سبب'],
    which: ['اي', 'ايه']
  };
  
  let questionType = null;
  for (const [type, patterns] of Object.entries(questionPatterns)) {
    if (patterns.some(pattern => normalized.includes(pattern))) {
      questionType = type;
      break;
    }
  }
  
  const needsCausality = normalized.includes('سبب') || 
                         normalized.includes('لماذا') || 
                         normalized.includes('لم') ||
                         normalized.includes('علة') ||
                         questionType === 'why';
  
  const needsMethod = normalized.includes('كيف') ||
                      normalized.includes('يستدل') ||
                      normalized.includes('استدلال') ||
                      normalized.includes('كيفية') ||
                      normalized.includes('بماذا') ||
                      questionType === 'how';
  
  const needsDefinition = normalized.includes('ما هو') || 
                          normalized.includes('ما هي') ||
                          normalized.includes('تعريف') ||
                          normalized.includes('معنى') ||
                          normalized.includes('ماهية') ||
                          (questionType === 'what' && !needsCausality);
  
  let mainSubject = null;
  if (needsCausality) {
    const afterSabab = normalized.split('سبب')[1];
    if (afterSabab) {
      const subjectWords = afterSabab.trim().split(/\s+/).slice(0, 3).join(' ');
      mainSubject = subjectWords.replace(/[؟?،,]/g, '').trim();
    }
  }
  
  if (needsMethod) {
    const parts = normalized.split('على');
    if (parts.length > 1) {
      const subjectWords = parts[1].trim().split(/\s+/).slice(0, 3).join(' ');
      mainSubject = subjectWords.replace(/[؟?،,]/g, '').trim();
    }
  }
  
  let definitionTerm = null;
  if (needsDefinition && (normalized.includes('ما هو') || normalized.includes('ما هي'))) {
    const afterWhat = normalized.split(/ما هو|ما هي/)[1];
    if (afterWhat) {
      definitionTerm = afterWhat.trim().split(/\s+/).slice(0, 2).join(' ').replace(/[؟?،,]/g, '').trim();
    }
  }
  
  let mainVerb = null;
  if (needsMethod) {
    const methodVerbs = ['يستدل', 'يستشهد', 'يثبت', 'يبرهن', 'يصل', 'يعرف', 'يتوصل'];
    methodVerbs.forEach(verb => {
      if (normalized.includes(verb)) {
        mainVerb = verb;
      }
    });
    
    if (!mainVerb && normalized.includes('كيف')) {
      const afterKayf = normalized.split('كيف')[1];
      if (afterKayf) {
        const firstWord = afterKayf.trim().split(/\s+/)[0];
        if (firstWord && firstWord.startsWith('ي')) {
          mainVerb = firstWord;
        }
      }
    }
  }
  
  // clean extract concepts: get meaningful words excluding stop words
  const stopWords = [
    'في', 'من', 'إلى', 'الى', 'على', 'عن', 'هذا', 'هذه', 'ذلك', 'تلك',
    'هل', 'كان', 'يكون', 'أن', 'ان', 'إن', 'ين', 'قد', 'لقد', 'كل',
    'بعض', 'أي', 'اي', 'التي', 'الذي', 'هو', 'هي', 'هم', 'هن',
    'و', 'أو', 'او', 'لكن', 'ثم', 'ف', 'ب', 'ل', 'ك', 
    'فيه', 'به', 'له', 'منه', 'عنه', 'ما', 'من', 'متى', 'اين', 'كيف', 'لماذا', 'ماذا'
  ];
  
  const allWords = normalized.split(/\s+/);
  const meaningfulConcepts = [];
  
  allWords.forEach(word => {
    word = word.replace(/[؟?،,;:.!«»"""()[\]{}]/g, '');
    
    if (word.length >= 2 && !stopWords.includes(word)) {
      meaningfulConcepts.push(word);
      
      if (word.startsWith('ال') && word.length > 3) {
        meaningfulConcepts.push(word.substring(2));
      }
    }
  });

  const uniqueConcepts = [...new Set(meaningfulConcepts)];
  
  return {
    questionType: questionType,
    concepts: uniqueConcepts,
    isQuestion: questionType !== null,
    needsCausality: needsCausality,
    needsMethod: needsMethod,
    needsDefinition: needsDefinition,
    definitionTerm: definitionTerm,
    mainSubject: mainSubject,
    mainVerb: mainVerb
  };
}

function processQuery(query) {
  if (!query) return { words: [], normalized: '', keyTerms: [], analysis: {} };
  
  // CRITICAL: Remove punctuation FIRST, before any processing
  const cleanedQuery = query.replace(/[.,;:!?،؛؟«»""()[\]{}]/g, ' ');
  
  const normalized = normalizeArabicPersian(cleanedQuery);
  const cleaned = normalized.trim()
    .replace(/\s+/g, ' ');
  
  const words = cleaned.split(' ').filter(w => w.length > 0);
  
  const stopWords = [
    'في', 'من', 'إلى', 'على', 'عن', 'هذا', 'هذه', 'ذلك', 'تلك',
    'هل', 'ما', 'كان', 'يكون', 'أن', 'إن', 'قد', 'لقد', 'كل',
    'بعض', 'أي', 'التي', 'الذي', 'هو', 'هي', 'هم', 'هن',
    'و', 'أو', 'لكن', 'ثم', 'ف', 'ب', 'ل', 'ك', 'النص', 'بحسب'
  ];
  
  const meaningfulWords = words
    .filter(w => !stopWords.includes(w))
    .map(w => w.startsWith('ال') && w.length > 3 ? w.substring(2) : w);
  
  const analysis = analyzeQuestion(cleanedQuery);
  const keyTerms = [...new Set([...meaningfulWords, ...analysis.concepts])];
  
  
  return {
    words: meaningfulWords,
    normalized: cleaned,
    original: query,
    keyTerms: keyTerms,
    analysis: analysis
  };
}


module.exports = {
  detectQueryIntent,
  expandQueryTerms,
  analyzeQuestion,
  processQuery,
};