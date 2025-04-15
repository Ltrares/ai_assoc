// Only load .env file in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5050;

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Game state
let dailyGame = {
  startWord: 'apple',
  targetWord: 'computer',
  associationGraph: {},
  gameDate: new Date().toISOString().split('T')[0],
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
nextGameTime.setSeconds(0);
nextGameTime.setMilliseconds(0);

// Function to generate a new game
async function generateDailyGame() {
  // Set next game time to the next hour
  nextGameTime = new Date();
  nextGameTime.setHours(nextGameTime.getHours() + 1);
  nextGameTime.setMinutes(0);
  nextGameTime.setSeconds(0);
  nextGameTime.setMilliseconds(0);
  try {
    // Generate a pair of related but not directly connected words with a theme
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 300, // Reduced token limit for cost optimization
      messages: [
        {
          role: "user",
          content: `Generate a pair of words for a challenging but solvable word association puzzle game.
          Choose words from one of these categories: pop culture, movies, music, video games, sports, internet culture, food, fashion, modern technology, social media, travel, geography, or science concepts.
          
          VERY IMPORTANT: The words MUST require at least 4 and ideally 5 steps of COMMONLY RECOGNIZED and INTUITIVE associations to connect.
          The words MUST NOT be directly connected or have obvious single-step relationships.
          
          For example, "apple" and "computer" would be a poor choice because they're directly connected through Apple Inc.
          A better example would be "candle" to "library" (connecting through: candle → light → bulb → electricity → computer → book → library).
          
          KEY REQUIREMENTS:
          1. Each step in the path must be a COMMON and INTUITIVE association that most people would recognize
          2. No obscure, technical, or highly specialized knowledge should be needed
          3. Each word must have clear, unambiguous associations to the next word
          4. Avoid associations that only make sense in specific cultural contexts
          5. The path should feel satisfying and logical when discovered
          
          Return ONLY a JSON object with format: 
          {
            "startWord": "word1", 
            "targetWord": "word2",
            "theme": "brief theme description",
            "difficulty": "medium|hard|expert",
            "possiblePath": ["word1", "intermediate1", "intermediate2", "intermediate3", "word2"]
          }
          
          Include a possible path between words to verify the difficulty, but this will not be shown to users.
          Both words should be recognizable to most adults.`
        }
      ]
    });

    // Parse the response to get the word pair and metadata
    const responseText = message.content[0].text;
    const wordPair = JSON.parse(responseText);
    
    // Verify the path length is at least 4 steps (5 words including start and end)
    if (wordPair.possiblePath && wordPair.possiblePath.length < 5) {
      console.log("Generated path too short, retrying...");
      return generateDailyGame(); // Retry if path is too short
    }
    
    // Update the game state with new words and theme info
    dailyGame = {
      startWord: wordPair.startWord,
      targetWord: wordPair.targetWord,
      theme: wordPair.theme,
      difficulty: wordPair.difficulty,
      hiddenSolution: wordPair.possiblePath || [], // Store the possible path but don't expose to clients
      minExpectedSteps: wordPair.possiblePath ? wordPair.possiblePath.length - 1 : 3, // Calculate minimum steps expected
      associationGraph: {},
      gameDate: new Date().toISOString().split('T')[0],
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
    
    console.log(`New daily game generated: ${dailyGame.startWord} → ${dailyGame.targetWord} (${dailyGame.theme}, ${dailyGame.difficulty})`);
    console.log(`Minimum expected steps: ${dailyGame.minExpectedSteps}`);
    if (dailyGame.hiddenSolution && dailyGame.hiddenSolution.length > 0) {
      console.log(`Possible solution path: ${dailyGame.hiddenSolution.join(' → ')}`);
    }
    
    // Pre-cache all words in the solution path to reduce AI calls during gameplay
    console.log(`Pre-caching associations for all solution path words...`);
    
    // Always pre-cache start and target words
    await getAssociations(dailyGame.startWord);
    await getAssociations(dailyGame.targetWord);
    
    // If we have a solution path, pre-cache all intermediate steps too
    if (dailyGame.hiddenSolution && dailyGame.hiddenSolution.length > 2) {
      // Skip first and last as we've already cached them
      for (let i = 1; i < dailyGame.hiddenSolution.length - 1; i++) {
        const word = dailyGame.hiddenSolution[i];
        console.log(`Pre-caching associations for solution step: ${word}`);
        await getAssociations(word);
      }
    }
    
    console.log(`Pre-caching complete. Cache now contains ${Object.keys(associationCache).length} entries.`);
    
    return dailyGame;
  } catch (error) {
    console.error('Error generating daily game:', error);
    // Fallback to default game if AI fails
    return dailyGame;
  }
};

