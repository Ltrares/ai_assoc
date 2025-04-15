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

// Game state - using more varied defaults in case API calls fail
let dailyGame = {
  startWord: Math.random() > 0.5 ? 'sunset' : 'garden',
  targetWord: Math.random() > 0.5 ? 'theater' : 'mountain',
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

// Function to generate a new game using organic path traversal
async function generateDailyGame() {
  // Set next game time to the next hour
  nextGameTime = new Date();
  nextGameTime.setHours(nextGameTime.getHours() + 1);
  nextGameTime.setMinutes(0);
  nextGameTime.setSeconds(0);
  nextGameTime.setMilliseconds(0);
  
  // Store current words to ensure we don't generate the same ones again
  const currentStartWord = dailyGame.startWord;
  const currentTargetWord = dailyGame.targetWord;
  
  try {
    console.log("Generating new game using organic path traversal...");
    
    // First, generate a theme to give the puzzle context
    // This will provide a conceptual framework for selecting start/end words
    const themeMessage = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: `Generate ONE interesting theme for a word association puzzle from these categories: 
          pop culture, movies, music, video games, sports, nature, food, travel, technology, science, art, literature.
          
          Return ONLY a JSON object with this format:
          {
            "theme": "Short theme name, 2-4 words maximum",
            "description": "Brief description of the theme (10-15 words max)",
            "difficulty": "medium|hard|expert"
          }
          
          Examples:
          { "theme": "Ocean to Sky", "description": "Words connecting underwater life to aerial phenomena", "difficulty": "hard" }
          { "theme": "Farm to Table", "description": "Words linking agriculture to prepared meals", "difficulty": "medium" }
          
          Keep the theme concise and broadly recognizable.`
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
      
      // Use fallback theme if parsing fails
      themeData = {
        theme: "Word Connections",
        description: "A journey through related concepts and ideas",
        difficulty: "medium"
      };
      console.log("Using fallback theme");
    }
    
    // Get potential starting words based on the theme
    const startWordMessage = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 150,
      messages: [
        {
          role: "user",
          content: `Generate 5 good starting words for a word association puzzle with the theme "${themeData.theme}".
          
          The words should:
          1. Be simple, common, recognizable nouns or verbs
          2. Be clearly connected to the theme
          3. Have multiple potential word associations
          4. NOT include ${currentStartWord} or ${currentTargetWord} (previous game words)
          5. Be single words (not phrases)
          
          Return ONLY a JSON array of 5 words:
          ["word1", "word2", "word3", "word4", "word5"]`
        }
      ]
    });

    const startWordsText = startWordMessage.content[0].text;
    let startWords;
    
    try {
      startWords = JSON.parse(startWordsText);
      console.log(`Generated starting word options: ${startWords.join(', ')}`);
    } catch (parseError) {
      console.error('Error parsing start words:', parseError);
      console.log('Raw start words response:', startWordsText);
      
      // Use fallback starting words
      const fallbackStarts = ["ocean", "mountain", "camera", "flower", "guitar", "book", "coffee"];
      startWords = fallbackStarts.filter(w => 
        w !== currentStartWord.toLowerCase() && 
        w !== currentTargetWord.toLowerCase()
      ).slice(0, 5);
      
      if (startWords.length < 5) {
        startWords = [...startWords, "sunset", "river", "pencil"].slice(0, 5);
      }
      console.log("Using fallback starting words");
    }
    
    // Select a random starting word from the options
    const startWord = startWords[Math.floor(Math.random() * startWords.length)];
    console.log(`Selected starting word: ${startWord}`);
    
    // Now build an association path organically, using actual word associations
    // This ensures the path is solvable using the game's own association generation
    
    // This will hold our path as we build it
    const path = [startWord];
    
    // Get associations for the starting word
    const startAssociations = await getAssociations(startWord);
    console.log(`Associations for ${startWord}: ${startAssociations.join(', ')}`);
    
    // Build a path of 3-5 steps
    const targetPathLength = Math.floor(Math.random() * 3) + 4; // 4-6 words total (3-5 steps)
    
    let currentWord = startWord;
    let attempts = 0;
    
    while (path.length < targetPathLength && attempts < 10) {
      attempts++;
      
      // Get associations for the current word
      const associations = await getAssociations(currentWord);
      
      // Filter out associations that are already in our path to avoid loops
      const validAssociations = associations.filter(word => 
        !path.includes(word) && 
        word !== currentStartWord.toLowerCase() && 
        word !== currentTargetWord.toLowerCase()
      );
      
      if (validAssociations.length === 0) {
        console.log(`No valid associations for ${currentWord}, will try a different approach`);
        break;
      }
      
      // Select a random association that's not already in the path
      const nextWord = validAssociations[Math.floor(Math.random() * validAssociations.length)];
      path.push(nextWord);
      console.log(`Added ${nextWord} to path. Path so far: ${path.join(' → ')}`);
      
      // Update current word for next iteration
      currentWord = nextWord;
    }
    
    // If we couldn't build a long enough path, use a backup approach
    if (path.length < 3) {
      console.log("Path too short, using alternative approach");
      
      // Request a longer path directly
      const backupPathMessage = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: `Create a 5-step word association path starting with "${startWord}" that fits the theme "${themeData.theme}".
            
            Each step should be a clear, intuitive association from the previous word.
            Return only a JSON array with the complete path: ["${startWord}", "word2", "word3", "word4", "word5", "word6"]`
          }
        ]
      });
      
      try {
        const backupPath = JSON.parse(backupPathMessage.content[0].text);
        if (backupPath.length >= 3 && backupPath[0] === startWord) {
          path.length = 0; // Clear the current path
          backupPath.forEach(word => path.push(word)); // Use the backup path
          console.log(`Using backup path: ${path.join(' → ')}`);
        }
      } catch (backupError) {
        console.error("Error parsing backup path:", backupError);
      }
    }
    
    // The target word is the last word in our path
    const targetWord = path[path.length - 1];
    console.log(`Organic path complete: ${path.join(' → ')}`);
    console.log(`Start: ${startWord}, Target: ${targetWord}`);
    
    // Update the game state with the generated data
    dailyGame = {
      startWord: startWord,
      targetWord: targetWord,
      theme: themeData.theme,
      description: themeData.description || "",
      difficulty: themeData.difficulty || "medium",
      hiddenSolution: path, // Store the actual path we've built
      minExpectedSteps: path.length - 1, // Actual number of steps in our path
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
    console.log(`Verified solution path: ${dailyGame.hiddenSolution.join(' → ')}`);
    
    // Pre-cache all words in the solution path to ensure quick gameplay
    console.log(`Pre-caching associations for all solution path words...`);
    
    try {
      // We've already cached the words in the path during path building
      // But we'll double-check to make sure
      for (const word of path) {
        // Only get associations if not already in cache
        if (!associationCache[word.toLowerCase()]) {
          console.log(`Pre-caching associations for: ${word}`);
          await getAssociations(word);
        }
      }
      
      console.log(`Pre-caching complete. Cache now contains ${Object.keys(associationCache).length} entries.`);
    } catch (cacheError) {
      console.error('Error during pre-caching:', cacheError);
      // Continue with game generation even if pre-caching fails
    }
    
    return dailyGame;
  } catch (error) {
    console.error('Error generating daily game:', error);
    
    // Create a new game with different words than the previous ones
    const alternativeStarts = ["sunset", "guitar", "river", "camera", "bicycle"];
    const alternativeTargets = ["theater", "mountain", "festival", "museum", "carnival"];
    
    // Choose words that are different from current ones
    let newStartWord, newTargetWord;
    do {
      newStartWord = alternativeStarts[Math.floor(Math.random() * alternativeStarts.length)];
      newTargetWord = alternativeTargets[Math.floor(Math.random() * alternativeTargets.length)];
    } while (newStartWord === currentStartWord || newTargetWord === currentTargetWord);
    
    // Fallback to default game with new words if AI fails
    dailyGame.startWord = newStartWord;
    dailyGame.targetWord = newTargetWord;
    dailyGame.theme = "Word Connections";
    dailyGame.difficulty = "medium";
    dailyGame.minExpectedSteps = 4;
    dailyGame.gameDate = new Date().toISOString().split('T')[0];
    dailyGame.hiddenSolution = [newStartWord, "association1", "association2", "association3", newTargetWord];
    
    console.log(`Fallback game created: ${dailyGame.startWord} → ${dailyGame.targetWord}`);
    
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
  // Always generate a new game on server start (now using random defaults if API fails)
  generateDailyGame()
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
        await generateDailyGame();
        apiLimits.gamesGenerated++;
        console.log(`New game generated by scheduler (${apiLimits.gamesGenerated}/${apiLimits.gameGenerationPerDay} today)`);
      } else {
        console.log(`Game generation skipped - daily limit of ${apiLimits.gameGenerationPerDay} reached`);
      }
    } catch (error) {
      console.error('Scheduler failed to generate game:', error);
      
      // Even if there's an error, try to create a new game with random words
      try {
        const alternativeStarts = ["sunset", "guitar", "river", "camera", "bicycle"];
        const alternativeTargets = ["theater", "mountain", "festival", "museum", "carnival"];
        
        dailyGame.startWord = alternativeStarts[Math.floor(Math.random() * alternativeStarts.length)];
        dailyGame.targetWord = alternativeTargets[Math.floor(Math.random() * alternativeTargets.length)];
        
        console.log(`Emergency fallback game created: ${dailyGame.startWord} → ${dailyGame.targetWord}`);
      } catch (fallbackError) {
        console.error('Even fallback generation failed:', fallbackError);
      }
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