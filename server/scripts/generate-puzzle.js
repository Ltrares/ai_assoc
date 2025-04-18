// Standalone script to generate a puzzle and populate the association cache
// Run with: node scripts/generate-puzzle.js

const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); // Load environment variables from server/.env file
const Anthropic = require('@anthropic-ai/sdk');

// Verify environment variables
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ERROR: Missing ANTHROPIC_API_KEY environment variable");
  console.error("Make sure the .env file exists in the server directory and contains ANTHROPIC_API_KEY");
  process.exit(1);
}

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

console.log("API key loaded successfully from .env file");

// Path for cache file
const CACHE_FILE_PATH = path.join(__dirname, '..', 'data', 'association-cache.json');

// Promisify fs functions
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const mkdirAsync = promisify(fs.mkdir);

// Cache for word associations
let associationCache = {};

// API call counter to track usage
let apiCallCounter = 0;

// Get API limit from command line argument or use default
const API_CALL_LIMIT = process.argv[2] ? parseInt(process.argv[2], 10) : 100;
console.log(`Setting API call limit to: ${API_CALL_LIMIT}`)

// Track cache stats
const cacheStats = {
  hits: 0,
  misses: 0
};

// Function to save the association cache to disk
async function saveAssociationCache() {
  try {
    // Ensure the data directory exists
    await mkdirAsync(path.dirname(CACHE_FILE_PATH), { recursive: true }).catch(() => {});
    
    // Save cache to file
    await writeFileAsync(CACHE_FILE_PATH, JSON.stringify(associationCache, null, 2), 'utf8');
    console.log(`Association cache saved to ${CACHE_FILE_PATH} (${Object.keys(associationCache).length} entries)`);
    return true;
  } catch (error) {
    console.error('Error saving association cache:', error);
    return false;
  }
}

// Function to load the association cache from disk
async function loadAssociationCache() {
  try {
    // Check if cache file exists
    if (!fs.existsSync(CACHE_FILE_PATH)) {
      console.log(`No cache file found at ${CACHE_FILE_PATH}. Starting with empty cache.`);
      return false;
    }
    
    // Read and parse cache file
    const data = await readFileAsync(CACHE_FILE_PATH, 'utf8');
    const loadedCache = JSON.parse(data);
    
    // Validate and use the loaded cache
    if (loadedCache && typeof loadedCache === 'object') {
      associationCache = loadedCache;
      console.log(`Association cache loaded from ${CACHE_FILE_PATH} (${Object.keys(associationCache).length} entries)`);
      return true;
    } else {
      console.error('Invalid cache file format. Starting with empty cache.');
      return false;
    }
  } catch (error) {
    console.error('Error loading association cache:', error);
    return false;
  }
}

// Generate word associations using Claude
async function getAssociationsFromAI(word) {
  // Increment counter
  apiCallCounter++;
  console.log(`API Call #${apiCallCounter} - Getting associations for "${word}"`);
  
  // Check if we've hit the limit
  if (apiCallCounter > API_CALL_LIMIT) {
    throw new Error(`API call limit of ${API_CALL_LIMIT} reached. Stopping to prevent excessive usage.`);
  }
  
  try {
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `Give me 5-10 common word associations for "${word}" that most people would naturally think of.
          
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
          5. ALWAYS use singular forms for words (e.g., "balloon" instead of "balloons")
          
          If you cannot come up with at least 3 good word associations, include "__ERROR__" as one of the words.
          
          Ensure associations are intuitive and would be recognized by most adults.`
        }
      ]
    });

    // Parse the response
    const responseText = message.content[0].text;
    
    // Parse the JSON response
    let associationsArray = JSON.parse(responseText);
    
    // Validate the structure of the parsed array
    if (!Array.isArray(associationsArray)) {
      throw new Error("Invalid association array structure: not an array");
    }
    
    // Check for the error token - this indicates Claude had issues
    const hasErrorToken = associationsArray.some(item => 
      item && typeof item === 'object' && item.word === "__ERROR__"
    );
    
    if (hasErrorToken) {
      // Don't hide this error - expose it clearly
      throw new Error(`"__ERROR__" token found in associations for "${word}". Claude couldn't generate enough associations.`);
    }
    
    // Validate each item in the array
    const validItems = associationsArray.filter(item => 
      item && 
      typeof item === 'object' && 
      typeof item.word === 'string' && 
      item.word.trim() !== ''
    );
    
    if (validItems.length < 3) {
      throw new Error(`Too few valid associations for "${word}" (${validItems.length}). Need at least 3 associations.`);
    }
    
    associationsArray = validItems;
    
    // Extract just the words for backward compatibility
    const wordOnlyArray = associationsArray.map(item => item.word);
    
    // Normalize the word for consistent caching
    const normalizedWord = word.toLowerCase().trim();
    
    // Store both simplified and detailed versions in cache
    associationCache[normalizedWord] = wordOnlyArray;
    associationCache[`${normalizedWord}_detailed`] = associationsArray;
    
    // Save cache when we add a new entry (only every 3 API calls to prevent excessive file writes)
    if (apiCallCounter % 3 === 0) {
      console.log(`Periodic cache save at API call #${apiCallCounter}`);
      await saveAssociationCache();
    }
    
    return wordOnlyArray;
  } catch (error) {
    console.error('Error getting AI associations:', error);
    throw error;
  }
}

