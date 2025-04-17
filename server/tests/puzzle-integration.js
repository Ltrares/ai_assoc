// Integration test for puzzle generation
// Run with: node tests/puzzle-integration.js

// Import required environment variables for local testing
// Using path to find the .env file in the server directory
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Import Anthropic client
const Anthropic = require('@anthropic-ai/sdk');

// Mock global state
global.previousStartWords = [];

// Mock daily game object
const dailyGame = {
  startWord: null,
  targetWord: null,
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

// Association cache
const associationCache = {};

// Track cache stats
const cacheStats = {
  hits: 0,
  misses: 0,
  lastCleared: new Date(),
  hintHits: 0,
  hintMisses: 0
};

// Initialize Anthropic client
let anthropic;
try {
  anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
} catch (e) {
  console.error('Failed to initialize Anthropic client:', e);
  console.error('Make sure ANTHROPIC_API_KEY is set in your .env file');
  process.exit(1);
}

// Generate word associations using Claude
async function getAssociationsFromAI(word) {
  try {
    console.log(`Getting AI associations for: ${word}`);
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 250,
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

// Get associations with cache handling
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
  
  // Otherwise, get from AI and cache the result
  try {
    cacheStats.misses++;
    console.log(`Cache MISS for '${normalizedWord}' (${cacheStats.hits} hits, ${cacheStats.misses} misses)`);
    return await getAssociationsFromAI(normalizedWord);
  } catch (error) {
    console.error('Error in getAssociations:', error);
    return ['not found'];
  }
}

// Function to generate a puzzle
async function generatePuzzle() {
  // Clear the association cache before generating a new puzzle
  console.log(`Clearing association cache with ${Object.keys(associationCache).length} entries`);
  Object.keys(associationCache).forEach(key => {
    delete associationCache[key];
  });
  console.log("Association cache cleared for fresh puzzle generation");
  
  // Mock current game words
  const currentStartWord = dailyGame.startWord;
  const currentTargetWord = dailyGame.targetWord;

  try {
    console.log("Generating new puzzle using linear path approach...");
    
    // Step 1: Generate a random seed word
    console.log("Getting seed word from Claude...");
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
    console.log(`Path length: ${path.length} words (${path.length - 1} steps)`);
    
    // Print final results table
    console.log("\n===== PUZZLE TEST RESULTS =====");
    console.log(`Start word: ${seedWord}`);
    console.log(`Target word: ${targetWord}`);
    console.log(`Path: ${path.join(' → ')}`);
    console.log(`Length: ${path.length} words (${path.length - 1} steps)`);
    
    // Add test assertions
    if (path.length < 4) {
      console.error("❌ TEST FAILED: Path is too short (less than 4 words)");
    } else {
      console.log("✅ TEST PASSED: Path length is acceptable");
    }
    
    // Check for word duplications
    const uniqueWords = [...new Set(path.map(w => w.toLowerCase().trim()))];
    if (uniqueWords.length !== path.length) {
      console.error("❌ TEST FAILED: Path contains duplicate words");
    } else {
      console.log("✅ TEST PASSED: No duplicate words in path");
    }
    
    return {
      startWord: seedWord,
      targetWord,
      path,
      success: path.length >= 4 && uniqueWords.length === path.length
    };
  } catch (error) {
    console.error('Error generating puzzle:', error);
    throw error;
  }
}

// Run the integration test
(async () => {
  try {
    console.log("=== RUNNING PUZZLE GENERATION INTEGRATION TEST ===");
    const result = await generatePuzzle();
    console.log("=== TEST COMPLETE ===");
    if (result.success) {
      console.log("🎉 INTEGRATION TEST PASSED");
      process.exit(0);
    } else {
      console.error("❌ INTEGRATION TEST FAILED");
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ INTEGRATION TEST ERROR:", error);
    process.exit(1);
  }
})();