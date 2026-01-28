const express = require('express');
const pool = require('../config/database');
const { CONFIG } = require('../config/config');
const { normalizeArabicPersian, getWordRoot, calculateFuzzyMatchBonus } = require('../core/textUtils');
const { getBatchIDF, getTotalDocumentCount } = require('../core/searchMetadata');
const { getCachedTermRanking, setCachedTermRanking } = require('../core/cacheManager');
const { processQuery } = require('../search/queryAnalysis');
const { calculatePhraseProximity, calculateConceptBonus, reRankTopResults } = require('../search/ranking');
const { buildVocabularyFromBatch, generateTFIDFVectorSync, cosineSimilarity } = require('../search/tfidf');
const { calculateKeywordScoreWithFuzzy } = require('../search/keywordScoring');
const { detectPhraseMatches, calculateContextualRelevance, validateAnswerType } = require('../search/documentScoring');
const { detectQuotesAndImpressions, detectMethodIndicators, detectDefinitionIndicators, detectCausalityIndicators } = require('../search/domainDetectors');
const { deduplicateResults } = require('../search/deduplication');

const router = express.Router();

// routes

router.get('/search', async (req, res) => {
  const query = req.query.q;
  const startTime = Date.now();
  const perfLog = {}; 

  if (!query || query.trim() === '') {
    return res.redirect('/');
  }

  try {
    const queryWordCount = query.trim().split(/\s+/).length;
    const similarityThreshold = (queryWordCount <= 2) ? 0.013 : 0.02;
    await pool.query(`SET pg_trgm.similarity_threshold = ${similarityThreshold}`);
    
    global.fuzzyLoggedThisSearch = false; 
    perfLog.start = Date.now();

    const processedQuery = processQuery(query);
    const searchWords = processedQuery.words;
    const keyTerms = processedQuery.keyTerms;
    const questionAnalysis = processedQuery.analysis;
    
    perfLog.queryProcessed = Date.now();


    if (searchWords.length === 0) {
      return res.send(generateHTML('نتائج البحث', `
        <div class="search-box">
          <form action="/search" method="GET">
            <input type="text" name="q" value="${query}" required>
            <button type="submit">بحث</button>
          </form>
          <button class="clear-btn" onclick="window.location.href='/'">مسح البحث</button>
        </div>
        <div class="no-results">لا توجد كلمات ذات معنى في الاستعلام</div>
      `));
    }

    //POSTGRESQL: Get candidates using processedText 
    const allConcepts = [
      ...(questionAnalysis.concepts || []),
      ...searchWords  // Add ALL meaningful words from the query!
    ];
    
    const coreTerms = [];
    const termMetadata = new Map();

    allConcepts.forEach(term => {
      const normalized = normalizeArabicPersian(term);
      if (normalized.length >= 2) {
        if (!termMetadata.has(normalized)) {
          termMetadata.set(normalized, {
            term: normalized,
            length: normalized.length,
            hasPrefix: normalized.startsWith('ال'),
            isRoot: false,
            isOriginalQueryTerm: true, 
            originalTerm: term
          });
        }
    
    coreTerms.push(normalized);

    const root = getWordRoot(normalized);
    if (root && root !== normalized && root.length >= 3) {
      if (!termMetadata.has(root)) {
        termMetadata.set(root, {
          term: root,
          length: root.length,
          hasPrefix: false,
          isRoot: true,
          isOriginalQueryTerm: false, 
          originalTerm: term
        });
      }
      coreTerms.push(root);
    }
    
    if (normalized.startsWith('ال') && normalized.length > 4) {
      const withoutPrefix = normalized.substring(2);
      if (!termMetadata.has(withoutPrefix)) {
        termMetadata.set(withoutPrefix, {
          term: withoutPrefix,
          length: withoutPrefix.length,
          hasPrefix: false,
          isRoot: false,
          isOriginalQueryTerm: false, 
          originalTerm: term
        });
      }
      coreTerms.push(withoutPrefix);
    }
  }
});

function rankTermQuality(metadata) {
  let score = 0;
  
  if (metadata.isOriginalQueryTerm) {
    score += 100; 
  }
  
  if (metadata.length >= 5) score += 10;
  else if (metadata.length === 4) score += 7;
  else if (metadata.length === 3) score += 4;
  else score += 1;
  
  if (!metadata.hasPrefix) score += 5;
  if (!metadata.isRoot) score += 3;
  
  const veryCommonShort = ['في', 'من', 'عن', 'على', 'هو', 'هي', 'كان', 'قد'];
  if (veryCommonShort.includes(metadata.term)) score -= 20;
  
  if (metadata.term.length >= 4 && !metadata.hasPrefix && !metadata.isRoot) {
    score += 4;
  }
  
  return score;
}


const cacheKey = Array.from(termMetadata.keys());
let rankedTerms = getCachedTermRanking(cacheKey);

if (!rankedTerms) {
  rankedTerms = Array.from(termMetadata.values())
    .map(meta => ({
      ...meta,
      score: rankTermQuality(meta)
    }))
    .sort((a, b) => b.score - a.score);
  
  setCachedTermRanking(cacheKey, rankedTerms);
} else {
}

// This makes DB queries faster and more precise
const uniqueTerms = rankedTerms
  .filter(t => t.isOriginalQueryTerm) 
  .map(t => t.term);

const allTermsForScoring = rankedTerms.map(t => t.term);


perfLog.termsRanked = Date.now();
    
    if (uniqueTerms.length === 0) {
      return res.send(generateHTML('نتائج البحث', `
        <div class="search-box">
          <form action="/search" method="GET">
            <input type="text" name="q" value="${query}" required>
            <button type="submit">بحث</button>
          </form>
          <button class="clear-btn" onclick="window.location.href='/'">مسح البحث</button>
        </div>
        <div class="no-results">لا توجد كلمات ذات معنى في الاستعلام</div>
      `));
    }
    
    // Two-tier search approach:
    // Tier 1: Documents matching MULTIPLE important terms
    // Tier 2: Documents matching ANY term
    
    const allSearchTerms = new Set([...uniqueTerms]);
    
    questionAnalysis.concepts.forEach(concept => {
      allSearchTerms.add(normalizeArabicPersian(concept));
    });
    
    searchWords.forEach(word => {
      allSearchTerms.add(normalizeArabicPersian(word));
    });
    
    const enhancedSearchTerms = Array.from(allSearchTerms).filter(t => t.length > 1);
    const importantTerms = rankedTerms.slice(0, 5).map(t => t.term);
    const andQuery = importantTerms.join(' & ');
    const orQuery = enhancedSearchTerms.join(' | ');
    const combinedQuery = `(${andQuery}) | (${orQuery})`;
    
    const sqlQuery = `
      SELECT 
        id, 
        "fileId", 
        "pageIndex", 
        "textSnippet",
        "processedText"
      FROM "HtmlEmbedding"
      WHERE tsv @@ to_tsquery('simple', $1)
      ORDER BY ts_rank(tsv, to_tsquery('simple', $1)) DESC
      LIMIT $2
    `;

    const params = [combinedQuery, CONFIG.MAX_INITIAL_CANDIDATES];

    
    
    let result = await pool.query(sqlQuery, params);
    
    if (queryWordCount <= 2 && result.rows.length < 50) {
      const variantQuery = `
        SELECT
          id, 
          "fileId", 
          "pageIndex", 
          "textSnippet",
          "processedText"
        FROM "HtmlEmbedding"
        WHERE "processedText" % ANY($1)
        ORDER BY id DESC
        LIMIT 100
      `;
      
      const variantResult = await pool.query(variantQuery, [enhancedSearchTerms]);
      
      const existingIds = new Set(result.rows.map(r => r.id));
      const newRows = variantResult.rows.filter(r => !existingIds.has(r.id));
      result.rows = [...result.rows, ...newRows];
    }
    
    perfLog.sqlCompleted = Date.now();
    
    const expandedTerms = allTermsForScoring;

    if (result.rows.length === 0) {
      const fallbackTerms = searchWords.slice(0, 3);

      const fallbackQuery = `
        SELECT 
          id, 
          "fileId", 
          "pageIndex", 
          "textSnippet",
          "processedText"
        FROM "HtmlEmbedding"
        WHERE "textSnippet" % ANY($1)
        ORDER BY id DESC
        LIMIT 100
      `;

      const fallbackParams = [fallbackTerms];
      const fallbackResult = await pool.query(fallbackQuery, fallbackParams);
      
      if (fallbackResult.rows.length === 0) {
        return res.send(generateHTML('نتائج البحث', `
          <div class="search-box">
            <form action="/search" method="GET">
              <input type="text" name="q" value="${query}" required>
              <button type="submit">بحث</button>
            </form>
            <button class="clear-btn" onclick="window.location.href='/'">مسح البحث</button>
          </div>
          <div class="no-results">لا توجد نتائج مطابقة. جرب كلمات مختلفة.</div>
        `));
      }
      
      result.rows = fallbackResult.rows;
    }

    
    const totalDocs = await getTotalDocumentCount();
    const vocabulary = await buildVocabularyFromBatch(result.rows);
    
    perfLog.vocabularyBuilt = Date.now();
    
    const allTerms = new Set();
    result.rows.forEach(row => {
      const text = row.textSnippet || '';
      const normalized = normalizeArabicPersian(text);
      const words = normalized.split(/\s+/).filter(w => w.length > 1);
      words.forEach(word => allTerms.add(word));
    });
    
    const idfMap = await getBatchIDF([...allTerms], totalDocs);
    
    perfLog.idfLoaded = Date.now();
    
    const cleanedQueryForTFIDF = processedQuery.normalized;
    const queryVector = generateTFIDFVectorSync(cleanedQueryForTFIDF, vocabulary, idfMap, totalDocs);
    
    perfLog.scoringStart = Date.now();
    
    let timeInKeywordScore = 0;
    let timeInPhraseDetection = 0;
    let timeInContextualRelevance = 0;
    let timeInTFIDF = 0;
    
    const resultsWithScores = result.rows.map(row => {
      const tfidfStart = Date.now();
      const docVector = generateTFIDFVectorSync(row.textSnippet || '', vocabulary, idfMap, totalDocs);
      const tfidfSimilarity = cosineSimilarity(queryVector, docVector);
      timeInTFIDF += (Date.now() - tfidfStart);
      
      const proximityScore = calculatePhraseProximity(row.textSnippet, keyTerms);
      const quoteAnalysis = detectQuotesAndImpressions(row.textSnippet);
      
      const keywordStart = Date.now();
      const keywordScore = calculateKeywordScoreWithFuzzy(
        searchWords, 
        keyTerms, 
        row.textSnippet, 
        questionAnalysis
      );
      timeInKeywordScore += (Date.now() - keywordStart);
      
      const conceptBonus = calculateConceptBonus(row.textSnippet, questionAnalysis);
      
      const causalityScore = questionAnalysis.needsCausality ? 
        detectCausalityIndicators(row.textSnippet, questionAnalysis) : 0;
      
      const methodScore = questionAnalysis.needsMethod ?
        detectMethodIndicators(row.textSnippet, questionAnalysis) : 0;
      
      const definitionScore = questionAnalysis.needsDefinition ?
        detectDefinitionIndicators(row.textSnippet, questionAnalysis) : 0;
      
      const phraseStart = Date.now();
      // Use cleaned query for consistent phrase matching
      const phraseScore = detectPhraseMatches(row.textSnippet, cleanedQueryForTFIDF);
      timeInPhraseDetection += (Date.now() - phraseStart);
      
      const contextStart = Date.now();
      const contextScore = calculateContextualRelevance(row.textSnippet, expandedTerms, questionAnalysis);
      timeInContextualRelevance += (Date.now() - contextStart);
      
      const answerTypeScore = validateAnswerType(row.textSnippet, questionAnalysis);
      const fuzzyBonus = calculateFuzzyMatchBonus(row.textSnippet, searchWords);
      
      let tfidfWeight = 0.55;      
      let keywordWeight = 0.25;   
      let proximityWeight = 0.12;   
      let phraseWeight = 0.08;
      
      // Single-word or very short queries need different weighting
      const queryWordCount = searchWords.length;
      if (queryWordCount <= 2) {
        // For 1-2 word queries, heavily favor keyword matching over TF-IDF
        tfidfWeight = 0.20; 
        keywordWeight = 0.60; 
        proximityWeight = 0.10;   
        phraseWeight = 0.10;
      } else if (questionAnalysis.isQuestion) {
        tfidfWeight = 0.52;        
        keywordWeight = 0.28;      
        proximityWeight = 0.12;
        phraseWeight = 0.08;
      }
      
      let combinedScore = 
        (tfidfSimilarity * tfidfWeight) +     
        (keywordScore * keywordWeight) +
        (proximityScore * proximityWeight) +
        (phraseScore * phraseWeight);
      
      const minTfidfForFullBonus = 0.10; 
      const tfidfMultiplier = Math.min(1.0, tfidfSimilarity / minTfidfForFullBonus);
      
      if (questionAnalysis.needsDefinition && definitionScore > 0) {
        const baseBonus = definitionScore * 0.25;
        combinedScore += (baseBonus * tfidfMultiplier);
      }
      
      if (questionAnalysis.needsMethod && methodScore > 0) {
        const baseBonus = methodScore * 0.20;
        combinedScore += (baseBonus * tfidfMultiplier);
      }
      
      if (questionAnalysis.needsCausality && causalityScore > 0) {
        const baseBonus = causalityScore * 0.20;
        combinedScore += (baseBonus * tfidfMultiplier);
      }
      
      if (questionAnalysis.needsQuotes && quoteAnalysis.quoteScore > 0) {
        combinedScore += (quoteAnalysis.quoteScore * 0.12);
      }
      
      combinedScore += (contextScore * 0.10);
      combinedScore += (answerTypeScore * 0.06);
      combinedScore += (conceptBonus * 0.08);
      
      combinedScore = Math.min(1.5, combinedScore);
      
      return {
        ...row,
        tfidfSimilarity,
        keywordScore,
        proximityScore,
        causalityScore,
        methodScore,
        definitionScore,
        phraseScore,
        contextScore,
        answerTypeScore,
        fuzzyBonus,
        conceptBonus,
        combinedScore,
        quoteScore: quoteAnalysis.quoteScore || 0,
        hasQuotes: quoteAnalysis.hasQuotes || false,
        tfidfMultiplier
      };
    });
    
    perfLog.scoringCompleted = Date.now();
    const totalScoringTime = perfLog.scoringCompleted - perfLog.scoringStart;

    resultsWithScores.sort((a, b) => b.combinedScore - a.combinedScore);
    
    const docsWithTermScored = resultsWithScores.filter(row => {
      const text = (row.textSnippet || '') + ' ' + (row.processedText || '');
      return text
    });
    if (docsWithTermScored.length > 0) {
    }
    
    const topCandidates = resultsWithScores.slice(0, 20);
    perfLog.reRankStart = Date.now();
    const reRanked = reRankTopResults(topCandidates, cleanedQueryForTFIDF, questionAnalysis, expandedTerms);
    
    perfLog.reRankCompleted = Date.now();
    
    perfLog.dedupStart = Date.now();
    const deduplicatedResults = deduplicateResults(reRanked, CONFIG.SIMILARITY_THRESHOLD);
    perfLog.dedupCompleted = Date.now();
    const topResults = deduplicatedResults
      .filter(r => r.reRankScore >= 0.35)
      .slice(0, CONFIG.MAX_FINAL_RESULTS);
    
    const searchTime = ((Date.now() - startTime) / 1000).toFixed(2);
    perfLog.renderStart = Date.now();
    
    topResults.slice(0, 3).forEach((r, i) => {
    });

    let itemsHtml = '';
    if (topResults.length === 0) {
      itemsHtml = '<div class="no-results">لا توجد نتائج مطابقة. جرب كلمات مختلفة.</div>';
    } else {
      topResults.forEach((row, index) => {
        const snippet = row.textSnippet ? row.textSnippet.substring(0, 300) + '...' : 'لا يوجد نص';
        const scorePercent = (row.reRankScore * 100).toFixed(1);
        
        let scoreColor = '#4CAF50';
        if (row.reRankScore < 0.4) scoreColor = '#ff9800';
        if (row.reRankScore < 0.2) scoreColor = '#f44336';
        
        let scoringDetails = `
          <div class="scoring-details">
            TF-IDF: ${(row.tfidfSimilarity * 100).toFixed(1)}% | 
            Keywords: ${(row.keywordScore * 100).toFixed(1)}% | 
            Phrase: ${(row.phraseScore * 100).toFixed(1)}% | 
            Context: ${(row.contextScore * 100).toFixed(1)}%`;
        
        if (row.fuzzyBonus > 0) {
          scoringDetails += ` | <span style="color: #ff5722; font-weight: bold;">Fuzzy: ${(row.fuzzyBonus * 100).toFixed(1)}%</span>`;
        }
        if (row.definitionScore > 0) {
          scoringDetails += ` | Def: ${(row.definitionScore * 100).toFixed(1)}%`;
        }
        if (row.methodScore > 0) {
          scoringDetails += ` | Method: ${(row.methodScore * 100).toFixed(1)}%`;
        }
        if (row.causalityScore > 0) {
          scoringDetails += ` | Cause: ${(row.causalityScore * 100).toFixed(1)}%`;
        }
        if (row.negationPenalty > 0) {
          scoringDetails += ` | Negation: -${(row.negationPenalty * 100).toFixed(1)}%`;
        }
        
        scoringDetails += `</div>`;
        
        itemsHtml += `
          <div class="topic-item">
            <div class="topic-header">
              <span class="topic-id">نتيجة ${index + 1} (ID: ${row.id})</span>
              <span class="score-badge" style="background: ${scoreColor}; color: white; padding: 5px 10px; border-radius: 3px;">تطابق ${scorePercent}%</span>
            </div>
            <div class="topic-snippet">${snippet}</div>
            ${scoringDetails}
            <a href="/topic/${row.id}" class="view-link">عرض كامل</a>
          </div>
        `;
      });
    }

    res.send(generateHTML(`نتائج البحث: "${query}"`, `
      <div class="search-box">
        <form action="/search" method="GET" style="display: inline;">
          <input type="text" name="q" value="${query}" placeholder="ابحث بالمعنى..." required>
          <button type="submit">بحث</button>
        </form>
        <button class="clear-btn" onclick="window.location.href='/'">مسح البحث</button>
      </div>
      ${topResults.length > 0 ? `<div class="results-count">عدد النتائج: ${topResults.length} | تم البحث في ${result.rows.length} مستند | وقت البحث: ${searchTime}ث | البحث الدلالي المحلي ✓ | مع دعم التصحيح التلقائي${reRanked.length - deduplicatedResults.length > 0 ? ` | تم إزالة ${reRanked.length - deduplicatedResults.length} نتيجة مكررة` : ''}</div>` : ''}
      ${itemsHtml}
    `));
  } catch (error) {
    res.status(500).send(generateHTML('خطأ في البحث', `
      <div class="error-box">
        <h2>حدث خطأ في البحث</h2>
        <p>${error.message}</p>
        <a href="/">العودة للصفحة الرئيسية</a>
      </div>
    `));
  }
});