// Get associations with cache
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
    throw error;
  }
}

// Helper function to check if a word is a valid target
// Since we're filtering out visited words at each step, we only need to verify
// that the candidate target is associated with the LAST word in the path.
async function isValidTargetWord(candidateTarget, previousWords) {
  // For a valid target, we only need to confirm it's connected to the last word in the path
  if (previousWords.length === 0) {
    return true; // No previous words to check
  }
  
  // Get the last word in the previous words
  const lastWord = previousWords[previousWords.length - 1];
  const key = lastWord.toLowerCase().trim();
  
  // Get associations for the last word
  let associations;
  if (associationCache[key]) {
    associations = associationCache[key];
  } else {
    try {
      console.log(`Getting associations for last word: ${lastWord}`);
      associations = await getAssociations(lastWord);
    } catch (error) {
      console.error(`Error getting associations for "${lastWord}":`, error);
      return false; // Can't verify, so not valid
    }
  }
  
  // Check if candidate is in the last word's associations
  const normalizedCandidate = candidateTarget.toLowerCase().trim();
  const isConnected = associations.some(assoc => assoc.toLowerCase().trim() === normalizedCandidate);
  
  if (isConnected) {
    console.log(`✓ VALID TARGET: "${candidateTarget}" is connected to last word "${lastWord}"`);
    return true; // Valid - connected to last word
  } else {
    console.log(`✗ INVALID TARGET: "${candidateTarget}" is not directly connected to "${lastWord}"`);
    return false;
  }
}

