const { normalizeArabicPersian, getWordRoot } = require('../core/textUtils');

function detectQuotesAndImpressions(documentText) {
  if (!documentText) return { hasQuotes: false, quoteScore: 0, impressionScore: 0 };
  
  const normalized = normalizeArabicPersian(documentText.toLowerCase());
  
  const strongQuoteIndicators = [
    'قالوا', 'قال', 'قالت', 'يقول', 'يقولون',
    'فقال', 'فقالوا', 'قال له', 'قالوا له'
  ];
  
  const impressionIndicators = [
    'انطباع', 'رأي', 'رأى', 'وصف', 'وصفوا',
    'اعتراف', 'معترفين', 'يصفونه', 'اعترفيين'
  ];
  
  const quoteMarkers = ['«', '»', '"', '"', '"', 'إن', 'أن', 'إنّ', 'أنّ'];
  
  let strongQuoteCount = 0;
  let impressionCount = 0;
  let quoteMarkerCount = 0;
  
  strongQuoteIndicators.forEach(indicator => {
    const indicatorNorm = normalizeArabicPersian(indicator.toLowerCase());
    const regex = new RegExp(indicatorNorm, 'g');
    const matches = normalized.match(regex);
    if (matches) {
      strongQuoteCount += matches.length;
    }
  });
  
  impressionIndicators.forEach(indicator => {
    const indicatorNorm = normalizeArabicPersian(indicator.toLowerCase());
    if (normalized.includes(indicatorNorm)) {
      impressionCount++;
    }
  });
  
  quoteMarkers.forEach(marker => {
    const markerNorm = normalizeArabicPersian(marker.toLowerCase());
    const regex = new RegExp(markerNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = normalized.match(regex);
    if (matches) {
      quoteMarkerCount += matches.length;
    }
  });
  
  const quoteScore = Math.min(1.0, (strongQuoteCount * 0.3) + (quoteMarkerCount * 0.1));
  const impressionScore = Math.min(1.0, impressionCount * 0.25);
  const hasQuotes = strongQuoteCount > 0 || quoteMarkerCount >= 2;
  
  return {
    hasQuotes: hasQuotes,
    quoteScore: quoteScore,
    impressionScore: impressionScore,
    strongQuoteCount: strongQuoteCount
  };
}

function detectCausalityIndicators(documentText, questionAnalysis) {
  if (!documentText || !questionAnalysis.needsCausality) return 0;
  
  const normalized = normalizeArabicPersian(documentText.toLowerCase());
  
  const causalityIndicators = [
    'لانه', 'لأنه', 'لان', 'لأن',
    'بسبب', 'السبب', 'سبب',
    'لذلك', 'لهذا', 'من اجل',
    'نتيجة', 'نتيجه', 'بناء علي',
    'ذلك ان', 'اذ ان', 'حيث ان',
    'فان', 'كون', 'علة', 'معلول'
  ];
  
  let causalityCount = 0;
  let strongCausalityCount = 0;
  
  causalityIndicators.forEach(indicator => {
    const indicatorNorm = normalizeArabicPersian(indicator.toLowerCase());
    if (normalized.includes(indicatorNorm)) {
      causalityCount++;
      
      if (['لانه', 'لأنه', 'بسبب', 'السبب'].includes(indicator)) {
        strongCausalityCount++;
      }
    }
  });
  
  let proximityBonus = 0;
  if (questionAnalysis.mainSubject && causalityCount > 0) {
    const subjectNorm = normalizeArabicPersian(questionAnalysis.mainSubject.toLowerCase());
    const words = normalized.split(/\s+/);
    
    words.forEach((word, idx) => {
      if (word.includes(subjectNorm)) {
        for (let i = Math.max(0, idx - 10); i < Math.min(words.length, idx + 10); i++) {
          causalityIndicators.forEach(indicator => {
            const indicatorNorm = normalizeArabicPersian(indicator.toLowerCase());
            if (words[i].includes(indicatorNorm)) {
              proximityBonus = 0.3;
            }
          });
        }
      }
    });
  }
  
  const score = Math.min(0.7, 
    (strongCausalityCount * 0.3) + 
    (causalityCount * 0.15) + 
    proximityBonus
  );
  
  return score;
}

function detectMethodIndicators(documentText, questionAnalysis) {
  if (!documentText || !questionAnalysis.needsMethod) return 0;
  
  const normalized = normalizeArabicPersian(documentText.toLowerCase());
  
  const methodIndicators = [
    'يستدل', 'استدلال', 'دليل', 'دلائل',
    'يستشهد', 'استشهاد', 'شهادة', 'شاهد',
    'بواسطة', 'وسيلة', 'طريقة', 'منهج', 'مناهج',
    'كيفية', 'اسلوب', 'نهج', 'مسلك',
    'يتوصل', 'توصل', 'وسط', 'برهان'
  ];
  
  const sequentialIndicators = [
    'واحدا بعد واحد', 'بعد واحد',
    'ثم', 'فثم', 'اولا', 'ثانيا', 'ثالثا',
    'الخطوة', 'المرحلة', 'اولا ثم',
    'بعد ذلك', 'من ثم', 'تاليا'
  ];
  
  const definitiveMethodIndicators = [
    'فهؤلاء هم الذين', 'هؤلاء هم', 'هم الذين',
    'هذا المنهاج', 'هذه الطريقة', 'هذا الاسلوب',
    'احكم واشرف', 'افضل', 'اصح'
  ];
  
  let methodCount = 0;
  let strongMethodCount = 0;
  let sequentialCount = 0;
  let definitiveCount = 0;
  
  methodIndicators.forEach(indicator => {
    const indicatorNorm = normalizeArabicPersian(indicator.toLowerCase());
    if (normalized.includes(indicatorNorm)) {
      methodCount++;
      
      if (['يستدل', 'استدلال', 'يستشهد', 'استشهاد', 'منهج', 'مناهج', 'برهان'].includes(indicator)) {
        strongMethodCount++;
      }
    }
  });
  
  sequentialIndicators.forEach(indicator => {
    const indicatorNorm = normalizeArabicPersian(indicator.toLowerCase());
    if (normalized.includes(indicatorNorm)) {
      sequentialCount++;
    }
  });
  
  definitiveMethodIndicators.forEach(indicator => {
    const indicatorNorm = normalizeArabicPersian(indicator.toLowerCase());
    if (normalized.includes(indicatorNorm)) {
      definitiveCount++;
    }
  });
  
  let verbMatchBonus = 0;
  let contextualVerbMatch = false;
  
  if (questionAnalysis.mainVerb && questionAnalysis.concepts.length > 0) {
    const verbNorm = normalizeArabicPersian(questionAnalysis.mainVerb.toLowerCase());
    const verbRoot = getWordRoot(verbNorm);
    
    const words = normalized.split(/\s+/);
    const verbPositions = [];
    
    words.forEach((word, idx) => {
      if (word.includes(verbNorm) || 
          word.includes('يستشهد') ||
          word.includes('استشهاد') ||
          (verbRoot && word.includes(verbRoot))) {
        verbPositions.push(idx);
      }
    });
    
    if (verbPositions.length > 0) {
      questionAnalysis.concepts.forEach(concept => {
        const conceptNorm = normalizeArabicPersian(concept.toLowerCase());
        
        words.forEach((word, idx) => {
          if (word.includes(conceptNorm) || conceptNorm.includes(word)) {
            verbPositions.forEach(verbPos => {
              const distance = Math.abs(idx - verbPos);
              if (distance <= 20) {
                contextualVerbMatch = true;
              }
            });
          }
        });
      });
    }
    
    if (contextualVerbMatch) {
      if (normalized.includes(verbNorm)) {
        verbMatchBonus = 0.5;
      } else if (normalized.includes('يستشهد') || normalized.includes('استشهاد')) {
        verbMatchBonus = 0.45;
      } else {
        verbMatchBonus = 0.3;
      }
    } else {
      if (normalized.includes(verbNorm) || (verbRoot && normalized.includes(verbRoot))) {
        verbMatchBonus = 0.1;
      }
    }
  }
  
  let proximityBonus = 0;
  if (questionAnalysis.mainSubject && methodCount > 0) {
    const subjectNorm = normalizeArabicPersian(questionAnalysis.mainSubject.toLowerCase());
    const words = normalized.split(/\s+/);
    
    words.forEach((word, idx) => {
      if (word.includes(subjectNorm) || subjectNorm.includes(word)) {
        for (let i = Math.max(0, idx - 15); i < Math.min(words.length, idx + 15); i++) {
          methodIndicators.forEach(indicator => {
            const indicatorNorm = normalizeArabicPersian(indicator.toLowerCase());
            if (words[i].includes(indicatorNorm)) {
              proximityBonus = 0.25;
            }
          });
        }
      }
    });
  }
  
  let score = 
    (strongMethodCount * 0.15) + 
    (methodCount * 0.08) + 
    (sequentialCount * 0.15) +
    (definitiveCount * 0.2) +
    verbMatchBonus +
    proximityBonus;
  
  if (definitiveCount > 0 && sequentialCount > 0) {
    score += 0.2;
  }
  
  if (contextualVerbMatch && sequentialCount > 0) {
    score += 0.15;
  }
  
  return Math.min(0.8, score);
}

function detectDefinitionIndicators(documentText, questionAnalysis) {
  if (!documentText || !questionAnalysis.needsDefinition) return 0;
  
  const normalized = normalizeArabicPersian(documentText.toLowerCase());
  
  const definitionPatterns = [
    'عبارة عن', 'عباره عن',
    'هو عبارة', 'هي عبارة',
    'معناه', 'معناها', 'معنى',
    'المراد من', 'المراد به', 'المقصود من',
    'يعني', 'اي', 'بمعنى', 'والمعنى',
    'تعريف', 'تعريفه', 'تعريفها',
    'حقيقة', 'حقيقته', 'حقيقتها',
    'ماهية', 'ماهيته', 'ماهيتها',
    'هو ان', 'هي ان'
  ];
  
  const strongDefinitionPatterns = [
    'عبارة عن', 'عباره عن',
    'المراد من', 'المراد به',
    'حقيقة', 'حقيقته',
    'تعريف', 'تعريفه',
    'ماهية', 'ماهيته'
  ];
  
  const explanatoryConnectors = [
    'وهو', 'وهي', 'فهو', 'فهي',
    'اقول', 'والمعنى', 'يعني ان',
    'بمعنى ان', 'اي ان'
  ];
  
  let definitionCount = 0;
  let strongDefinitionCount = 0;
  let explanatoryCount = 0;
  
  definitionPatterns.forEach(pattern => {
    const patternNorm = normalizeArabicPersian(pattern.toLowerCase());
    if (normalized.includes(patternNorm)) {
      definitionCount++;
    }
  });
  
  strongDefinitionPatterns.forEach(pattern => {
    const patternNorm = normalizeArabicPersian(pattern.toLowerCase());
    if (normalized.includes(patternNorm)) {
      strongDefinitionCount++;
    }
  });
  
  explanatoryConnectors.forEach(connector => {
    const connectorNorm = normalizeArabicPersian(connector.toLowerCase());
    if (normalized.includes(connectorNorm)) {
      explanatoryCount++;
    }
  });
  
  let termDefinitionProximity = 0;
  
  if (questionAnalysis.definitionTerm) {
    const termNorm = normalizeArabicPersian(questionAnalysis.definitionTerm.toLowerCase());
    const words = normalized.split(/\s+/);
    
    const termPositions = [];
    words.forEach((word, idx) => {
      if (word.includes(termNorm) || termNorm.includes(word)) {
        termPositions.push(idx);
      }
    });
    
    if (termPositions.length > 0) {
      definitionPatterns.forEach(pattern => {
        const patternNorm = normalizeArabicPersian(pattern.toLowerCase());
        
        words.forEach((word, idx) => {
          if (word.includes(patternNorm) || normalized.substring(Math.max(0, idx * 5 - 20), (idx + 3) * 5).includes(patternNorm)) {
            termPositions.forEach(termPos => {
              const distance = Math.abs(idx - termPos);
              if (distance <= 8) {
                if (strongDefinitionPatterns.some(sp => patternNorm.includes(normalizeArabicPersian(sp.toLowerCase())))) {
                  termDefinitionProximity = Math.max(termDefinitionProximity, 0.6 - (distance * 0.05));
                } else {
                  termDefinitionProximity = Math.max(termDefinitionProximity, 0.4 - (distance * 0.05));
                }
              }
            });
          }
        });
      });
    }
  }
  
  let directDefinitionBonus = 0;
  if (questionAnalysis.definitionTerm) {
    const termNorm = normalizeArabicPersian(questionAnalysis.definitionTerm.toLowerCase());
    
    strongDefinitionPatterns.forEach(pattern => {
      const patternNorm = normalizeArabicPersian(pattern.toLowerCase());
      
      const termIndex = normalized.indexOf(termNorm);
      const patternIndex = normalized.indexOf(patternNorm);
      
      if (termIndex !== -1 && patternIndex !== -1) {
        const distance = Math.abs(patternIndex - termIndex);
        if (distance <= 50) {
          directDefinitionBonus = 0.4;
        }
      }
    });
  }
  
  let score = 
    (strongDefinitionCount * 0.2) +
    (definitionCount * 0.1) +
    (explanatoryCount * 0.05) +
    termDefinitionProximity +
    directDefinitionBonus;
  
  if (strongDefinitionCount > 0 && termDefinitionProximity > 0.3) {
    score += 0.2;
  }
  
  return Math.min(0.9, score);
}


module.exports = {
  detectQuotesAndImpressions,
  detectCausalityIndicators,
  detectMethodIndicators,
  detectDefinitionIndicators,
};