router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 30;
  const offset = (page - 1) * limit;

  try {
    const countResult = await pool.query('SELECT COUNT(*) FROM "HtmlEmbedding"');
    const totalItems = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalItems / limit);

    const result = await pool.query(
      'SELECT id, "fileId", "pageIndex", "textSnippet" FROM "HtmlEmbedding" ORDER BY id LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    let paginationHtml = '<div class="pagination">';
    if (page > 1) {
      paginationHtml += `<a href="/?page=${page - 1}">السابق</a>`;
    }
    paginationHtml += `<span>صفحة ${page} من ${totalPages}</span>`;
    if (page < totalPages) {
      paginationHtml += `<a href="/?page=${page + 1}">التالي</a>`;
    }
    paginationHtml += '</div>';

    let itemsHtml = '';
    result.rows.forEach(row => {
      const snippet = row.textSnippet ? row.textSnippet.substring(0, 300) + '...' : 'لا يوجد نص';
      itemsHtml += `
        <div class="topic-item">
          <div class="topic-header">
            <span class="topic-id">ID: ${row.id}</span>
            <span>الملف: ${row.fileId}, الصفحة: ${row.pageIndex}</span>
          </div>
          <div class="topic-snippet">${snippet}</div>
          <a href="/topic/${row.id}" class="view-link">عرض كامل</a>
        </div>
      `;
    });

    res.send(generateHTML('قاعدة البيانات', `
      <div class="search-box">
        <form action="/search" method="GET">
          <input type="text" name="q" placeholder="ابحث بالمعنى..." required>
          <button type="submit">بحث</button>
        </form>
      </div>
      <div class="results-count">عدد المستندات: ${totalItems}</div>
      ${itemsHtml}
      ${paginationHtml}
    `));
  } catch (error) {
    res.status(500).send(generateHTML('خطأ', `<div class="error-box">حدث خطأ في قاعدة البيانات: ${error.message}</div>`));
  }
});