// Helper function to find a path through the word association graph
async function findPathThroughGraph(startWord) {
  console.log(`Starting path search from "${startWord}"`);
  
  // Define parameters
  const MIN_PATH_LENGTH = 5; // at least 5 words total (4 steps) - balanced for path finding
  const MAX_DEPTH = 10;      // increased to allow deeper exploration
  const MAX_EXPLORATIONS = 250; // increased to allow more exploration with stricter path requirements
  
  // Early abort check to save cache if we're close to API limit
  if (apiCallCounter > API_CALL_LIMIT * 0.8) {
    console.warn(`⚠️ Approaching API call limit (${apiCallCounter}/${API_CALL_LIMIT}). Saving cache and proceeding with caution.`);
    await saveAssociationCache(); // Save what we have so far
  }
  
  // Set up error handling for the entire function
  try {
  
  // Initialize path with start word
  const initialPath = [startWord];
  
  // Get associations for the start word
  console.log(`Getting associations for start word: ${startWord}`);
  const startAssociations = await getAssociations(startWord);
  console.log(`Cached ${startAssociations.length} associations for ${startWord}`);
  
  // Queue for breadth-first traversal
  const queue = [{
    path: initialPath,
    depth: 1
  }];
  
  // Keep track of visited words
  const visited = new Set([startWord.toLowerCase().trim()]);
  
  // Track exploration stats
  let explored = 0;
  let validTargetsChecked = 0;
  let pathsAbandoned = 0; // Track paths abandoned due to low diversity
  
  // Process the queue for breadth-first traversal
  while (queue.length > 0 && explored < MAX_EXPLORATIONS) {
    // Get the next path to explore
    const { path, depth } = queue.shift();
    const currentWord = path[path.length - 1];
    
    explored++;
    
    // Log progress with more detail
    if (explored % 10 === 0) {
      console.log(`Explored ${explored}/${MAX_EXPLORATIONS} paths, queue size: ${queue.length}, targets checked: ${validTargetsChecked}`);
      // Log current path if available
      if (path.length > 1) {
        console.log(`Current path (${path.length} words): ${path.join(' → ')}`);
      }
    }
        
    // If we've reached AT LEAST the minimum depth required, this could be a target word
    // Accept paths that are at least MIN_PATH_LENGTH to find more valid paths
    if (path.length >= MIN_PATH_LENGTH) {
      validTargetsChecked++;
      
      // Debug info about path length
      console.log(`Validating potential target "${currentWord}" at depth ${depth} (path length: ${path.length})`);
      
      // Check if we're at API limit before validation
      if (apiCallCounter >= API_CALL_LIMIT) {
        console.warn(`⚠️ API call limit of ${API_CALL_LIMIT} reached during target validation. Saving cache and aborting.`);
        await saveAssociationCache(); // Emergency save
        return null; // Stop the search
      }
      
      // Check if this word would be a good target
      const isValidTarget = await isValidTargetWord(currentWord, path.slice(0, -1));
      
      if (isValidTarget) {
        console.log(`====== FOUND VALID SOLUTION PATH ======`);
        console.log(`✓ Target word: "${currentWord}"`);
        console.log(`✓ Path length: ${path.length} words (${path.length-1} steps)`);
        console.log(`✓ Full path: ${path.join(' → ')}`);
        console.log(`======================================`);
        
        // Save cache when we find a solution
        await saveAssociationCache();
        return { path, targetWord: currentWord };
      }
    }
    
    // Stop exploring this path if we've reached max depth
    if (depth >= MAX_DEPTH) {
      continue;
    }
    
    // Get associations for the current word
    let associations;
    try {
      // Check if we're over the API limit before making a potential API call
      if (apiCallCounter >= API_CALL_LIMIT) {
        console.warn(`⚠️ API call limit of ${API_CALL_LIMIT} reached. Saving cache and aborting path search.`);
        await saveAssociationCache(); // Emergency save
        return null; // Stop the search
      }
      
      // Check if we already have associations in cache first
      const key = currentWord.toLowerCase().trim();
      if (associationCache[key]) {
        associations = associationCache[key];
      } else {
        // Otherwise, fetch new associations
        console.log(`Getting associations for: ${currentWord}`);
        associations = await getAssociations(currentWord);
        console.log(`Cached ${associations.length} associations for ${currentWord}`);
        
        // Save cache after every 5 new API calls
        if (apiCallCounter % 5 === 0) {
          console.log(`Incremental cache save at ${apiCallCounter} API calls`);
          await saveAssociationCache(); // Periodic save
        }
      }
    } catch (error) {
      if (error.message && error.message.includes('API call limit')) {
        console.warn(`⚠️ ${error.message}`);
        await saveAssociationCache(); // Emergency save
        return null; // Stop the search
      }
      console.error(`Error getting associations for "${currentWord}":`, error);
      continue; // Skip this word if we can't get associations
    }
    
    // Filter to avoid visited words
    const validNextWords = associations.filter(word => {
      const normalizedWord = word.toLowerCase().trim();
      return !visited.has(normalizedWord);
    });
    
    // Extra logging about potential paths
    if (depth >= MIN_PATH_LENGTH - 2) {
      console.log(`At depth ${depth}, path: ${path.join(' → ')}`);
      console.log(`Found ${validNextWords.length} potential next words: ${validNextWords.join(', ')}`);
    }
    
    // Skip if we have fewer than 3 new associations (ensures path diversity)
    if (validNextWords.length < 3) {
      pathsAbandoned++;
      console.log(`Abandoning path at "${currentWord}" - only ${validNextWords.length} new associations remain [${pathsAbandoned} abandoned]`);
      continue;
    }
    
    // Add each valid next word to queue (limit for breadth control)
    const nextWords = validNextWords.slice(0, 5); // Increased to 5 since we're stricter about path quality
    for (const nextWord of nextWords) {
      const normalizedWord = nextWord.toLowerCase().trim();
      visited.add(normalizedWord); // Mark as visited
      
      // Create a new path by adding this word
      const newPath = [...path, nextWord];
      queue.push({
        path: newPath,
        depth: depth + 1
      });
    }
  }
  
  // If we're here, we didn't find a valid path
  console.log(`No valid path found from "${startWord}" after exploring ${explored} paths, abandoning ${pathsAbandoned} for diversity reasons`);
  return null;
    
  } catch (error) {
    // Save cache before re-throwing the error
    console.error(`Error during path finding: ${error.message}`);
    console.warn("Saving cache before handling error...");
    await saveAssociationCache();
    throw error; // Re-throw after saving
  }
}

