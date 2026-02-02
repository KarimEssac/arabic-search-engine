// Search Configuration
const CONFIG = {
  MAX_INITIAL_CANDIDATES: 300,  // Back to 300 for comprehensive results
  MAX_FINAL_RESULTS: 10,
  MIN_KEYWORD_SCORE: 0.08,
  SIMILARITY_THRESHOLD: 0.85,
  
  // fuzzy matvching config
  FUZZY_MIN_WORD_LENGTH: 5,       
  FUZZY_MIN_EXACT_SCORE: 0.3,      
  FUZZY_MAX_TERMS: 3,            
  FUZZY_ENABLED: true,       
};

// Database Configuration
const DB_CONFIG = {
  user: '',
  host: '',
  database: '',
  password: '',
  port: 5432,
};

// Server Configuration
const SERVER_CONFIG = {
  port: 3000,
};

// Cache Configuration
const CACHE_CONFIG = {
  CACHE_MAX_SIZE: 1000,
  CACHE_REFRESH_INTERVAL: 5 * 60 * 1000,
};

module.exports = {
  CONFIG,
  DB_CONFIG,
  SERVER_CONFIG,
  CACHE_CONFIG,
};