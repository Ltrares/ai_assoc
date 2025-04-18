// Test to verify cached words aren't selected in the path
// Run with: node tests/cache-selection-test.js

// Import required environment variables for local testing
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Import Anthropic client
const Anthropic = require('@anthropic-ai/sdk');

// Mock global state
global.previousStartWords = [];

// Mock daily game object
const currentGame = {
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

// Association cache - prepopulate with "space" to simulate the issue
const associationCache = {
  "space": ["universe", "cosmos", "astronaut", "nasa", "rocket", "galaxy", "empty"],
  "space_detailed": [
    {"word": "universe", "type": "common association", "hint": "Space encompasses the universe"},
    {"word": "cosmos", "type": "common association", "hint": "Another term for space"},
    {"word": "astronaut", "type": "common association", "hint": "Person who travels in space"},
    {"word": "nasa", "type": "common association", "hint": "Space agency"},
    {"word": "rocket", "type": "common association", "hint": "Vehicle for space travel"},
    {"word": "galaxy", "type": "common association", "hint": "Collection of stars in space"},
    {"word": "empty", "type": "common association", "hint": "Space is mostly empty"}
  ]
};

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

// Get associations with logging
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
    
    // For "telescope", make sure "space" is included among the associations
    // This simulates our problematic case
    if (normalizedWord === "telescope") {
      let result = [...associationCache[cacheKey]];
      if (!result.includes("space")) {
        result.push("space");
        console.log(`Added "space" to the telescope associations for test case`);
      }
      return result;
    }
    
    return associationCache[cacheKey];
  }
  
  // Otherwise, get from AI
  cacheStats.misses++;
  console.log(`Cache MISS for '${normalizedWord}' (${cacheStats.hits} hits, ${cacheStats.misses} misses)`);
  
  // If this is "telescope", hardcode the associations to include "space"
  if (normalizedWord === "telescope") {
    const telescopeAssociations = ["stars", "astronomy", "space", "lens", "observatory", "hubble", "galaxy"];
    console.log(`Hardcoded associations for telescope: ${telescopeAssociations.join(', ')}`);
    
    // Store in cache
    associationCache[normalizedWord] = telescopeAssociations;
    associationCache[`${normalizedWord}_detailed`] = telescopeAssociations.map(word => ({
      "word": word, "type": "common association", "hint": `Related to ${normalizedWord}`
    }));
    
    return telescopeAssociations;
  }
  
  // For other words, make a real API call
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
    
    // Store both simplified and detailed versions in cache
    associationCache[normalizedWord] = wordOnlyArray;
    associationCache[`${normalizedWord}_detailed`] = associationsArray;
    
    console.log(`Received associations for "${word}": ${wordOnlyArray.join(', ')}`);
    return wordOnlyArray;
  } catch (error) {
    console.error('Error getting AI associations:', error);
    // Return fallback associations instead of throwing
    return ['related1', 'related2', 'related3', 'related4', 'related5'];
  }
}