// Function to generate a puzzle
async function generatePuzzle() {
  try {
    console.log("Generating new puzzle using graph traversal approach...");
    
    // Step 1: Get a seed word from cache or use default
    let seedWord;
    
    // Get all real words from the cache (not metadata/detailed entries)
    const cacheWords = Object.keys(associationCache).filter(key => !key.includes('_detailed'));
    
    if (cacheWords.length > 0) {
      // Choose a random word from the cache
      seedWord = cacheWords[Math.floor(Math.random() * cacheWords.length)];
      console.log(`Using random word from cache: "${seedWord}"`);
    } else {
      // Default word if cache is empty
      seedWord = "environment";
      console.log(`Cache is empty, using default word: "${seedWord}"`);
    }
    
    console.log(`Using seed word: ${seedWord}`);
    
    // Save what we have so far
    await saveAssociationCache();
    
    // Step 2: Find a valid path from this seed word
    const result = await findPathThroughGraph(seedWord);
    
    // Handle case where path finding failed
    if (!result) {
      // Save cache before exiting
      await saveAssociationCache();
      
      // Throw appropriate error
      if (apiCallCounter >= API_CALL_LIMIT) {
        throw new Error(`API call limit (${API_CALL_LIMIT}) reached during path finding. Cache has been saved with ${Object.keys(associationCache).length} entries.`);
      } else {
        throw new Error(`Failed to find a valid path from "${seedWord}". Cache has been saved with ${Object.keys(associationCache).length} entries.`);
      }
    }
    
    const validPath = result.path;
    const targetWord = result.targetWord;
    
    console.log(`Final path: ${validPath.join(' → ')}`);
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
    apiCallCounter++;

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
    
    // Create the final puzzle object
    const puzzle = {
      startWord: seedWord,
      targetWord: targetWord,
      theme: themeData.theme,
      description: themeData.description || "",
      difficulty: themeData.difficulty || "hard",
      hiddenSolution: validPath,
      minExpectedSteps: validPath.length - 1,
      gameDate: new Date().toISOString().split('T')[0]
    };
    
    // Print results
    console.log("\n=== PUZZLE GENERATED SUCCESSFULLY ===");
    console.log(`Start word: ${puzzle.startWord}`);
    console.log(`Target word: ${puzzle.targetWord}`);
    console.log(`Theme: ${puzzle.theme} (${puzzle.difficulty})`);
    console.log(`Description: ${puzzle.description}`);
    console.log(`Path: ${puzzle.hiddenSolution.join(' → ')}`);
    console.log(`Min steps: ${puzzle.minExpectedSteps}`);
    console.log(`Total API calls: ${apiCallCounter}`);
    
    // Print cache stats
    console.log(`\nCache stats:`);
    console.log(`- Cache size: ${Object.keys(associationCache).length} entries`);
    console.log(`- Cache hits: ${cacheStats.hits}`);
    console.log(`- Cache misses: ${cacheStats.misses}`);
    
    return puzzle;
  } catch (error) {
    console.error('Error generating puzzle:', error);
    throw error;
  }
}

// Main function
async function main() {
  try {
    console.log(`Starting puzzle generation with API call limit: ${API_CALL_LIMIT}`);
    
    // Load existing cache if available
    await loadAssociationCache();
    console.log(`Initial cache size: ${Object.keys(associationCache).length} entries`);
    
    // Generate a puzzle
    const puzzle = await generatePuzzle();
    
    // Save updated cache to disk (final save)
    await saveAssociationCache();
    
    // Save the completed puzzle to a file
    const puzzlePath = path.join(__dirname, '..', 'data', 'generated-puzzle.json');
    await writeFileAsync(puzzlePath, JSON.stringify(puzzle, null, 2), 'utf8');
    console.log(`Puzzle saved to ${puzzlePath}`);
    
    // Summary
    console.log(`\n=== EXECUTION SUMMARY ===`);
    console.log(`API calls made: ${apiCallCounter}/${API_CALL_LIMIT}`);
    console.log(`Final cache size: ${Object.keys(associationCache).length} entries`);
    console.log(`Cache hits: ${cacheStats.hits}, misses: ${cacheStats.misses}`);
    
    return puzzle;
  } catch (error) {
    console.error('Failed to generate puzzle:', error);
    
    // Only save the cache if the error doesn't already mention cache saving
    if (!error.message || !error.message.includes("Cache has been saved")) {
      console.warn("Ensuring cache is saved before exit...");
      try {
        await saveAssociationCache();
        console.log(`Cache saved with ${Object.keys(associationCache).length} entries despite error`);
      } catch (saveError) {
        console.error("Failed to save cache during error handling:", saveError);
      }
    }
    
    // Exit with error code to indicate failure
    process.exit(1);
  }
}

// Run the script
main();