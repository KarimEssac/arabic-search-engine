const { normalizeArabicPersian, getWordRoot } = require('../core/textUtils');
const { detectPhraseMatches, calculateContextualRelevance, validateAnswerType, detectNegationContext } = require('./documentScoring');
const { detectQuotesAndImpressions, detectMethodIndicators, detectDefinitionIndicators, detectCausalityIndicators } = require('./domainDetectors');

function calculatePhraseProximity(documentText, keyTerms) {
  if (!documentText || keyTerms.length < 2) return 0;
  
  const normalizedDoc = normalizeArabicPersian(documentText.toLowerCase());
  const words = normalizedDoc.split(/\s+/);
  
  const termPositions = new Map();
  keyTerms.forEach(term => {
    const normalized = normalizeArabicPersian(term.toLowerCase());
    const positions = [];
    words.forEach((word, index) => {
      if (word.includes(normalized) || normalized.includes(word)) {
        positions.push(index);
      }
    });
    if (positions.length > 0) {
      termPositions.set(term, positions);
    }
  });
  
  if (termPositions.size < 2) return 0;
  
  let minDistance = Infinity;
  const termsList = Array.from(termPositions.keys());
  
  for (let i = 0; i < termsList.length; i++) {
    for (let j = i + 1; j < termsList.length; j++) {
      const positions1 = termPositions.get(termsList[i]);
      const positions2 = termPositions.get(termsList[j]);
      
      for (const pos1 of positions1) {
        for (const pos2 of positions2) {
          const distance = Math.abs(pos1 - pos2);
          if (distance < minDistance) {
            minDistance = distance;
          }
        }
      }
    }
  }
  
  if (minDistance === Infinity) return 0;
  if (minDistance <= 5) return 0.25;
  if (minDistance <= 10) return 0.15;
  if (minDistance <= 20) return 0.08;
  if (minDistance <= 40) return 0.03;
  return 0;
}

function calculateConceptBonus(documentText, questionAnalysis) {
  if (!questionAnalysis.isQuestion || !questionAnalysis.concepts) {
    return 0;
  }
  
  const normalizedDoc = normalizeArabicPersian(documentText.toLowerCase());
  let bonus = 0;
  let conceptsFound = 0;
  
  questionAnalysis.concepts.forEach(concept => {
    const normalized = normalizeArabicPersian(concept.toLowerCase());
    if (normalizedDoc.includes(normalized)) {
      conceptsFound++;
      bonus += 0.05;
    }
  });
  
  if (conceptsFound >= 2) {
    bonus += 0.05; 
  }
  
  if (questionAnalysis.needsDefinition) {
    const definitionScore = detectDefinitionIndicators(documentText, questionAnalysis);
    bonus += definitionScore * 0.20;
  }
  
  if (questionAnalysis.needsCausality) {
    const causalityScore = detectCausalityIndicators(documentText, questionAnalysis);
    bonus += causalityScore * 0.15; 
  }
  
  if (questionAnalysis.needsMethod) {
    const methodScore = detectMethodIndicators(documentText, questionAnalysis);
    bonus += methodScore * 0.15;
  }
  
  return Math.min(0.35, bonus); 
}

function reRankTopResults(topResults, query, questionAnalysis, expandedTerms) {
  return topResults.map(result => {
    let reRankScore = result.combinedScore * 0.75; 
    const contextScore = calculateContextualRelevance(
      result.textSnippet, 
      expandedTerms, 
      questionAnalysis
    );
    
    const phraseScore = detectPhraseMatches(result.textSnippet, query);
    const answerTypeScore = validateAnswerType(result.textSnippet, questionAnalysis);
    const negationPenalty = detectNegationContext(
      result.textSnippet, 
      questionAnalysis.keyTerms || []
    );
    
    reRankScore += (contextScore * 0.25);      
    reRankScore += (phraseScore * 0.25);       
    reRankScore += (answerTypeScore * 0.20);   
    reRankScore -= (negationPenalty * 0.15);   
    
    if (reRankScore > 0.35) {
      const boost = (reRankScore - 0.35) * 1.2; 
      reRankScore = 0.35 + boost + 0.30; 
    } else if (reRankScore > 0.20) {
      reRankScore = reRankScore * 1.6;
    }
    
    reRankScore = Math.max(0, Math.min(1.0, reRankScore));
    
    return {
      ...result,
      reRankScore: reRankScore,
      contextScore,
      phraseScore,
      answerTypeScore,
      negationPenalty
    };
  }).sort((a, b) => b.reRankScore - a.reRankScore);
}


module.exports = {
  calculatePhraseProximity,
  calculateConceptBonus,
  reRankTopResults,
};