// Test the word selection logic with pre-cached words
async function runCacheSelectionTest() {
  console.log("=== RUNNING CACHE SELECTION TEST ===");
  
  // Show the initial state of the cache
  console.log(`Initial cache has ${Object.keys(associationCache).filter(k => !k.includes('_detailed')).length} entries:`);
  Object.keys(associationCache)
    .filter(k => !k.includes('_detailed'))
    .forEach(key => console.log(`- ${key}: ${associationCache[key].join(', ')}`));
  
  try {
    // Hardcode "telescope" as the seed word
    const seedWord = "telescope";
    console.log(`\nUsing seed word: ${seedWord}`);
    
    // Create path starting with telescope
    const path = [seedWord];
    
    // Set desired path length
    const desiredPathLength = 6; // 6 words total (5 steps)
    console.log(`Aiming for a path with ${desiredPathLength} words (${desiredPathLength-1} steps)`);
    
    // Get associations for telescope
    console.log(`Getting associations for seed word: ${seedWord}`);
    let associations = await getAssociations(seedWord);
    console.log(`Got ${associations.length} associations for ${seedWord}: ${associations.join(', ')}`);
    
    // Check if "space" is in the associations
    const hasSpace = associations.some(word => word.toLowerCase() === "space");
    if (!hasSpace) {
      console.error("ERROR: 'space' wasn't included in the associations as expected");
      return {
        success: false,
        reason: "Test setup failed: 'space' not in associations"
      };
    }
    
    // Iteratively build the path step by step
    let currentWord = seedWord;
    
    // Track selections
    let selections = [];
    
    while (path.length < desiredPathLength - 1) { // -1 because we'll add the last word as target
      console.log(`\nPath so far: ${path.join(' → ')}`);
      console.log(`Finding next word after "${currentWord}"...`);
      
      // Filter out associations:
      // 1. Already in our path
      // 2. Already in our cache (meaning they've been seen before)
      const availableAssociations = associations.filter(word => {
        // Skip if already in our path
        if (path.includes(word)) {
          console.log(`- "${word}" excluded: already in path`);
          return false;
        }
        
        // Skip if this word is already in the cache from previous puzzles/steps
        // We need to normalize the word (lowercase, trim) for consistent comparison
        const normalizedWord = word.toLowerCase().trim();
        const inCache = Object.keys(associationCache)
          .filter(key => !key.includes('_detailed')) // Exclude detailed cache entries
          .some(key => key.toLowerCase().trim() === normalizedWord && 
                 key.toLowerCase().trim() !== currentWord.toLowerCase().trim()); // Allow current word
        
        if (inCache) {
          console.log(`- "${word}" excluded: already in cache`);
          return false;
        }
        
        console.log(`- "${word}" available: not in path or cache`);
        return true;
      });
      
      console.log(`Found ${availableAssociations.length} available new associations: ${availableAssociations.join(', ')}`);
      
      if (availableAssociations.length === 0) {
        // Try again with just excluding words in our path but allowing cached words
        // This is a fallback to ensure we can at least build a path
        console.log(`\nNo new uncached associations found for ${currentWord}. Falling back to cached words...`);
        const fallbackAssociations = associations.filter(word => {
          if (path.includes(word)) {
            console.log(`- "${word}" excluded: already in path`);
            return false;
          }
          console.log(`- "${word}" available in fallback`);
          return true;
        });
        
        console.log(`Found ${fallbackAssociations.length} fallback associations: ${fallbackAssociations.join(', ')}`);
        
        if (fallbackAssociations.length === 0) {
          // If still no associations, we have to end the path
          console.log(`No more available associations for ${currentWord}, ending path early`);
          break;
        }
        
        // Pick a random fallback association
        const randomIndex = Math.floor(Math.random() * fallbackAssociations.length);
        const nextWord = fallbackAssociations[randomIndex];
        selections.push({
          word: nextWord,
          type: "fallback",
          choices: fallbackAssociations.length
        });
        
        // Add the word to our path and continue
        path.push(nextWord);
        console.log(`Added fallback word ${nextWord} to path: ${path.join(' → ')}`);
        currentWord = nextWord;
        
        // Continue building the path
        if (path.length < desiredPathLength - 1) {
          console.log(`Getting associations for fallback word: ${currentWord}`);
          associations = await getAssociations(currentWord);
          console.log(`Got ${associations.length} associations for ${currentWord}`);
        }
        
        continue; // Skip to next iteration
      }
      
      // Pick a random association as the next word
      const randomIndex = Math.floor(Math.random() * availableAssociations.length);
      const nextWord = availableAssociations[randomIndex];
      selections.push({
        word: nextWord,
        type: "primary",
        choices: availableAssociations.length
      });
      
      // Check if "space" was selected (should not happen)
      if (nextWord.toLowerCase() === "space") {
        console.error(`❌ FAILURE: "space" was selected as the next word!`);
        return {
          success: false,
          reason: '"space" was selected despite being in cache'
        };
      }
      
      // Add the word to our path
      path.push(nextWord);
      console.log(`Added ${nextWord} to path: ${path.join(' → ')}`);
      
      // This word becomes our new current word
      currentWord = nextWord;
      
      // Get associations for this new word, unless we've reached our target length - 1
      if (path.length < desiredPathLength - 1) {
        console.log(`Getting associations for: ${currentWord}`);
        associations = await getAssociations(currentWord);
        console.log(`Got ${associations.length} associations for ${currentWord}`);
      }
    }
    
    // The last word in the path is our target word
    const targetWord = path[path.length - 1];
    console.log(`\nFinal path: ${path.join(' → ')}`);
    console.log(`Target word: ${targetWord}`);
    console.log(`Path length: ${path.length} words (${path.length - 1} steps)`);
    
    // Check if "space" is in the final path
    const spaceInPath = path.some(word => word.toLowerCase() === "space");
    
    console.log("\n=== SELECTION HISTORY ===");
    selections.forEach((selection, index) => {
      console.log(`Step ${index+1}: Selected "${selection.word}" (${selection.type} selection) from ${selection.choices} choices`);
    });
    
    return {
      success: !spaceInPath,
      path,
      selections
    };
  } catch (error) {
    console.error('Error in test:', error);
    return {
      success: false,
      reason: error.message
    };
  }
}

// Run the test
(async () => {
  try {
    const result = await runCacheSelectionTest();
    console.log("\n=== TEST SUMMARY ===");
    
    if (result.success) {
      console.log("✅ TEST PASSED: Our code successfully prevented 'space' from being selected in the path");
      console.log(`Final path: ${result.path.join(' → ')}`);
      process.exit(0);
    } else {
      console.error(`❌ TEST FAILED: ${result.reason}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ TEST ERROR:", error);
    process.exit(1);
  }
})();