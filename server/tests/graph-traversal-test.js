// Test to verify the graph-based puzzle generation approach
// Run with: node tests/graph-traversal-test.js

// Import required modules
const path = require('path');

// Mock data for testing
const dailyGame = { startWord: null, targetWord: null };
const cacheStats = { hits: 0, misses: 0 };

// Start with an empty association cache
const associationCache = {};

// Function to generate a random 3-letter word
function generateRandomWord() {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  return Array(3).fill(0).map(() => letters[Math.floor(Math.random() * letters.length)]).join('');
}

// Mock anthropic that returns random 3-letter words
const anthropic = {
  messages: {
    create: async () => {
      return { content: [{ text: generateRandomWord() }] };
    }
  }
};

// Simple function to get associations from the cache or generate random ones
async function getAssociations(word) {
  const normalizedWord = word.toLowerCase().trim();
  
  if (associationCache[normalizedWord]) {
    cacheStats.hits++;
    console.log(`Cache HIT for '${normalizedWord}'`);
    return associationCache[normalizedWord];
  }
  
  // If not in cache, generate random associations (simulate AI call)
  cacheStats.misses++;
  console.log(`Cache MISS for '${normalizedWord}' - generating random associations`);
  
  // Generate 10 random 3-letter words as associations (increased from 7)
  const randomAssocs = Array(10).fill(0).map(() => generateRandomWord());
  
  // Store in cache
  associationCache[normalizedWord] = randomAssocs;
  console.log(`Added ${randomAssocs.length} associations for ${normalizedWord}: ${randomAssocs.join(', ')}`);
  return randomAssocs;
}

// Helper function to find a path through the word association graph
async function findPathThroughGraph(startWord) {
  console.log(`Starting path search from "${startWord}"`);
  
  // Define parameters
  const MIN_PATH_LENGTH = 3; // at least 3 words total (2 steps) - reduced for testing
  const MAX_DEPTH = 6;       // increased depth to find more potential paths
  const MAX_EXPLORATIONS = 100; // increased to allow more exploration
  
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
    
    // Add each valid next word to queue (increased from 3 to 5 for better exploration)
    const nextWords = validNextWords.slice(0, 5);
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
      console.log(`${candidate} is directly associated with previous word ${word} - not valid`);
      // Target is directly associated with a previous word in the path - not valid
      return false;
    }
  }
  
  // Make sure the word has some associations (less strict requirement)
  const candidateAssociations = await getAssociations(candidate);
  if (candidateAssociations.length < 2) {
    console.log(`${candidate} has too few associations (${candidateAssociations.length}) - not valid`);
    return false;
  }
  
  // If we get here, the candidate is valid
  console.log(`${candidate} is a valid target word`);
  return true;
}

// Main test function
async function runTest() {
  console.log("=== TESTING GRAPH TRAVERSAL ALGORITHM ===");
  
  try {
    // Generate a random start word
    const startWord = (await anthropic.messages.create()).content[0].text;
    console.log(`Using start word: ${startWord}`);
    
    // Try to find a valid path
    const result = await findPathThroughGraph(startWord);
    
    if (result) {
      console.log("\n=== TEST PASSED ===");
      console.log(`Found valid path: ${result.path.join(' → ')}`);
      console.log(`Target word: ${result.targetWord}`);
      console.log(`Path length: ${result.path.length} words (${result.path.length - 1} steps)`);
      
      // Verify path is valid
      let isPathValid = true;
      for (let i = 0; i < result.path.length - 2; i++) {
        const word = result.path[i];
        const associations = associationCache[word];
        if (associations && associations.includes(result.targetWord)) {
          console.log(`❌ INVALID PATH: Word at index ${i} (${word}) has direct association to target`);
          isPathValid = false;
          break;
        }
      }
      
      // Make sure the second-to-last word has the target as an association
      const penultimateWord = result.path[result.path.length - 2];
      const associations = associationCache[penultimateWord];
      if (!associations || !associations.includes(result.targetWord)) {
        console.log(`❌ INVALID PATH: Penultimate word ${penultimateWord} is not connected to target ${result.targetWord}`);
        isPathValid = false;
      }
      
      if (isPathValid) {
        console.log(`✅ Path validity confirmed`);
      }
      
      return isPathValid;
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