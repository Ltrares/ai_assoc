const express = require('express');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

// Import shared puzzle generator module and puzzle repository
const puzzleGenerator = require('./lib/puzzle-generator');
const puzzleRepository = require('./lib/puzzle-repository');

// Get environment variables
require('dotenv').config();

// Initialize API keys securely
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY is not set - required for word associations");
  process.exit(1);
}

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3001;

// Game state
let dailyGame = {
  startWord: null,
  targetWord: null,
  associationGraph: {},
  gameDate: null,
  stats: { 
    totalPlays: 0, 
    completions: [], 
    averageSteps: 0,
    backSteps: [],
    averageBackSteps: 0, 
    totalSteps: [],
    averageTotalSteps: 0
  }
};

// Track when the next game will be generated
let nextGameTime = new Date();
nextGameTime.setHours(nextGameTime.getHours() + 1);
nextGameTime.setMinutes(0);

// Cache for word associations
let associationCache = {};

// Promisify fs functions
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);

// API usage limits
const apiLimits = {
  dailyLimit: parseInt(process.env.DAILY_API_LIMIT || 1000),
  dailyCount: 0,
  lastReset: new Date(),
  userRateLimit: {}, // Track per IP for rate limiting
  ipThrottling: parseInt(process.env.IP_RATE_LIMIT || 50), // Requests per IP per hour
  gameGenerationPerDay: parseInt(process.env.GAMES_PER_DAY || 24), // How many new games to generate per day
  gamesGenerated: 0
};

// Track cache hits and misses for monitoring
const cacheStats = {
  hits: 0,
  misses: 0,
  lastCleared: new Date(),
  hintHits: 0,
  hintMisses: 0,
  lastSaved: null
};

// Cache for hint responses to avoid repeated API calls
const hintCache = {}; // Format: 'startWord-targetWord-currentWord': 'hint'

// API call tracker for server implementation
function onApiCallMade() {
  // Increment API usage count
  apiLimits.dailyCount++;
  console.log(`API call made (${apiLimits.dailyCount}/${apiLimits.dailyLimit} today)`);
  
  // Check if we should reset the counter based on date
  const now = new Date();
  const lastResetDate = apiLimits.lastReset.toISOString().split('T')[0];
  const currentDate = now.toISOString().split('T')[0];
  
  if (currentDate !== lastResetDate) {
    console.log(`New day detected, resetting API counters`);
    apiLimits.dailyCount = 1; // Count the call we just made
    apiLimits.lastReset = now;
    apiLimits.userRateLimit = {}; // Reset all user limits
  }
  
  // API limit check - no fallback, just throw an error if over limit
  if (apiLimits.dailyCount > apiLimits.dailyLimit) {
    console.warn(`API daily limit reached (${apiLimits.dailyCount}/${apiLimits.dailyLimit})`);
    throw new Error('API daily limit reached - unable to get associations');
  }
}

// Flag to track if game generation is in progress
let isGeneratingGame = false;

