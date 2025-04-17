// Graph traversal test with a focused approach
// Run with: node tests/graph-traversal-focused-test.js

// This test creates a simple but realistic graph structure with 3-letter words
// and tests the graph traversal algorithm with more controlled inputs.

// Mock associationCache with a predefined structure
const associationCache = {
  // Start with a set of core words that have well-defined connections
  "cat": ["dog", "hat", "bat", "mat", "rat", "pet", "fur", "paw"],
  "dog": ["cat", "pet", "paw", "run", "fur", "toy", "vet", "big"],
  "hat": ["cat", "cap", "big", "top", "sun", "red", "fit", "old"],
  "bat": ["cat", "hit", "fly", "out", "run", "big", "toy", "fun"],
  "pet": ["cat", "dog", "fur", "vet", "toy", "fun", "own", "new"],
  "paw": ["cat", "dog", "fur", "leg", "toe", "pet", "run", "mud"],
  "sun": ["hot", "day", "ray", "sky", "hat", "red", "big", "out"],
  "fun": ["joy", "toy", "kid", "bat", "pet", "big", "run", "new"],
  "big": ["dog", "hat", "bat", "sun", "fun", "old", "top", "new"],
  "toy": ["dog", "bat", "pet", "fun", "kid", "new", "own", "joy"],
  "run": ["dog", "bat", "paw", "fun", "jog", "hop", "win", "fit"],
  "new": ["pet", "fun", "big", "toy", "now", "old", "own", "top"],
  "red": ["hat", "sun", "hot", "car", "fox", "pen", "day", "old"],
  "hot": ["sun", "red", "day", "win", "fan", "ice", "tea", "ray"],
  "car": ["red", "big", "new", "old", "key", "top", "gas", "own"]
};

// Cache stats for tracking
const cacheStats = { hits: 0, misses: 0 };

// Simple function to get associations from the cache
function getAssociations(word) {
  const normalizedWord = word.toLowerCase().trim();
  
  if (associationCache[normalizedWord]) {
    cacheStats.hits++;
    console.log(`Cache HIT for '${normalizedWord}'`);
    return associationCache[normalizedWord];
  }
  
  // If not in cache, return empty array (should not happen in this test)
  cacheStats.misses++;
  console.log(`Cache MISS for '${normalizedWord}' - returning empty array`);
  return [];
}

// Helper function to find a path through the word association graph
async function findPathThroughGraph(startWord) {
  console.log(`Starting path search from "${startWord}"`);
  
  // Define parameters
  const MIN_PATH_LENGTH = 5; // at least 5 words total (4 steps)
  const MAX_DEPTH = 10;      // increased depth for longer paths
  const MAX_EXPLORATIONS = 300; // increased for finding longer paths
  
  // Initialize path with start word
  const initialPath = [startWord];
  
  // Get associations for the start word
  const startAssociations = getAssociations(startWord);
  
  // Queue for breadth-first traversal
  const queue = [{ path: initialPath, depth: 1 }];
  
  // Track visited words
  const visited = new Set([startWord.toLowerCase().trim()]);
  
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
    if (explored % 10 === 0) {
      console.log(`Explored ${explored} paths, queue size: ${queue.length}, valid targets checked: ${validTargetsChecked}`);
    }
    
    // If we've reached minimum depth, check if this could be a target
    if (depth >= MIN_PATH_LENGTH - 1) { // -1 because path length = depth + 1
      validTargetsChecked++;
      const isValid = isValidTargetWord(currentWord, path.slice(0, -1));
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
    const associations = getAssociations(currentWord);
    
    // Filter to avoid visited words
    const validNextWords = associations.filter(word => {
      const normalizedWord = word.toLowerCase().trim();
      return !visited.has(normalizedWord);
    });
    
    // Skip if dead end
    if (validNextWords.length === 0) {
      continue;
    }
    
    // Add each valid next word to queue
    for (const nextWord of validNextWords) {
      const normalizedWord = nextWord.toLowerCase().trim();
      visited.add(normalizedWord); // Mark as visited
      
      // Create a new path by adding this word
      const newPath = [...path, nextWord];
      queue.push({ path: newPath, depth: depth + 1 });
    }
  }
  
  console.log(`No valid path found after exploring ${explored} paths, checking ${validTargetsChecked} potential targets`);
  return null;
}

// Check if word would be a valid target
function isValidTargetWord(candidate, previousWords) {
  // For each previous word, check if candidate is a direct association (except for the last word)
  for (let i = 0; i < previousWords.length - 1; i++) {
    const word = previousWords[i];
    const associations = getAssociations(word);
    
    if (associations.includes(candidate)) {
      console.log(`${candidate} is directly associated with previous word ${word} - not valid`);
      // Target is directly associated with a previous word in the path - not valid
      return false;
    }
  }
  
  // Final word in path should be directly associated with the target
  const finalPreviousWord = previousWords[previousWords.length - 1];
  const finalAssociations = getAssociations(finalPreviousWord);
  
  if (!finalAssociations.includes(candidate)) {
    console.log(`${candidate} is not associated with final word ${finalPreviousWord} - not valid`);
    return false;
  }
  
  // If we get here, the candidate is valid
  console.log(`${candidate} is a valid target word`);
  return true;
}

// Main test function
async function runTest() {
  console.log("=== TESTING FOCUSED GRAPH TRAVERSAL ===");
  
  // Test with a few different starting words
  const startWords = ["cat", "dog", "hat", "sun"];
  
  let passedTests = 0;
  
  for (const startWord of startWords) {
    console.log(`\nTest run with start word: ${startWord}`);
    
    // Try to find a valid path
    const result = await findPathThroughGraph(startWord);
    
    if (result) {
      console.log(`\n✅ TEST PASSED for ${startWord}`);
      console.log(`Found valid path: ${result.path.join(' → ')}`);
      console.log(`Target word: ${result.targetWord}`);
      console.log(`Path length: ${result.path.length} words (${result.path.length - 1} steps)`);
      
      // Verify path is valid
      let isPathValid = true;
      
      // Check that there are no shortcuts
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
        passedTests++;
      }
    } else {
      console.log(`\n❌ TEST FAILED for ${startWord}`);
      console.log("Could not find a valid path within constraints");
    }
  }
  
  return {
    totalTests: startWords.length,
    passedTests: passedTests
  };
}

// Run the test
runTest().then(results => {
  console.log(`\nTest summary: ${results.passedTests} passed out of ${results.totalTests}`);
  console.log(`Cache stats: ${cacheStats.hits} hits, ${cacheStats.misses} misses`);
});