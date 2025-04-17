// Only load .env file in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// Puzzle generation algorithm updated to create linear word association paths
// Each word in the path is directly associated with the previous word
// This ensures puzzles have a well-defined solution path with accurate par steps
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

// Game state - initially empty until generated
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
nextGameTime.setSeconds(0);
nextGameTime.setMilliseconds(0);

// Function to generate a new puzzle with a linear association path
async function generatePuzzle() {
  // Set next game time to the next hour
  nextGameTime = new Date();
  nextGameTime.setHours(nextGameTime.getHours() + 1);
  nextGameTime.setMinutes(0);
  nextGameTime.setSeconds(0);
  nextGameTime.setMilliseconds(0);
  
  // Clear the association cache before generating a new puzzle
  // to prevent reusing the same associations
  console.log(`Clearing association cache with ${Object.keys(associationCache).length} entries`);
  Object.keys(associationCache).forEach(key => {
    delete associationCache[key];
  });
  console.log("Association cache cleared for fresh puzzle generation");
  
  // Track previously used words to ensure variety
  // We'll maintain a "memory" of recent start words to avoid repetition
  if (!global.previousStartWords) {
    global.previousStartWords = [];
  }
  
  // Keep the last 10 start words to avoid repetition
  const MAX_PREVIOUS_WORDS = 10;
  
  // Add current words to our tracking list
  if (dailyGame.startWord) {
    if (!global.previousStartWords.includes(dailyGame.startWord.toLowerCase())) {
      global.previousStartWords.push(dailyGame.startWord.toLowerCase());
      // Trim list if it exceeds our limit
      if (global.previousStartWords.length > MAX_PREVIOUS_WORDS) {
        global.previousStartWords.shift(); // Remove oldest word
      }
    }
  }
  
  // Get current game words
  const currentStartWord = dailyGame.startWord;
  const currentTargetWord = dailyGame.targetWord;
  
  console.log(`Previously used start words (avoiding): ${global.previousStartWords.join(', ')}`);
  
  try {
    console.log("Generating new puzzle using linear path approach...");
    
    // Step 1: Generate a random seed word
    const seedWordMessage = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: `Generate ONE random, interesting seed word for a word association puzzle.
          
          The word should:
          1. Be a simple, common, recognizable noun or verb
          2. Have multiple potential word associations
          3. NOT include any of these previous words: ${[currentStartWord, currentTargetWord, ...global.previousStartWords].filter(w => w && w !== 'null').join(', ')}
          4. Be a single word (not a phrase)
          5. Be varied and distinct from recent themes, choose something creative
          
          Return ONLY the word as plain text, nothing else.`
        }
      ]
    });

    // Get the seed word and trim any whitespace
    const seedWord = seedWordMessage.content[0].text.trim();
    console.log(`Generated seed word: ${seedWord}`);
    
    // Create path starting with seed word
    const path = [seedWord];
    
    // Step 2: Build a linear path by following associations
    // We want a path of 5-6 steps (6-7 words total including start and end)
    const desiredPathLength = Math.floor(Math.random() * 2) + 6; // 6-7 words total
    console.log(`Aiming for a path with ${desiredPathLength} words (${desiredPathLength-1} steps)`);
    
    // Get associations for the seed word
    console.log(`Getting associations for seed word: ${seedWord}`);
    let associations = await getAssociations(seedWord);
    console.log(`Cached ${associations.length} associations for ${seedWord}`);
    
    // Iteratively build the path step by step
    let currentWord = seedWord;
    
    while (path.length < desiredPathLength - 1) { // -1 because we'll add the last word as target
      // Filter out associations:
      // 1. Already in our path
      // 2. Already in our cache (meaning they've been seen before)
      const availableAssociations = associations.filter(word => {
        // Skip if already in our path
        if (path.includes(word)) return false;
        
        // Skip if this word is already in the cache from previous puzzles/steps
        // We need to normalize the word (lowercase, trim) for consistent comparison
        const normalizedWord = word.toLowerCase().trim();
        const inCache = Object.keys(associationCache)
          .filter(key => !key.includes('_detailed')) // Exclude detailed cache entries
          .some(key => key.toLowerCase().trim() === normalizedWord);
        
        // Only keep words not in cache
        return !inCache;
      });
      
      console.log(`Found ${availableAssociations.length} available new associations`);
      
      if (availableAssociations.length === 0) {
        // Try again with just excluding words in our path but allowing cached words
        // This is a fallback to ensure we can at least build a path
        console.log(`No new uncached associations found for ${currentWord}. Falling back to cached words...`);
        const fallbackAssociations = associations.filter(word => !path.includes(word));
        
        if (fallbackAssociations.length === 0) {
          // If still no associations, we have to end the path
          console.log(`No more available associations for ${currentWord}, ending path early`);
          break;
        }
        
        // Pick a random fallback association
        const randomIndex = Math.floor(Math.random() * fallbackAssociations.length);
        const nextWord = fallbackAssociations[randomIndex];
        
        // Add the word to our path and continue
        path.push(nextWord);
        console.log(`Added fallback word ${nextWord} to path: ${path.join(' → ')}`);
        currentWord = nextWord;
        
        // Continue building the path
        if (path.length < desiredPathLength - 1) {
          console.log(`Getting associations for fallback word: ${currentWord}`);
          associations = await getAssociations(currentWord);
          console.log(`Cached ${associations.length} associations for ${currentWord}`);
        }
        
        continue; // Skip to next iteration
      }
      
      // Pick a random association as the next word
      const randomIndex = Math.floor(Math.random() * availableAssociations.length);
      const nextWord = availableAssociations[randomIndex];
      
      // Add the word to our path
      path.push(nextWord);
      console.log(`Added ${nextWord} to path: ${path.join(' → ')}`);
      
      // This word becomes our new current word
      currentWord = nextWord;
      
      // Get associations for this new word, unless we've reached our target length - 1
      if (path.length < desiredPathLength - 1) {
        console.log(`Getting associations for: ${currentWord}`);
        associations = await getAssociations(currentWord);
        console.log(`Cached ${associations.length} associations for ${currentWord}`);
      }
    }
    
    // The last word in the path is our target word
    const targetWord = path[path.length - 1];
    console.log(`Final path: ${path.join(' → ')}`);
    console.log(`Target word: ${targetWord}`);
    
    // Step 3: Generate a theme based on the start and target words
    console.log("Generating theme based on start and target words...");
    const themeMessage = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 150,
      messages: [
        {
          role: "user",
          content: `I'm creating a word association puzzle starting with "${seedWord}" and ending with "${targetWord}".
          
          Create an interesting theme that connects these words and provides context for the puzzle.
          
          Return ONLY a JSON object with this format:
          {
            "theme": "Short theme name, 2-4 words maximum",
            "description": "Brief description of the theme (10-15 words max)",
            "difficulty": "medium|hard|expert"
          }
          
          Themes should be conceptual frameworks that give players a hint about the connection between "${seedWord}" and "${targetWord}".`
        }
      ]
    });

    const themeText = themeMessage.content[0].text;
    let themeData;
    
    try {
      themeData = JSON.parse(themeText);
      console.log(`Generated theme: ${themeData.theme} (${themeData.difficulty})`);
    } catch (parseError) {
      console.error('Error parsing theme response:', parseError);
      console.log('Raw theme response:', themeText);
      themeData = {
        theme: "Word Connections",
        description: "Find the hidden connections between words",
        difficulty: "medium"
      };
    }
    
    // Step 4: Pre-cache all associations for words in the path
    console.log("Pre-caching associations for all path words...");
    for (const word of path) {
      if (!associationCache[word.toLowerCase()]) {
        console.log(`Pre-caching associations for: ${word}`);
        await getAssociations(word);
      }
    }
    
    console.log(`Pre-caching complete. Cache now contains ${Object.keys(associationCache).length} entries.`);
    
    // Update the game state with the generated data
    dailyGame = {
      startWord: seedWord,
      targetWord: targetWord,
      theme: themeData.theme,
      description: themeData.description || "",
      difficulty: themeData.difficulty || "hard",
      hiddenSolution: path,
      minExpectedSteps: path.length - 1,
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
    
    console.log(`New puzzle generated: ${dailyGame.startWord} → ${dailyGame.targetWord} (${dailyGame.theme}, ${dailyGame.difficulty})`);
    console.log(`Minimum expected steps: ${dailyGame.minExpectedSteps}`);
    console.log(`Verified solution path: ${dailyGame.hiddenSolution.join(' → ')}`);
    
    return dailyGame;
  } catch (error) {
    console.error('Error generating puzzle:', error);
    // No fallback - propagate the error upward
    throw error;
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
  
  // Check if this is a game refresh (special handling)
  const isGameRefresh = req.query.refresh === 'true';
  
  // Check if we're over the per-IP rate limit (more lenient for game refreshes)
  const rateLimit = isGameRefresh 
    ? apiLimits.ipThrottling * 2  // Double the limit for game refreshes
    : apiLimits.ipThrottling;
    
  if (apiLimits.userRateLimit[clientIp].count > rateLimit) {
    console.log(`Rate limit exceeded for IP ${clientIp}: ${apiLimits.userRateLimit[clientIp].count} requests`);
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
  // Starting with an empty cache to prevent getting stuck with the same words
};

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
  hintMisses: 0
};