// Configure CORS properly for development
if (process.env.NODE_ENV === 'development') {
  app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
} else {
  app.use(cors());
}

// Other middleware
app.use(express.json());

// Middleware to track and limit API usage
app.use((req, res, next) => {
  // Reset daily counters if it's a new day
  const now = new Date();
  if (now.getDate() !== apiLimits.lastReset.getDate() || 
      now.getMonth() !== apiLimits.lastReset.getMonth() || 
      now.getFullYear() !== apiLimits.lastReset.getFullYear()) {
    apiLimits.dailyCount = 0;
    apiLimits.gamesGenerated = 0;
    apiLimits.lastReset = now;
    apiLimits.userRateLimit = {}; // Reset user rate limits
    console.log('Daily API limits reset');
  }
  
  // Get client IP
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  // Initialize rate limit tracking for this IP if needed
  if (!apiLimits.userRateLimit[clientIp]) {
    apiLimits.userRateLimit[clientIp] = {
      count: 0,
      lastRequest: new Date(),
      hourlyReset: new Date()
    };
  }
  
  // Reset hourly count if it's been more than an hour
  if ((now - apiLimits.userRateLimit[clientIp].hourlyReset) > 3600000) { // 1 hour in ms
    apiLimits.userRateLimit[clientIp].count = 0;
    apiLimits.userRateLimit[clientIp].hourlyReset = now;
  }
  
  // Increment counters for this request
  apiLimits.userRateLimit[clientIp].count++;
  apiLimits.userRateLimit[clientIp].lastRequest = now;
  
  // Check if we're over the per-IP rate limit
  if (apiLimits.userRateLimit[clientIp].count > apiLimits.ipThrottling) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded', 
      message: 'Too many requests from your IP address. Please try again later.'
    });
  }
  
  // Check if we're over the daily API limit
  if (req.path.includes('/api/') && apiLimits.dailyCount >= apiLimits.dailyLimit) {
    return res.status(429).json({ 
      error: 'API daily limit reached', 
      message: 'The game has reached its daily usage limit. Please try again tomorrow.'
    });
  }
  
  // For metrics: increment the API call counter if this is an API call
  if (req.path.includes('/api/')) {
    apiLimits.dailyCount++;
  }
  
  next();
});

// Add CORS pre-flight
app.options('*', cors());

// MongoDB connection (uncomment to use database)
// mongoose.connect('mongodb://localhost:27017/ai_association', {
//   useNewUrlParser: true,
//   useUnifiedTopology: true
// })
//   .then(() => console.log('MongoDB Connected'))
//   .catch(err => console.log(err));

// Optional: Define Game Schema if using MongoDB
// const GameSchema = new mongoose.Schema({
//   startWord: String,
//   targetWord: String,
//   associationGraph: Object,
//   gameDate: String,
//   stats: {
//     totalPlays: Number,
//     completions: [Number],
//     averageSteps: Number
//   }
// });
// const Game = mongoose.model('Game', GameSchema);

// Cache for word associations to minimize API calls
// This cache will persist throughout the server's lifetime
const associationCache = {
  'apple': ['fruit', 'computer', 'red', 'phone', 'pie'],
  'fruit': ['apple', 'banana', 'sweet', 'juice', 'healthy'],
  'red': ['color', 'apple', 'blood', 'rose', 'stop'],
  'computer': ['technology', 'screen', 'apple', 'code', 'internet'],
  'phone': ['call', 'mobile', 'apple', 'communication', 'screen'],
  'technology': ['computer', 'innovation', 'science', 'digital', 'future'],
  'screen': ['display', 'phone', 'computer', 'movie', 'touch']
};

// API usage limits
const apiLimits = {
  dailyLimit: parseInt(process.env.DAILY_API_LIMIT || 1000),
  dailyCount: 0,
  lastReset: new Date(),
  userRateLimit: {}, // Track per IP for rate limiting
  ipThrottling: parseInt(process.env.IP_RATE_LIMIT || 30), // Requests per IP per hour
  gameGenerationPerDay: parseInt(process.env.GAMES_PER_DAY || 24), // How many new games to generate per day
  gamesGenerated: 0
};