// Generate a new puzzle using the shared module
async function generatePuzzle(useRepository = false) {
  // If already generating a game, don't start another one
  if (isGeneratingGame) {
    console.log("Game generation already in progress, skipping new request");
    return dailyGame;
  }
  
  try {
    isGeneratingGame = true;
    
    // If requested to use repository, try to get a saved puzzle first
    if (useRepository) {
      console.log("Trying to use a saved puzzle from repository...");
      const savedPuzzle = await puzzleRepository.getRandomPuzzle();
      
      if (savedPuzzle) {
        console.log(`Using saved puzzle: ${savedPuzzle.startWord} → ${savedPuzzle.targetWord}`);
        
        // Check if we already have a game - if not, create stats object
        const existingStats = (dailyGame && dailyGame.stats) ? { ...dailyGame.stats } : {
          totalPlays: 0,
          completions: [],
          averageSteps: 0,
          backSteps: [],
          averageBackSteps: 0,
          totalSteps: [],
          averageTotalSteps: 0
        };
        
        // Update game date to today
        const today = new Date().toISOString().split('T')[0];
        
        // Update the daily game state, preserving stats if they exist
        dailyGame = {
          ...savedPuzzle,
          gameDate: today,
          stats: existingStats
        };
        
        // Update next game time
        nextGameTime = new Date();
        nextGameTime.setHours(nextGameTime.getHours() + 1);
        nextGameTime.setMinutes(0);
        
        console.log(`Loaded saved puzzle: ${dailyGame.startWord} → ${dailyGame.targetWord}`);
        console.log(`Theme: ${dailyGame.theme} (${dailyGame.difficulty})`);
        console.log(`Hidden path: ${dailyGame.hiddenSolution.join(' → ')}`);
        
        return dailyGame;
      }
      
      // If no saved puzzle is available, continue with generation
      console.log("No suitable saved puzzle found, generating new one...");
    }
    
    console.log("Generating new puzzle using shared module...");
    
    // Use the shared puzzle generator
    const puzzle = await puzzleGenerator.generatePuzzle(associationCache, anthropic, onApiCallMade);
    
    // Check if we already have a game - if not, create stats object
    const existingStats = (dailyGame && dailyGame.stats) ? { ...dailyGame.stats } : {
      totalPlays: 0,
      completions: [],
      averageSteps: 0,
      backSteps: [],
      averageBackSteps: 0,
      totalSteps: [],
      averageTotalSteps: 0
    };
    
    // Update the daily game state, preserving stats if they exist
    dailyGame = {
      startWord: puzzle.startWord,
      targetWord: puzzle.targetWord,
      theme: puzzle.theme,
      description: puzzle.description,
      difficulty: puzzle.difficulty,
      hiddenSolution: puzzle.hiddenSolution,
      gameDate: puzzle.gameDate || new Date().toISOString().split('T')[0],
      stats: existingStats
    };
    
    // Update next game time
    nextGameTime = new Date();
    nextGameTime.setHours(nextGameTime.getHours() + 1);
    nextGameTime.setMinutes(0);
    
    console.log(`New game generated: ${dailyGame.startWord} → ${dailyGame.targetWord}`);
    console.log(`Theme: ${dailyGame.theme} (${dailyGame.difficulty})`);
    console.log(`Hidden path: ${dailyGame.hiddenSolution.join(' → ')}`);
    
    // Save the newly generated puzzle to the repository for future use
    const saveResult = await puzzleRepository.savePuzzle(puzzle);
    if (saveResult.success) {
      console.log(`Puzzle saved to repository for future use: ${saveResult.filename}`);
    }
    
    return dailyGame;
  } catch (error) {
    console.error('Error generating puzzle:', error);
    
    // Try to get a fallback puzzle from repository
    try {
      console.log("Attempting to load fallback puzzle from repository...");
      const fallbackPuzzle = await puzzleRepository.getFallbackPuzzle();
      
      if (fallbackPuzzle) {
        console.log(`Using fallback puzzle: ${fallbackPuzzle.startWord} → ${fallbackPuzzle.targetWord}`);
        
        // Check if we already have a game - if not, create stats object
        const existingStats = (dailyGame && dailyGame.stats) ? { ...dailyGame.stats } : {
          totalPlays: 0,
          completions: [],
          averageSteps: 0,
          backSteps: [],
          averageBackSteps: 0,
          totalSteps: [],
          averageTotalSteps: 0
        };
        
        // Update game date to today
        const today = new Date().toISOString().split('T')[0];
        
        // Update the daily game state, preserving stats if they exist
        dailyGame = {
          ...fallbackPuzzle,
          gameDate: today,
          stats: existingStats
        };
        
        // Update next game time
        nextGameTime = new Date();
        nextGameTime.setHours(nextGameTime.getHours() + 1);
        nextGameTime.setMinutes(0);
        
        return dailyGame;
      }
    } catch (fallbackError) {
      console.error('Error getting fallback puzzle:', fallbackError);
    }
    
    // If fallback also fails, rethrow the original error
    throw error;
  } finally {
    // Always reset the generation flag when done, even if there was an error
    isGeneratingGame = false;
  }
}

// Get associations with cache fallback and API limiting
async function getAssociations(word) {
  try {
    // Use the shared function
    return await puzzleGenerator.getAssociations(associationCache, word, anthropic, onApiCallMade);
  } catch (error) {
    console.error('Error in getAssociations:', error);
    // Throw the error instead of returning a fallback
    throw error;
  }
}