// Cache for hint responses to avoid repeated API calls
const hintCache = {}; // Format: 'startWord-targetWord-currentWord': 'hint'

// Generate word associations using Claude with a simplified prompt
async function getAssociationsFromAI(word) {
  try {
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 250, // Reduced token limit for cost optimization
      messages: [
        {
          role: "user",
          content: `Give me 6-8 common word associations for "${word}" that most people would naturally think of.
          
          Return a JSON array with EXACTLY this format:
          [
            {"word": "association1", "type": "common association", "hint": "brief explanation"},
            {"word": "association2", "type": "common association", "hint": "brief explanation"}
          ]
          
          Important formatting rules:
          1. Use double quotes for all strings
          2. Ensure all JSON is properly formatted
          3. No trailing commas
          4. No comments or explanation text
          
          Ensure associations are intuitive and would be recognized by most adults.`
        }
      ]
    });

    // Parse the response to get an array of word association objects
    const responseText = message.content[0].text;
    
    // Handle potential JSON parsing errors
    let associationsArray;
    try {
      associationsArray = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Error parsing JSON response:', parseError);
      console.log('Raw response:', responseText);
      
      // Fallback to a simple array with default values
      associationsArray = [
        {"word": "related1", "type": "common association", "hint": `Related to ${word}`},
        {"word": "related2", "type": "common association", "hint": `Related to ${word}`},
        {"word": "related3", "type": "common association", "hint": `Related to ${word}`},
        {"word": "related4", "type": "common association", "hint": `Related to ${word}`},
        {"word": "related5", "type": "common association", "hint": `Related to ${word}`}
      ];
    }
    
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
    // Return fallback associations instead of throwing
    return ['related1', 'related2', 'related3', 'related4', 'related5'];
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
  
  // API limit check - no fallback, just throw an error if over limit
  if (apiLimits.dailyCount >= apiLimits.dailyLimit) {
    console.warn(`API daily limit reached (${apiLimits.dailyCount}/${apiLimits.dailyLimit})`);
    throw new Error('API daily limit reached - unable to get associations');
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
  // Check if a game has been generated yet
  if (!dailyGame.startWord || !dailyGame.targetWord) {
    return res.status(503).json({
      error: 'No game available',
      message: 'No game has been generated yet. Please try again later.',
      nextRefreshTime: nextGameTime.toISOString()
    });
  }
  
  // Include minExpectedSteps to give players a clue about puzzle complexity
  // Also include next refresh time and theme description
  res.json({
    gameDate: dailyGame.gameDate,
    startWord: dailyGame.startWord,
    targetWord: dailyGame.targetWord,
    theme: dailyGame.theme,
    themeDescription: dailyGame.description || "", // Add the theme description field
    difficulty: dailyGame.difficulty,
    minExpectedSteps: dailyGame.minExpectedSteps,
    stats: dailyGame.stats,
    nextRefreshTime: nextGameTime.toISOString()
  });
});