// Track cache hits and misses for monitoring
const cacheStats = {
  hits: 0,
  misses: 0,
  lastCleared: new Date(),
  hintHits: 0,
  hintMisses: 0
};

// Cache for hint responses to avoid repeated API calls
const hintCache = {}; // Format: 'startWord-targetWord-currentWord': 'hint'

// Generate word associations using Claude
async function getAssociationsFromAI(word) {
  try {
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 250, // Reduced token limit for cost optimization
      messages: [
        {
          role: "user",
          content: `Generate 6-9 commonly associated words for "${word}" for a word association puzzle.
          Focus primarily on these types of intuitive connections:
          1. Semantic (direct meaning-related)
          2. Common categorical relationships
          3. Widely recognized cultural associations
          4. Familiar metaphorical connections
          5. Part-whole relationships
          6. Commonly paired concepts
          
          IMPORTANT: Associations must be INTUITIVE and COMMONLY RECOGNIZED by most adults.
          Prioritize associations that most people would naturally think of when hearing the word "${word}".
          
          Avoid overly technical, obscure, or specialized associations that require specific expertise.
          
          Return ONLY a JSON array with this format:
          [
            {"word": "association1", "type": "connection type", "hint": "brief explanation of this common association"},
            {"word": "association2", "type": "connection type", "hint": "brief explanation of this common association"},
            ...etc
          ]
          
          Ensure a mix of immediate associations and slightly less obvious (but still common) associations.
          For example, for "beach" good associations might include "sand", "ocean", "sun", "vacation", "waves", etc.`
        }
      ]
    });

    // Parse the response to get an array of word association objects
    const responseText = message.content[0].text;
    const associationsArray = JSON.parse(responseText);
    
    // Extract just the words for backward compatibility with the rest of the code
    const wordOnlyArray = associationsArray.map(item => item.word);
    
    // Normalize the word for consistent caching
    const normalizedWord = word.toLowerCase().trim();
    
    // Store both simplified and detailed versions in cache
    associationCache[normalizedWord] = wordOnlyArray;
    associationCache[`${normalizedWord}_detailed`] = associationsArray;
    
    return wordOnlyArray;
  } catch (error) {
    console.error('Error getting AI associations:', error);
    return associationCache[word.toLowerCase().trim()] || ['error'];
  }
}

