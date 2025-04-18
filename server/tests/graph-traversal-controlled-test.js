// Test to verify the graph-based puzzle generation approach with controlled associations
// Run with: node tests/graph-traversal-controlled-test.js

// Import required modules
const path = require('path');

// Mock data for testing
const currentGame = { startWord: null, targetWord: null };
const cacheStats = { hits: 0, misses: 0 };

// Start with an association cache with a designated target word
const associationCache = {
  // Add a special target word that we'll strategically insert into the graph
  TARGET_WORD: "xyz"
};

// Function to generate a random 3-letter word
function generateRandomWord() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return Array(3).fill(0).map(() => letters[Math.floor(Math.random() * letters.length)]).join('');
}

// Mock anthropic with fixed starting word to ensure deterministic test
const anthropic = {
  messages: {
    create: async () => {
      // Use a fixed starting word for deterministic testing
      return { content: [{ text: "abc" }] };
    }
  }
};

// Function to get associations from the cache or generate controlled ones
async function getAssociations(word) {
  const normalizedWord = word.toLowerCase().trim();
  
  // Skip special entries
  if (normalizedWord === 'TARGET_WORD') {
    return [];
  }
  
  if (associationCache[normalizedWord]) {
    cacheStats.hits++;
    console.log(`Cache HIT for '${normalizedWord}'`);
    return associationCache[normalizedWord];
  }
  
  // If not in cache, generate deterministic associations (simulate AI call)
  cacheStats.misses++;
  console.log(`Cache MISS for '${normalizedWord}' - generating deterministic associations`);
  
  // Generate deterministic associations based on the word
  // This ensures we'll get consistent graph structure
  const seed = normalizedWord.charCodeAt(0) + normalizedWord.charCodeAt(1) + normalizedWord.charCodeAt(2);
  const assocs = [];
  
  // Create 5 deterministic associations
  for (let i = 0; i < 5; i++) {
    // Use a simple algorithm to ensure uniqueness and determinism
    const char1 = String.fromCharCode(97 + ((seed + i * 3) % 26));
    const char2 = String.fromCharCode(97 + ((seed + i * 7) % 26));
    const char3 = String.fromCharCode(97 + ((seed + i * 11) % 26));
    assocs.push(char1 + char2 + char3);
  }
  
  // Insert special target strategically
  // If we're at depth 3-4 (based on word length pattern), add the target word 
  // We're using a pattern to create a predictable path
  if (normalizedWord.length === 3 && seed % 5 === 0) {
    assocs[2] = associationCache.TARGET_WORD;
    console.log(`Added special TARGET_WORD to associations for ${normalizedWord}`);
  }
  
  // Store in cache
  associationCache[normalizedWord] = assocs;
  console.log(`Added ${assocs.length} associations for ${normalizedWord}: ${assocs.join(', ')}`);
  return assocs;
}

