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
          
          If you cannot come up with at least 5 good word associations, include "__ERROR__" as one of the words.
          
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
async function isValidTargetWord(candidateTarget, previousWords) {
  // Check if candidate target appears in associations of previous words
  for (const word of previousWords) {
    const key = word.toLowerCase().trim();
    let associations;
    
    // Get associations if they exist in cache, otherwise fetch them
    if (associationCache[key]) {
      associations = associationCache[key];
    } else {
      try {
        console.log(`Getting associations for previous word: ${word}`);
        associations = await getAssociations(word);
      } catch (error) {
        console.error(`Error getting associations for "${word}":`, error);
        continue; // Skip this word if we can't get associations
      }
    }
    
    // If candidate target is directly associated with this previous word,
    // it's not a valid target (would create a shortcut)
    const normalizedCandidate = candidateTarget.toLowerCase().trim();
    if (associations.some(assoc => assoc.toLowerCase().trim() === normalizedCandidate)) {
      console.log(`Candidate target "${candidateTarget}" appears in associations of "${word}" - not valid`);
      return false;
    }
  }
  
  // If we get here, the candidate is valid
  return true;
}

// Helper function to find a path through the word association graph
async function findPathThroughGraph(startWord) {
  console.log(`Starting path search from "${startWord}"`);
  
  // Define parameters
  const MIN_PATH_LENGTH = 4; // at least 4 words total (3 steps)
  const MAX_DEPTH = 6;       // don't go too deep in the graph
  const MAX_EXPLORATIONS = 50; // limit explorations to prevent excessive API calls
  
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
  
  // Process the queue for breadth-first traversal
  while (queue.length > 0 && explored < MAX_EXPLORATIONS) {
    // Get the next path to explore
    const { path, depth } = queue.shift();
    const currentWord = path[path.length - 1];
    
    explored++;
    
    // Log progress
    if (explored % 10 === 0) {
      console.log(`Explored ${explored}/${MAX_EXPLORATIONS} paths, queue size: ${queue.length}, targets checked: ${validTargetsChecked}`);
    }
        
    // If we've reached sufficient depth, this could be a target word
    if (depth >= MIN_PATH_LENGTH - 1) { // -1 because path length = depth + 1
      validTargetsChecked++;
      
      // Check if we're at API limit before validation
      if (apiCallCounter >= API_CALL_LIMIT) {
        console.warn(`⚠️ API call limit of ${API_CALL_LIMIT} reached during target validation. Saving cache and aborting.`);
        await saveAssociationCache(); // Emergency save
        return null; // Stop the search
      }
      
      // Check if this word would be a good target
      const isValidTarget = await isValidTargetWord(currentWord, path.slice(0, -1));
      
      if (isValidTarget) {
        console.log(`Found valid target word "${currentWord}" at depth ${depth}`);
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
    
    // Skip if dead end
    if (validNextWords.length === 0) {
      continue;
    }
    
    // Add each valid next word to queue (limit to 3 for breadth control)
    const nextWords = validNextWords.slice(0, 3); // Take at most 3 words to limit branching
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
  console.log(`No valid path found from "${startWord}" after exploring ${explored} paths`);
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
    
        // Step 1: Generate a random seed word
    // Check API limits first
    if (apiCallCounter >= API_CALL_LIMIT) {
      // Save cache before exiting
      await saveAssociationCache();
      throw new Error(`API call limit (${API_CALL_LIMIT}) reached before generating seed word`);
    }
    
    // Generate seed word
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
          3. Be a single word (not a phrase)
          4. Be varied and distinct from recent themes, choose something creative
          
          Return ONLY the word as plain text, nothing else.`
        }
      ]
    });
    apiCallCounter++;
    
    // Get the seed word and trim any whitespace
    const seedWord = seedWordMessage.content[0].text.trim();
    
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