// Get associations with cache fallback and API limiting
async function getAssociations(word) {
  // Normalize the word (lowercase and trim)
  const normalizedWord = word.toLowerCase().trim();
  
  // Check if any case variation of the word exists in the cache
  const cacheKey = Object.keys(associationCache).find(key => 
    key.toLowerCase().trim() === normalizedWord
  );
  
  // If word is in cache (with any case), return cached result
  if (cacheKey) {
    cacheStats.hits++;
    console.log(`Cache HIT for '${normalizedWord}' (${cacheStats.hits} hits, ${cacheStats.misses} misses)`);
    return associationCache[cacheKey];
  }
  
  // API limit check - fallback to simple response if over daily limit
  if (apiLimits.dailyCount >= apiLimits.dailyLimit) {
    console.warn(`API daily limit reached (${apiLimits.dailyCount}/${apiLimits.dailyLimit}) - using fallback response`);
    
    // For common words, provide basic associations without API call
    const commonWords = {
      'cat': ['pet', 'animal', 'dog', 'fur', 'meow'],
      'dog': ['pet', 'animal', 'cat', 'bark', 'loyal'],
      'book': ['read', 'page', 'story', 'author', 'library'],
      'tree': ['plant', 'forest', 'leaf', 'nature', 'wood'],
      'car': ['vehicle', 'drive', 'road', 'wheel', 'transportation']
  
    };
    
    if (commonWords[normalizedWord]) {
      // Cache this result too
      associationCache[normalizedWord] = commonWords[normalizedWord];
      return commonWords[normalizedWord];
    }
    
    // For words we don't have pre-defined, return a generic set
    return ['common', 'related', 'similar', 'connected', 'associated'];
  }
  
  // Otherwise, get from AI and cache the result
  try {
    cacheStats.misses++;
    console.log(`Cache MISS for '${normalizedWord}' (${cacheStats.hits} hits, ${cacheStats.misses} misses)`);
    
    // Check if we already have associations for the target word
    // If so, we can sometimes add bidirectional associations to improve cache efficiency
    if (dailyGame.targetWord && normalizedWord !== dailyGame.targetWord.toLowerCase().trim()) {
      const targetKey = Object.keys(associationCache).find(key => 
        key.toLowerCase().trim() === dailyGame.targetWord.toLowerCase().trim()
      );
      
      if (targetKey && associationCache[targetKey].some(w => w.toLowerCase().trim() === normalizedWord)) {
        // If the target word has this word as an association, we could potentially
        // pre-cache the reverse association to help guide players
        console.log(`Adding bidirectional association from '${normalizedWord}' to '${dailyGame.targetWord}'`);
      }
    }
    
    // Increment API usage count
    apiLimits.dailyCount++;
    console.log(`API call made for '${normalizedWord}' (${apiLimits.dailyCount}/${apiLimits.dailyLimit} today)`);
    
    return await getAssociationsFromAI(normalizedWord);
  } catch (error) {
    console.error('Error in getAssociations:', error);
    return ['not found'];
  }
}

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
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
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
    
    res.json({
      wordAssociations: {
        cacheSize,
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        hitRate: `${wordHitRate}%`,
        activeWords: Object.keys(associationCache).filter(key => !key.includes('_detailed'))
      },
      hints: {
        cacheSize: hintCacheSize,
        hits: cacheStats.hintHits,
        misses: cacheStats.hintMisses,
        hitRate: `${hintHitRate}%`,
      },
      overall: {
        totalCacheSavings,
        lastCleared: cacheStats.lastCleared
      }
    });
  } catch (error) {
    console.error('Error in cache-stats endpoint:', error);
    res.status(500).json({ error: 'Failed to get cache stats', message: error.message });
  }
});