router.get('/topic/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, "fileId", "pageIndex", "textSnippet" FROM "HtmlEmbedding" WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send(generateHTML('غير موجود', '<div class="error-box">المستند غير موجود</div>'));
    }

    const row = result.rows[0];
    res.send(generateHTML(`مستند ${row.id}`, `
      <a href="/" class="back-link">← العودة للصفحة الرئيسية</a>
      <div class="info-box">
        <div class="info-item"><strong>معرّف المستند:</strong> ${row.id}</div>
        <div class="info-item"><strong>معرّف الملف:</strong> ${row.fileId}</div>
        <div class="info-item"><strong>رقم الصفحة:</strong> ${row.pageIndex}</div>
      </div>
      <div class="content-box">${row.textSnippet || 'لا يوجد نص'}</div>
    `));
  } catch (error) {
    res.status(500).send(generateHTML('خطأ', `<div class="error-box">حدث خطأ: ${error.message}</div>`));
  }
});

function generateHTML(title, content) {
  return `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        body { font-family: Arial; margin: 20px; background: #f5f5f5; }
        .container { max-width: 900px; margin: 0 auto; background: white; padding: 20px; border: 1px solid #ddd; }
        h1 { color: #333; border-bottom: 2px solid #666; padding-bottom: 10px; }
        .search-box { margin-bottom: 20px; padding: 15px; background: #f9f9f9; border: 1px solid #ddd; }
        input[type="text"] { width: 70%; padding: 10px; font-size: 16px; border: 1px solid #ccc; }
        button { padding: 10px 20px; font-size: 16px; background: #4CAF50; color: white; border: none; cursor: pointer; margin-left: 5px; }
        button:hover { background: #45a049; }
        .clear-btn { background: #f44336; }
        .clear-btn:hover { background: #da190b; }
        .topic-item { margin-bottom: 15px; padding: 15px; background: #fafafa; border: 1px solid #ddd; border-right: 3px solid #4CAF50; }
        .topic-header { margin-bottom: 8px; color: #666; font-size: 14px; display: flex; justify-content: space-between; }
        .topic-id { font-weight: bold; }
        .score-badge { font-size: 13px; padding: 5px 10px; border-radius: 3px; font-weight: 600; }
        .topic-snippet { line-height: 1.6; margin-bottom: 10px; }
        .scoring-details { font-size: 11px; color: #666; margin-top: 8px; padding: 8px; background: #f5f5f5; border-radius: 3px; }
        .view-link { color: #4CAF50; text-decoration: none; font-weight: bold; }
        .view-link:hover { text-decoration: underline; }
        .no-results { padding: 30px; text-align: center; color: #666; font-size: 18px; }
        .results-count { margin-bottom: 15px; padding: 10px; background: #e8f5e9; border: 1px solid #4CAF50; color: #2e7d32; font-weight: bold; }
        .error-box { padding: 30px; background: #ffebee; border: 1px solid #f44336; color: #c62828; }
        .pagination { margin-top: 20px; padding: 15px; text-align: center; background: #f9f9f9; border: 1px solid #ddd; }
        .pagination a { display: inline-block; padding: 8px 16px; margin: 0 5px; background: #4CAF50; color: white; text-decoration: none; border-radius: 3px; }
        .pagination a:hover { background: #45a049; }
        .pagination span { margin: 0 15px; font-weight: bold; }
        .back-link { display: inline-block; margin-bottom: 20px; padding: 10px 15px; background: #4CAF50; color: white; text-decoration: none; border-radius: 3px; }
        .back-link:hover { background: #45a049; }
        .info-box { background: #f9f9f9; padding: 15px; margin-bottom: 20px; border: 1px solid #ddd; }
        .info-item { margin: 5px 0; color: #666; }
        .content-box { padding: 20px; background: #fafafa; border: 1px solid #ddd; line-height: 1.8; white-space: pre-wrap; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>${title}</h1>
        ${content}
      </div>
    </body>
    </html>
  `;
}


module.exports = router;