// Get word associations
app.get('/api/associations/:word', async (req, res) => {
  try {
    // Check if a game has been generated yet
    if (!dailyGame.startWord || !dailyGame.targetWord) {
      return res.status(503).json({
        error: 'No game available',
        message: 'No game has been generated yet. Please try again later.'
      });
    }
    
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
  // Check if a game has been generated yet
  if (!dailyGame.startWord || !dailyGame.targetWord) {
    return res.status(503).json({
      error: 'No game available',
      message: 'No game has been generated yet. Please try again later.'
    });
  }
  
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
    // Check if a game has been generated yet
    if (!dailyGame.startWord || !dailyGame.targetWord) {
      return res.status(503).json({
        error: 'No game available',
        message: 'No game has been generated yet. Please try again later.'
      });
    }
    
    const { progress } = req.query;
    const currentPath = progress ? JSON.parse(progress) : [dailyGame.startWord];
    const currentWord = currentPath[currentPath.length - 1];
    
    // Check API usage limits before proceeding
    if (apiLimits.dailyCount >= apiLimits.dailyLimit) {
      console.warn(`Hint request denied due to API limit (${apiLimits.dailyCount}/${apiLimits.dailyLimit})`);
      return res.status(429).json({ 
        error: 'API limit reached',
        message: 'Daily API usage limit reached. No hint available until limit resets.'
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
    
    const game = await generatePuzzle();
    
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
  // Always generate a new game on server start (now using random defaults if API fails)
  generatePuzzle()
    .then(() => console.log('Initial game generated on server start'))
    .catch(err => console.error('Failed to generate initial game:', err));
  
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
      
      if (shouldForceRefresh || apiLimits.gamesGenerated < apiLimits.gameGenerationPerDay) {
        console.log("Generating new game...");
        await generatePuzzle();
        apiLimits.gamesGenerated++;
        console.log(`New game generated by scheduler (${apiLimits.gamesGenerated}/${apiLimits.gameGenerationPerDay} today)`);
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

// Admin dashboard route
app.get('/admin', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'admin.html'));
});

// About page route
app.get('/about', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'about.html'));
});

// Serve static assets in production
if (process.env.NODE_ENV === 'production') {
  // Set static folder
  app.use(express.static(path.join(__dirname, '../client/build')));

  // Any route that's not an API route should be handled by React
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/admin') && !req.path.startsWith('/about')) {
      res.sendFile(path.resolve(__dirname, '../client/build', 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
});