// Get API usage stats (for monitoring)
app.get('/api/admin/api-stats', (req, res) => {
  try {
    // Check for admin auth in production
    if (process.env.NODE_ENV === 'production') {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    // Calculate usage percentage
    const usagePercentage = (apiLimits.dailyCount / apiLimits.dailyLimit * 100).toFixed(2);
    
    // Count active unique IPs
    const uniqueIPs = Object.keys(apiLimits.userRateLimit).length;
    
    // Find most active IP
    let mostActiveIP = null;
    let highestCount = 0;
    
    Object.entries(apiLimits.userRateLimit).forEach(([ip, data]) => {
      if (data.count > highestCount) {
        highestCount = data.count;
        mostActiveIP = ip;
      }
    });
    
    res.json({
      dailyApiCalls: apiLimits.dailyCount,
      dailyLimit: apiLimits.dailyLimit,
      usagePercentage: `${usagePercentage}%`,
      resetTime: apiLimits.lastReset,
      nextResetTime: (() => {
        const nextReset = new Date(apiLimits.lastReset);
        nextReset.setDate(nextReset.getDate() + 1);
        return nextReset;
      })(),
      uniqueIPs,
      topUser: mostActiveIP ? {
        ip: mostActiveIP.replace(/\d+$/, 'xxx'), // Redact last part of IP for privacy
        requests: highestCount
      } : null,
      gamesGenerated: apiLimits.gamesGenerated,
      gameGenerationLimit: apiLimits.gameGenerationPerDay
    });
  } catch (error) {
    console.error('Error in api-stats endpoint:', error);
    res.status(500).json({ error: 'Failed to get API stats', message: error.message });
  }
});

// Get current game
app.get('/api/game', (req, res) => {
  // Include minExpectedSteps to give players a clue about puzzle complexity
  // Also include next refresh time
  res.json({
    gameDate: dailyGame.gameDate,
    startWord: dailyGame.startWord,
    targetWord: dailyGame.targetWord,
    theme: dailyGame.theme,
    difficulty: dailyGame.difficulty,
    minExpectedSteps: dailyGame.minExpectedSteps,
    stats: dailyGame.stats,
    nextRefreshTime: nextGameTime.toISOString()
  });
});

// Get word associations
app.get('/api/associations/:word', async (req, res) => {
  try {
    const word = req.params.word.toLowerCase().trim();
    const detailed = req.query.detailed === 'true';
    
    // Get the basic associations
    const associations = await getAssociations(word);
    
    // Check for detailed associations with case-insensitive matching
    if (detailed) {
      const detailedKey = Object.keys(associationCache).find(key => 
        key.toLowerCase().trim() === `${word.toLowerCase().trim()}_detailed`
      );
      
      if (detailedKey) {
        // Return detailed information if available
        return res.json({ 
          word, 
          associations,
          detailed: associationCache[detailedKey]
        });
      }
    }
    
    res.json({ word, associations });
  } catch (error) {
    console.error('Error in associations endpoint:', error);
    res.status(500).json({ error: 'Failed to get associations', message: error.message });
  }
});

// Submit a completed game
app.post('/api/game/complete', (req, res) => {
  const { steps, backSteps = 0, totalSteps = steps } = req.body;
  
  if (!steps || typeof steps !== 'number') {
    return res.status(400).json({ error: 'Steps must be a number' });
  }
  
  // Update game stats
  dailyGame.stats.totalPlays++;
  
  // Track all types of steps
  dailyGame.stats.completions.push(steps);
  dailyGame.stats.backSteps.push(backSteps);
  dailyGame.stats.totalSteps.push(totalSteps);
  
  // Calculate averages
  const sumSteps = dailyGame.stats.completions.reduce((a, b) => a + b, 0);
  dailyGame.stats.averageSteps = sumSteps / dailyGame.stats.completions.length;
  
  const sumBackSteps = dailyGame.stats.backSteps.reduce((a, b) => a + b, 0);
  dailyGame.stats.averageBackSteps = sumBackSteps / dailyGame.stats.backSteps.length;
  
  const sumTotalSteps = dailyGame.stats.totalSteps.reduce((a, b) => a + b, 0);
  dailyGame.stats.averageTotalSteps = sumTotalSteps / dailyGame.stats.totalSteps.length;
  
  // If using MongoDB, save stats here
  
  res.json({ message: 'Game completed', stats: dailyGame.stats });
});

// Get a hint for the current game
app.get('/api/game/hint', async (req, res) => {
  try {
    const { progress } = req.query;
    const currentPath = progress ? JSON.parse(progress) : [dailyGame.startWord];
    const currentWord = currentPath[currentPath.length - 1];
    
    // Check API usage limits before proceeding
    if (apiLimits.dailyCount >= apiLimits.dailyLimit) {
      console.warn(`Hint request denied due to API limit (${apiLimits.dailyCount}/${apiLimits.dailyLimit})`);
      return res.json({ 
        hint: "Look for common associations between words. Try a different path if you're stuck.",
        limited: true
      });
    }
    
    // Create a cache key based on the game and current position
    const cacheKey = `${dailyGame.startWord}-${dailyGame.targetWord}-${currentWord}`;
    
    // Check if we have this hint cached
    if (hintCache[cacheKey]) {
      cacheStats.hintHits++;
      console.log(`Hint cache HIT for ${cacheKey} (${cacheStats.hintHits} hits, ${cacheStats.hintMisses} misses)`);
      return res.json({ 
        hint: hintCache[cacheKey],
        cached: true
      });
    }
    
    cacheStats.hintMisses++;
    console.log(`Hint cache MISS for ${cacheKey} (${cacheStats.hintHits} hits, ${cacheStats.hintMisses} misses)`);
    
    // Determine how far the player is along the path
    const isStartingOut = currentPath.length === 1;
    const isClose = dailyGame.hiddenSolution && dailyGame.hiddenSolution.includes(currentWord) && 
                   dailyGame.hiddenSolution.indexOf(currentWord) >= dailyGame.hiddenSolution.length - 2;
    
    // Get context from our hidden solution if available
    let solutionContext = '';
    if (dailyGame.hiddenSolution && dailyGame.hiddenSolution.length > 0) {
      const currentIndex = dailyGame.hiddenSolution.indexOf(currentWord);
      if (currentIndex !== -1 && currentIndex < dailyGame.hiddenSolution.length - 1) {
        // We found their position in our solution path
        const nextStepInSolution = dailyGame.hiddenSolution[currentIndex + 1];
        solutionContext = `One possible next step from here could be "${nextStepInSolution}", but don't reveal this directly.`;
      }
    }
    
    // Increment API usage count
    apiLimits.dailyCount++;
    console.log(`API call for hint (${apiLimits.dailyCount}/${apiLimits.dailyLimit} today)`);
    
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 150, // Reduced token limit for cost optimization - hints are short
      messages: [
        {
          role: "user",
          content: `In a word association puzzle, the player is trying to go from "${dailyGame.startWord}" to "${dailyGame.targetWord}".
          Their current path is: ${currentPath.join(' → ')}.
          
          The puzzle theme is: ${dailyGame.theme}
          The difficulty is: ${dailyGame.difficulty}
          The minimum expected steps is: ${dailyGame.minExpectedSteps}
          
          ${solutionContext}
          
          ${isStartingOut ? 'The player is just starting, so help them understand the multi-step nature of the puzzle.' : ''}
          ${isClose ? 'The player seems close to the target word. Give them an encouraging hint without giving away the final connection.' : ''}
          
          Without giving away the direct solution, provide a subtle hint that helps them move forward.
          The hint should:
          1. Be enigmatic but helpful
          2. Not reveal the exact next word
          3. Suggest a thinking direction or pattern
          4. Encourage multi-step thinking (this puzzle requires at least ${dailyGame.minExpectedSteps} steps)
          5. Be 1-2 short sentences maximum
          
          Return ONLY the hint with no additional explanation or formatting.`
        }
      ]
    });

    const hint = message.content[0].text.trim();
    
    // Cache the hint for future requests
    hintCache[cacheKey] = hint;
    
    res.json({ hint });
  } catch (error) {
    console.error('Error generating hint:', error);
    res.status(500).json({ error: 'Failed to generate hint', message: error.message });
  }
});

