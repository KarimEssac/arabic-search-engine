const pool = require("../config/database");
const cacheManager = require("./cacheManager");

async function getTotalDocumentCount() {
  const now = Date.now();

  if (
    cacheManager.getTotalDocsCache() > 0 &&
    cacheManager.getCacheLastUpdated() &&
    now - cacheManager.getCacheLastUpdated() <
      cacheManager.CACHE_REFRESH_INTERVAL
  ) {
    return cacheManager.getTotalDocsCache();
  }

  try {
    const result = await pool.query(
      'SELECT value FROM "SearchMetadata" WHERE key = $1',
      ["total_documents"],
    );

    if (result.rows.length > 0) {
      cacheManager.setTotalDocsCache(parseInt(result.rows[0].value));
      cacheManager.setCacheLastUpdated(now);
      return cacheManager.getTotalDocsCache();
    }

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM "HtmlEmbedding" WHERE "processedText" IS NOT NULL',
    );
    cacheManager.setTotalDocsCache(parseInt(countResult.rows[0].count));
    cacheManager.setCacheLastUpdated(now);

    await pool.query(
      'INSERT INTO "SearchMetadata" (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP',
      ["total_documents", cacheManager.getTotalDocsCache().toString()],
    );

    return cacheManager.getTotalDocsCache();
  } catch (error) {
    return cacheManager.getTotalDocsCache() || 1;
  }
}

// get IDF score
async function getBatchIDF(terms, totalDocs = null) {
  if (!totalDocs) {
    totalDocs = await getTotalDocumentCount();
  }

  if (totalDocs === 0 || terms.length === 0) return new Map();

  if (terms.length > 500) {
    const batchSize = 500;
    const idfMap = new Map();

    for (let i = 0; i < terms.length; i += batchSize) {
      const batch = terms.slice(i, i + batchSize);
      const batchResults = await getBatchIDF(batch, totalDocs);
      batchResults.forEach((value, key) => idfMap.set(key, value));
    }
    return idfMap;
  }

  try {
    const result = await pool.query(
      'SELECT term, document_frequency FROM "TermStatistics" WHERE term = ANY($1)',
      [terms],
    );

    const idfMap = new Map();
    const foundTerms = new Set();

    result.rows.forEach((row) => {
      const idf = Math.log(totalDocs / row.document_frequency);
      idfMap.set(row.term, idf);
      foundTerms.add(row.term);
    });

    // For terms not in DB
    terms.forEach((term) => {
      if (!foundTerms.has(term)) {
        idfMap.set(term, Math.log(totalDocs));
      }
    });

    return idfMap;
  } catch (error) {
    return new Map();
  }
}

// initiazize search metadata
async function initializeSearchMetadata() {
  try {
    const tablesExist = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'TermStatistics'
      ) as term_stats,
      EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'SearchMetadata'
      ) as search_meta
    `);

    if (!tablesExist.rows[0].term_stats || !tablesExist.rows[0].search_meta) {
      return;
    }

    const totalDocs = await getTotalDocumentCount();
    const termCount = await pool.query('SELECT COUNT(*) FROM "TermStatistics"');
  } catch (error) {}
}

module.exports = {
  getTotalDocumentCount,
  getBatchIDF,
  initializeSearchMetadata,
};