// Function to get a hint for the player
async function getHintFromAI(startWord, targetWord, currentWord) {
  try {
    // Check if we're over API limit
    if (apiLimits.dailyCount >= apiLimits.dailyLimit) {
      throw new Error('API daily limit reached - unable to generate hint');
    }
    
    // Normalize for consistent caching
    const normalizedStart = startWord.toLowerCase().trim();
    const normalizedTarget = targetWord.toLowerCase().trim();
    const normalizedCurrent = currentWord.toLowerCase().trim();
    
    // Create a cache key
    const cacheKey = `${normalizedStart}-${normalizedTarget}-${normalizedCurrent}`;
    
    // Check hint cache first
    if (hintCache[cacheKey]) {
      cacheStats.hintHits++;
      console.log(`Hint cache HIT for ${cacheKey}`);
      return hintCache[cacheKey];
    }
    
    cacheStats.hintMisses++;
    console.log(`Hint cache MISS for ${cacheKey}`);
    
    // Make API call
    apiLimits.dailyCount++;
    console.log(`API call for hint (${apiLimits.dailyCount}/${apiLimits.dailyLimit} today)`);
    
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 150,
      messages: [
        {
          role: "user",
          content: `I am playing a word association game. I need to find a path from "${startWord}" to "${targetWord}" by finding words that are associated with each other. I'm currently at "${currentWord}".

Give me a subtle hint for a word that's associated with "${currentWord}" and will help me move toward "${targetWord}". 

Your hint should:
1. NOT directly reveal any next words
2. Be short (1-2 sentences max)
3. Nudge me in the right direction
4. Not be too obvious

Return ONLY the hint text with no extra explanations or formatting.`
        }
      ]
    });
    
    // Extract the AI's hint
    const hint = message.content[0].text.trim();
    
    // Cache the hint
    hintCache[cacheKey] = hint;
    
    return hint;
  } catch (error) {
    console.error('Error getting hint:', error);
    throw error;
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, '..', 'client/build')));

// Routes
// API health check endpoint
app.get('/api/health', (req, res) => {
  res.send('Word Association Game API is running');
});