// Admin route to get the hidden solution (for testing and verification)
app.get('/api/admin/solution', (req, res) => {
  try {
    // Check for admin auth (in a real app, use proper auth)
    if (process.env.NODE_ENV === 'production') {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    // Return the hidden solution and min steps
    res.json({ 
      solution: dailyGame.hiddenSolution,
      minSteps: dailyGame.minExpectedSteps,
      startWord: dailyGame.startWord,
      targetWord: dailyGame.targetWord,
      theme: dailyGame.theme,
      difficulty: dailyGame.difficulty
    });
  } catch (error) {
    console.error('Error in solution endpoint:', error);
    res.status(500).json({ error: 'Failed to get solution', message: error.message });
  }
});

// Add route to generate a new game (admin use)
app.post('/api/admin/generate-game', async (req, res) => {
  try {
    // Check for admin auth (in a real app, use proper auth)
    if (process.env.NODE_ENV === 'production') {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    
    const game = await generateDailyGame();
    
    // Clean up sensitive solution data before returning
    const cleanGame = { ...game };
    delete cleanGame.hiddenSolution;
    
    res.json({ message: 'New game generated', game: cleanGame });
  } catch (error) {
    console.error('Error in generate-game endpoint:', error);
    res.status(500).json({ error: 'Failed to generate game', message: error.message });
  }
});

// Generate a new game hourly or on server start
if (process.env.NODE_ENV !== 'test') {
  // Always generate a new game on server start to avoid default apple/computer
  generateDailyGame()
    .then(() => console.log('Initial game generated on server start'))
    .catch(err => console.error('Failed to generate initial game:', err));
  
  // Schedule game generation (with limits)
  setInterval(async () => {
    try {
      // Check if we've already generated the maximum number of games for today
      if (apiLimits.gamesGenerated < apiLimits.gameGenerationPerDay) {
        await generateDailyGame();
        apiLimits.gamesGenerated++;
        console.log(`New game generated by scheduler (${apiLimits.gamesGenerated}/${apiLimits.gameGenerationPerDay} today)`);
      } else {
        console.log(`Game generation skipped - daily limit of ${apiLimits.gameGenerationPerDay} reached`);
      }
    } catch (error) {
      console.error('Scheduler failed to generate game:', error);
    }
  }, 3600000); // Check every hour (3,600,000 ms)
}

// Serve static assets in production
if (process.env.NODE_ENV === 'production') {
  // Set static folder
  app.use(express.static(path.join(__dirname, '../client/build')));

  // Any route that's not an API route should be handled by React
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.resolve(__dirname, '../client/build', 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});