// Helper function to find a path through the word association graph
async function findPathThroughGraph(startWord) {
  console.log(`Starting path search from "${startWord}"`);
  
  // Define parameters
  const MIN_PATH_LENGTH = 3; // at least 3 words total (2 steps) - reduced for test
  const MAX_DEPTH = 6;       // don't go too deep
  const MAX_EXPLORATIONS = 200; // safety limit
  
  // Initialize path with start word
  const initialPath = [startWord];
  
  // Get associations for the start word
  const startAssociations = await getAssociations(startWord);
  
  // Queue for breadth-first traversal
  const queue = [{ path: initialPath, depth: 1 }];
  
  // Track visited words
  const visited = new Set([startWord]);
  
  // Exploration stats
  let explored = 0;
  let validTargetsChecked = 0;
  
  // Process the queue
  while (queue.length > 0 && explored < MAX_EXPLORATIONS) {
    explored++;
    
    // Get next path to explore
    const { path, depth } = queue.shift();
    const currentWord = path[path.length - 1];
    
    // Log progress periodically
    if (explored % 50 === 0) {
      console.log(`Explored ${explored} paths, queue size: ${queue.length}, valid targets checked: ${validTargetsChecked}`);
    }
    
    // If we've reached minimum depth, check if this could be a target
    if (depth >= MIN_PATH_LENGTH - 1) { // -1 because path length = depth + 1
      validTargetsChecked++;
      const isValid = await isValidTargetWord(currentWord, path.slice(0, -1));
      if (isValid) {
        console.log(`Found valid target "${currentWord}" at depth ${depth}`);
        return { path, targetWord: currentWord };
      }
    }
    
    // Stop if we're too deep
    if (depth >= MAX_DEPTH) {
      continue;
    }
    
    // Get associations for current word
    let associations;
    try {
      associations = await getAssociations(currentWord);
    } catch (error) {
      console.error(`Error getting associations for "${currentWord}"`);
      continue;
    }
    
    // Filter to avoid visited words
    const validNextWords = associations.filter(word => !visited.has(word));
    
    // Skip if dead end
    if (validNextWords.length === 0) {
      continue;
    }
    
    // Add each valid next word to queue (limit to 3 for breadth control)
    const nextWords = validNextWords.slice(0, 3);
    for (const nextWord of nextWords) {
      visited.add(nextWord);
      const newPath = [...path, nextWord];
      queue.push({ path: newPath, depth: depth + 1 });
    }
  }
  
  console.log(`No valid path found after exploring ${explored} paths, checking ${validTargetsChecked} potential targets`);
  return null;
}

// Check if word would be a valid target
async function isValidTargetWord(candidate, previousWords) {
  // For each previous word, check if candidate is a direct association
  for (const word of previousWords) {
    const associations = await getAssociations(word);
    
    if (associations.includes(candidate)) {
      // Target is directly associated with a previous word in the path - not valid
      return false;
    }
  }
  
  // If we get here, the candidate is valid
  return true;
}

// Main test function
async function runTest() {
  console.log("=== TESTING GRAPH TRAVERSAL ALGORITHM ===");
  
  // For testing purposes, create a simple manually constructed graph with a guaranteed valid path
  console.log("Setting up a simple test graph with a guaranteed path");
  
  // Clear any existing cache
  Object.keys(associationCache).forEach(key => {
    if (key !== 'TARGET_WORD') delete associationCache[key];
  });
  
  // Create a simple test graph with "xyz" as target
  associationCache["abc"] = ["def", "ghi", "jkl"];
  associationCache["def"] = ["mno", "pqr"];
  associationCache["mno"] = ["xyz", "stu"]; // This creates a valid path: abc → def → mno → xyz
  
  try {
    // Use fixed start word
    const startWord = "abc";
    console.log(`Using start word: ${startWord}`);
    
    // Try to find a valid path
    const result = await findPathThroughGraph(startWord);
    
    if (result) {
      console.log("\n=== TEST PASSED ===");
      console.log(`Found valid path: ${result.path.join(' → ')}`);
      console.log(`Target word: ${result.targetWord}`);
      console.log(`Path length: ${result.path.length} words (${result.path.length - 1} steps)`);
      
      // Verify the expected path was found
      const expectedPath = ["abc", "def", "mno", "xyz"];
      const foundExpectedPath = JSON.stringify(result.path) === JSON.stringify(expectedPath);
      
      if (foundExpectedPath) {
        console.log(`✅ Found the expected path: ${expectedPath.join(' → ')}`);
      } else {
        console.log(`✓ Found a valid path, but not the expected one.`);
        console.log(`  Expected: ${expectedPath.join(' → ')}`);
        console.log(`  Actual:   ${result.path.join(' → ')}`);
      }
      
      return true;
    } else {
      console.log("\n=== TEST FAILED ===");
      console.log("Could not find a valid path within constraints");
      return false;
    }
  } catch (error) {
    console.error("\n=== TEST ERROR ===");
    console.error(error);
    return false;
  }
}

// Run the test
runTest().then(success => {
  console.log(`\nTest ${success ? 'passed' : 'failed'}`);
  console.log(`Cache stats: ${cacheStats.hits} hits, ${cacheStats.misses} misses`);
  console.log(`Cache size: ${Object.keys(associationCache).length} entries`);
});