// Get cache stats (for monitoring)
app.get('/api/admin/cache-stats', (req, res) => {
  try {
    // Check for admin auth in production
    if (process.env.NODE_ENV === 'production') {
      // First check query param for browser access
      const tokenParam = req.query.token;
      const authHeader = req.headers.authorization;
      
      // Allow either header auth or query param auth
      const isAuthorized = 
        (tokenParam && tokenParam === process.env.ADMIN_SECRET) ||
        (authHeader && authHeader === `Bearer ${process.env.ADMIN_SECRET}`);
        
      if (!isAuthorized) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    const cacheSize = Object.keys(associationCache).length;
    const hintCacheSize = Object.keys(hintCache).length;
    
    const wordHitRate = cacheStats.hits + cacheStats.misses > 0 
      ? (cacheStats.hits / (cacheStats.hits + cacheStats.misses) * 100).toFixed(2) 
      : 0;
      
    const hintHitRate = cacheStats.hintHits + cacheStats.hintMisses > 0 
      ? (cacheStats.hintHits / (cacheStats.hintHits + cacheStats.hintMisses) * 100).toFixed(2) 
      : 0;
    
    // Calculate API calls saved by caching
    const totalCacheSavings = cacheStats.hits + cacheStats.hintHits;
    
    // Check if cache file exists and get its stats
    let cacheFileInfo = {
      exists: false,
      size: 0,
      lastModified: null,
    };
    
    try {
      if (fs.existsSync(puzzleGenerator.CACHE_FILE_PATH)) {
        const stats = fs.statSync(puzzleGenerator.CACHE_FILE_PATH);
        cacheFileInfo = {
          exists: true,
          size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
          lastModified: stats.mtime
        };
      }
    } catch (error) {
      console.error('Error checking cache file:', error);
    }
    
    res.json({
      uniqueWords: cacheSize,
      hintCacheSize,
      apiCallsToday: apiLimits.dailyCount,
      apiDailyLimit: apiLimits.dailyLimit,
      hitRate: wordHitRate + '%',
      hintHitRate: hintHitRate + '%',
      apiCallsSaved: totalCacheSavings,
      cacheFile: cacheFileInfo,
      lastSaved: cacheStats.lastSaved,
      currentGame: {
        startWord: dailyGame.startWord,
        targetWord: dailyGame.targetWord,
        theme: dailyGame.theme,
        gameDate: dailyGame.gameDate,
        nextGameTime: nextGameTime,
        gamesGenerated: apiLimits.gamesGenerated
      }
    });
  } catch (error) {
    console.error('Error getting cache stats:', error);
    res.status(500).json({ error: 'Failed to get cache stats' });
  }
});

// Get the current game
app.get('/api/game', (req, res) => {
  try {
    // Check if game is initialized
    if (!dailyGame || !dailyGame.startWord || !dailyGame.targetWord) {
      // Status code 503 - Service Unavailable
      return res.status(503).json({ 
        error: 'Game not ready', 
        message: 'The game is being initialized. Please try again in a few moments.'
      });
    }
    
    // Rate limiting
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Initialize rate counter for this IP if not exists
    if (!apiLimits.userRateLimit[clientIP]) {
      apiLimits.userRateLimit[clientIP] = {
        count: 0,
        lastReset: new Date()
      };
    }
    
    // Check if we should reset the counter based on hour
    const now = new Date();
    const lastResetHour = new Date(apiLimits.userRateLimit[clientIP].lastReset).getHours();
    const currentHour = now.getHours();
    
    if (currentHour !== lastResetHour) {
      apiLimits.userRateLimit[clientIP] = {
        count: 0,
        lastReset: now
      };
    }
    
    // Increment counter
    apiLimits.userRateLimit[clientIP].count++;
    
    // Check against limit
    if (apiLimits.userRateLimit[clientIP].count > apiLimits.ipThrottling) {
      return res.status(429).json({ 
        error: 'Too many requests', 
        message: 'You have made too many requests. Please try again later.'
      });
    }
    
    // Return only the necessary game data to the client
    // NOT including the solution!
    res.json({
      startWord: dailyGame.startWord,
      targetWord: dailyGame.targetWord,
      theme: dailyGame.theme,
      description: dailyGame.description,
      difficulty: dailyGame.difficulty,
      gameDate: dailyGame.gameDate,
      nextGameTime: nextGameTime,
      // NO SOLUTION SENT TO CLIENT
    });
  } catch (error) {
    console.error('Error getting game:', error);
    res.status(500).json({ error: 'Failed to get game' });
  }
});

// Get word associations
app.get('/api/associations/:word', async (req, res) => {
  try {
    // If no game generated yet, return error
    if (!dailyGame || !dailyGame.startWord) {
      // Status code 503 - Service Unavailable
      return res.status(503).json({ 
        error: 'Game not ready', 
        message: 'The game is being initialized. Please try again in a few moments.'
      });
    }
    
    const { word } = req.params;
    const wantDetailed = req.query.detailed === 'true';
    
    // Validate input
    if (!word || typeof word !== 'string' || word.length < 1) {
      return res.status(400).json({ error: 'Invalid word parameter' });
    }
    
    // Get associations 
    const associations = await getAssociations(word);
    
    // Check if we should include detailed information
    let detailed = null;
    if (wantDetailed) {
      // Check if detailed info exists in cache
      const detailedKey = `${word.toLowerCase().trim()}_detailed`;
      if (associationCache[detailedKey]) {
        detailed = associationCache[detailedKey];
      }
    }
    
    // Return the associations
    res.json({
      word,
      associations,
      detailed: detailed
    });
  } catch (error) {
    console.error('Error getting associations:', error);
    res.status(500).json({ error: 'Failed to get associations' });
  }
});

// Submit a solution for verification
app.post('/api/verify', (req, res) => {
  try {
    const { path } = req.body;
    
    // Validate the input
    if (!path || !Array.isArray(path) || path.length < 2) {
      return res.status(400).json({ error: 'Invalid path submitted' });
    }
    
    // Verify path starts with the correct start word and ends with the target
    if (path[0].toLowerCase() !== dailyGame.startWord.toLowerCase()) {
      return res.status(400).json({ error: 'Path must start with the start word' });
    }
    
    if (path[path.length - 1].toLowerCase() !== dailyGame.targetWord.toLowerCase()) {
      return res.status(400).json({ error: 'Path must end with the target word' });
    }
    
    // TODO: Full path validation by checking each association step
    // For now we just look at the start and end
    
    // Update stats
    dailyGame.stats.totalPlays++;
    dailyGame.stats.completions.push(path.length - 1); // Number of steps (not including start)
    
    // Calculate average
    const sum = dailyGame.stats.completions.reduce((a, b) => a + b, 0);
    dailyGame.stats.averageSteps = (sum / dailyGame.stats.completions.length).toFixed(1);
    
    // Success response with any badges/achievements
    res.json({
      success: true,
      path,
      stats: {
        stepsUsed: path.length - 1,
        averageSteps: dailyGame.stats.averageSteps,
        optimalPath: dailyGame.hiddenSolution
      }
    });
  } catch (error) {
    console.error('Error verifying solution:', error);
    res.status(500).json({ error: 'Failed to verify solution' });
  }
});

// Get a hint
app.get('/api/hint/:currentWord', async (req, res) => {
  try {
    // If no game generated yet, return error
    if (!dailyGame || !dailyGame.startWord) {
      return res.status(503).json({ 
        error: 'Game not ready', 
        message: 'The game is being initialized. Please try again in a few moments.'
      });
    }
    
    const { currentWord } = req.params;
    
    // Validate input
    if (!currentWord || typeof currentWord !== 'string' || currentWord.length < 1) {
      return res.status(400).json({ error: 'Invalid word parameter' });
    }
    
    // Get hint
    const hint = await getHintFromAI(dailyGame.startWord, dailyGame.targetWord, currentWord);
    
    // Return the hint
    res.json({
      hint
    });
  } catch (error) {
    console.error('Error getting hint:', error);
    res.status(500).json({ error: 'Failed to get hint' });
  }
});

// Admin endpoints for testing/managing
app.post('/api/admin/new-game', async (req, res) => {
  try {
    // Check for admin auth in production
    if (process.env.NODE_ENV === 'production') {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    // Generate new game
    await generatePuzzle();
    
    // Return success
    res.json({
      success: true,
      game: {
        startWord: dailyGame.startWord,
        targetWord: dailyGame.targetWord,
        theme: dailyGame.theme,
        gameDate: dailyGame.gameDate,
        nextGameTime: nextGameTime
      }
    });
  } catch (error) {
    console.error('Error generating new game:', error);
    res.status(500).json({ error: 'Failed to generate new game' });
  }
});

// Admin endpoints for cache management
app.post('/api/admin/clear-cache', async (req, res) => {
  try {
    // Check for admin auth in production
    if (process.env.NODE_ENV === 'production') {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    // Clear caches
    associationCache = {};
    hintCache = {};
    
    // Reset stats
    cacheStats.hits = 0;
    cacheStats.misses = 0;
    cacheStats.hintHits = 0;
    cacheStats.hintMisses = 0;
    cacheStats.lastCleared = new Date();
    
    // Return success
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// Save the association cache manually (admin only)
app.post('/api/admin/save-cache', async (req, res) => {
  try {
    // Check for admin auth in production
    if (process.env.NODE_ENV === 'production') {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    // Save cache
    await puzzleGenerator.saveAssociationCache(associationCache);
    
    // Return success
    res.json({
      success: true,
      message: 'Cache saved successfully',
      size: Object.keys(associationCache).length
    });
  } catch (error) {
    console.error('Error saving cache:', error);
    res.status(500).json({ error: 'Failed to save cache' });
  }
});

// List saved puzzles (admin only)
app.get('/api/admin/puzzles', async (req, res) => {
  try {
    // Check for admin auth in production
    if (process.env.NODE_ENV === 'production') {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    // Get list of saved puzzles
    const puzzles = await puzzleRepository.listPuzzles();
    
    // Return the list
    res.json({
      count: puzzles.length,
      puzzles
    });
  } catch (error) {
    console.error('Error listing puzzles:', error);
    res.status(500).json({ error: 'Failed to list puzzles' });
  }
});

// Force use of a saved puzzle (admin only)
app.post('/api/admin/use-saved-puzzle', async (req, res) => {
  try {
    // Check for admin auth in production
    if (process.env.NODE_ENV === 'production') {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    // Generate new game using the repository
    await generatePuzzle(true);
    
    // Return success with the new game
    res.json({
      success: true,
      message: 'Loaded puzzle from repository',
      game: {
        startWord: dailyGame.startWord,
        targetWord: dailyGame.targetWord,
        theme: dailyGame.theme,
        gameDate: dailyGame.gameDate,
        nextGameTime: nextGameTime
      }
    });
  } catch (error) {
    console.error('Error loading saved puzzle:', error);
    res.status(500).json({ error: 'Failed to load saved puzzle' });
  }
});

// Serve React app for any other route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client/build/index.html'));
});

// On server start - initialize
if (process.env.NODE_ENV !== 'test') {
  // Load the association cache first
  puzzleGenerator.loadAssociationCache()
    .then(loadedCache => {
      // Store the loaded cache
      associationCache = loadedCache;
      console.log(`Cache loaded with ${Object.keys(associationCache).length} entries`);
      
      // Then generate the initial game
      return generatePuzzle();
    })
    .then(() => console.log('Initial game generated on server start'))
    .catch(err => {
      console.error('Failed to generate initial game:', err);
      
      // Try to use a saved puzzle as fallback
      console.log('Attempting to use saved puzzle as fallback...');
      return puzzleRepository.getFallbackPuzzle()
        .then(fallbackPuzzle => {
          if (fallbackPuzzle) {
            console.log(`Using fallback puzzle: ${fallbackPuzzle.startWord} → ${fallbackPuzzle.targetWord}`);
            
            // Update game date to today
            const today = new Date().toISOString().split('T')[0];
            
            // Update the daily game state with default stats
            dailyGame = {
              ...fallbackPuzzle,
              gameDate: today,
              stats: {
                totalPlays: 0,
                completions: [],
                averageSteps: 0,
                backSteps: [],
                averageBackSteps: 0,
                totalSteps: [],
                averageTotalSteps: 0
              }
            };
            
            console.log('Fallback puzzle loaded successfully');
          } else {
            console.error('No fallback puzzles available. Game will be unavailable until generation succeeds.');
          }
        })
        .catch(fallbackErr => {
          console.error('Error loading fallback puzzle:', fallbackErr);
        });
    });
  
  // Set up periodic cache saving (every 5 minutes)
  const CACHE_SAVE_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds
  setInterval(() => {
    puzzleGenerator.saveAssociationCache(associationCache)
      .then(saved => {
        if (saved) {
          console.log(`Cache automatically saved. Current size: ${Object.keys(associationCache).length} entries`);
          cacheStats.lastSaved = new Date();
        }
      })
      .catch(err => console.error('Failed to auto-save cache:', err));
  }, CACHE_SAVE_INTERVAL);
  
  // Schedule game generation (with limits)
  setInterval(async () => {
    try {
      // Get current date to check if we need to reset counters
      const now = new Date();
      const currentDate = now.toISOString().split('T')[0]; // Get YYYY-MM-DD format
      
      // Reset game generation counter if it's a new day
      if (dailyGame.gameDate !== currentDate) {
        console.log(`New day detected, resetting game generation counter`);
        apiLimits.gamesGenerated = 0;
        dailyGame.gameDate = currentDate;
      }
      
      // Override the game limit check to ensure we get at least a few new games per day
      // to fix the issue of having the same words repeatedly
      const hourOfDay = now.getHours();
      
      // Always generate a new game at specific hours regardless of counter
      const forceRefreshHours = [0, 6, 12, 18]; // Midnight, 6am, noon, 6pm
      const shouldForceRefresh = forceRefreshHours.includes(hourOfDay);
      
      // Use repository hours - hours when we prefer to use saved puzzles to save API calls
      const useRepositoryHours = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23];
      const shouldUseRepository = useRepositoryHours.includes(hourOfDay);
      
      if (shouldForceRefresh || apiLimits.gamesGenerated < apiLimits.gameGenerationPerDay) {
        console.log("Generating new game...");
        
        // If it's a force refresh hour, always generate a new puzzle
        // Otherwise use repository on repository hours (to save API calls), and generate new puzzles on other hours
        const useRepo = !shouldForceRefresh && shouldUseRepository;
        
        await generatePuzzle(useRepo);
        apiLimits.gamesGenerated++;
        console.log(`New game ${useRepo ? 'loaded from repository' : 'generated'} by scheduler (${apiLimits.gamesGenerated}/${apiLimits.gameGenerationPerDay} today)`);
      } else {
        console.log(`Game generation skipped - daily limit of ${apiLimits.gameGenerationPerDay} reached`);
      }
    } catch (error) {
      console.error('Scheduler failed to generate game:', error);
      // No fallback - if game generation fails, we won't have a game
      console.log('No game available until next successful generation attempt');
    }
  }, 3600000); // Check every hour (3,600,000 ms)
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Export app for testing
module.exports = { app, generatePuzzle };