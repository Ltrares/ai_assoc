/**
 * Shared puzzle generator module - used by both the server and the offline puzzle generation script
 */

const { promisify } = require('util');
const path = require('path');
const fs = require('fs');

// Path for cache file
const CACHE_FILE_PATH = path.join(__dirname, '..', 'data', 'association-cache.json');

// Promisify fs functions
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const mkdirAsync = promisify(fs.mkdir);

// Cache stats for monitoring
const cacheStats = {
  hits: 0,
  misses: 0,
  lastSaved: null
};

// API utility function
async function getAssociationsFromAI(anthropic, word, onApiCallMade) {
  try {
    // If there's a callback for API tracking, call it
    if (typeof onApiCallMade === 'function') {
      onApiCallMade();
    }
    
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `Give me 5-10 common word associations for "${word}" that most people would naturally think of.
          
          Return a JSON array with EXACTLY this format:
          [
            {"word": "association1", "hint": "brief explanation"},
            {"word": "association2", "hint": "brief explanation"}
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
      item.word.trim() !== '' &&
      typeof item.hint === 'string'
    );
    
    if (validItems.length < 3) {
      throw new Error(`Too few valid associations for "${word}" (${validItems.length}). Need at least 3 associations.`);
    }
    
    associationsArray = validItems;
    
    // Extract just the words for backward compatibility
    const wordOnlyArray = associationsArray.map(item => item.word);
    
    return {
      wordArray: wordOnlyArray,
      detailedArray: associationsArray
    };
  } catch (error) {
    console.error('Error getting AI associations:', error);
    throw error;
  }
}

// Cache management functions
async function saveAssociationCache(associationCache) {
  try {
    // Ensure the data directory exists
    await mkdirAsync(path.dirname(CACHE_FILE_PATH), { recursive: true }).catch(() => {});
    
    // Save cache to file
    await writeFileAsync(CACHE_FILE_PATH, JSON.stringify(associationCache, null, 2), 'utf8');
    
    // Update last saved timestamp
    cacheStats.lastSaved = new Date();
    
    console.log(`Association cache saved to ${CACHE_FILE_PATH} (${Object.keys(associationCache).length} entries)`);
    return true;
  } catch (error) {
    console.error('Error saving association cache:', error);
    return false;
  }
}

async function loadAssociationCache() {
  try {
    // Check if cache file exists
    if (!fs.existsSync(CACHE_FILE_PATH)) {
      console.log(`No cache file found at ${CACHE_FILE_PATH}. Starting with empty cache.`);
      return {};
    }
    
    // Read and parse cache file
    const data = await readFileAsync(CACHE_FILE_PATH, 'utf8');
    const loadedCache = JSON.parse(data);
    
    // Validate and use the loaded cache
    if (loadedCache && typeof loadedCache === 'object') {
      console.log(`Association cache loaded from ${CACHE_FILE_PATH} (${Object.keys(loadedCache).length} entries)`);
      return loadedCache;
    } else {
      console.error('Invalid cache file format. Starting with empty cache.');
      return {};
    }
  } catch (error) {
    console.error('Error loading association cache:', error);
    return {};
  }
}

// Get associations with caching
async function getAssociations(associationCache, word, anthropic, onApiCallMade) {
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
    
    const result = await getAssociationsFromAI(anthropic, normalizedWord, onApiCallMade);
    
    // Cache both versions for future use
    associationCache[normalizedWord] = result.wordArray;
    associationCache[`${normalizedWord}_detailed`] = result.detailedArray;
    
    return result.wordArray;
  } catch (error) {
    console.error('Error in getAssociations:', error);
    throw error;
  }
}

// Helper function to check if a word is a valid target
async function isValidTargetWord(associationCache, candidateTarget, previousWords, anthropic, onApiCallMade) {
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
      associations = await getAssociations(associationCache, lastWord, anthropic, onApiCallMade);
    } catch (error) {
      console.error(`Error getting associations for "${lastWord}":`, error);
      
      // Check if error is due to API limit being reached
      if (error.message && error.message.includes('API call limit')) {
        console.warn(`⚠️ ${error.message} - aborting target validation`);
        throw error; // Rethrow to propagate the API limit error
      }
      
      return false; // Can't verify for other reasons, so not valid
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
// Implements a hybrid approach: Primarily Depth-First Search with periodic breadth prioritization
async function findPathThroughGraph(associationCache, startWord, anthropic, onApiCallMade, abortSignal) {
  console.log(`Starting path search from "${startWord}"`);
  
  // Define parameters
  const MIN_PATH_LENGTH = 5; // at least 5 words total (4 steps) - the minimum acceptable puzzle length
  const MAX_DEPTH = 10;      // maximum path depth to explore - prevents excessive branching
  const MAX_EXPLORATIONS = 250; // maximum number of paths to check - prevents excessive API usage
  
  // Set up error handling for the entire function
  try {
    // Initialize path with start word
    const initialPath = [startWord];
    
    // Get associations for the start word
    console.log(`Getting associations for start word: ${startWord}`);
    const startAssociations = await getAssociations(associationCache, startWord, anthropic, onApiCallMade);
    console.log(`Cached ${startAssociations.length} associations for ${startWord}`);
    
    // Stack for depth-first traversal (last in, first out)
    // Using a stack enables depth-first search which aims to find paths to target depth faster
    const stack = [{
      path: initialPath,
      depth: 1
    }];
    
    // Function to shuffle an array for randomizing exploration
    const shuffle = array => {
      // Fisher-Yates shuffle algorithm
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    };
    
    // Function to prioritize paths to focus on promising ones
    const prioritizeStack = () => {
      if (stack.length > 10) { // Only sort if stack is substantial
        // Sort stack with depth-first priority while also considering target length
        stack.sort((a, b) => {
          // Primary sort: higher depth first (depth-first search)
          const depthDiff = b.depth - a.depth;
          if (depthDiff !== 0) return depthDiff;
          
          // Secondary sort: proximity to target length
          const distA = Math.abs(a.path.length - MIN_PATH_LENGTH);
          const distB = Math.abs(b.path.length - MIN_PATH_LENGTH);
          
          if (a.path.length < MIN_PATH_LENGTH && b.path.length < MIN_PATH_LENGTH) {
            return b.path.length - a.path.length; // Favor longer paths when below minimum
          } else if (a.path.length >= MIN_PATH_LENGTH && b.path.length >= MIN_PATH_LENGTH) {
            return a.path.length - b.path.length; // Favor shorter paths when above minimum
          } else {
            return distA - distB; // Favor paths closer to minimum length
          }
        });
      }
    };
    
    // Keep track of visited words
    const visited = new Set([startWord.toLowerCase().trim()]);
    
    // Track exploration stats
    let explored = 0;
    let validTargetsChecked = 0;
    let pathsAbandoned = 0; // Track paths abandoned due to low diversity
    
    // Process the stack for depth-first traversal
    while (stack.length > 0 && explored < MAX_EXPLORATIONS) {
      // Check for abort signal
      if (abortSignal && abortSignal.aborted) {
        console.log('Path finding aborted by abort signal');
        return null;
      }
      
      // Periodically prioritize the stack to focus on promising paths
      if (explored % 20 === 0 && stack.length > 5) {
        prioritizeStack();
      }
      
      // Get the next path to explore (from the top of the stack for DFS)
      const { path, depth } = stack.pop();
      const currentWord = path[path.length - 1];
      
      explored++;
      
      // Log progress with more detail
      if (explored % 10 === 0) {
        console.log(`Explored ${explored}/${MAX_EXPLORATIONS} paths, stack size: ${stack.length}, targets checked: ${validTargetsChecked}`);
        // Log current path if available
        if (path.length > 1) {
          console.log(`Current path (${path.length} words): ${path.join(' → ')}`);
        }
      }
          
      // If we've reached AT LEAST the minimum length required, consider this as a target
      // Paths of at least MIN_PATH_LENGTH are valid puzzles - we're just checking if current word works as a target
      if (path.length >= MIN_PATH_LENGTH) {
        validTargetsChecked++;
        
        // Debug info about path length
        console.log(`Validating potential target "${currentWord}" at depth ${depth} (path length: ${path.length})`);
        
        try {
          // Check if this word would be a good target
          const isValidTarget = await isValidTargetWord(associationCache, currentWord, path.slice(0, -1), anthropic, onApiCallMade);
          
          if (isValidTarget) {
            console.log(`====== FOUND VALID SOLUTION PATH ======`);
            console.log(`✓ Target word: "${currentWord}"`);
            console.log(`✓ Path length: ${path.length} words (${path.length-1} steps)`);
            console.log(`✓ Full path: ${path.join(' → ')}`);
            console.log(`======================================`);
            
            return { path, targetWord: currentWord };
          }
        } catch (error) {
          // Check if error is due to API limit being reached
          if (error.message && error.message.includes('API call limit')) {
            console.warn(`⚠️ ${error.message} - aborting path search during target validation`);
            return null; // Stop the search completely
          }
          
          console.error(`Error validating target "${currentWord}":`, error);
        }
      }
      
      // Stop exploring this path if we've reached max depth
      if (depth >= MAX_DEPTH) {
        continue;
      }
      
      // Get associations for the current word
      let associations;
      try {
        // Check if we already have associations in cache first
        const key = currentWord.toLowerCase().trim();
        if (associationCache[key]) {
          associations = associationCache[key];
        } else {
          // Otherwise, fetch new associations
          console.log(`Getting associations for: ${currentWord}`);
          associations = await getAssociations(associationCache, currentWord, anthropic, onApiCallMade);
          console.log(`Cached ${associations.length} associations for ${currentWord}`);
        }
      } catch (error) {
        console.error(`Error getting associations for "${currentWord}":`, error);
        
        // Check if error is due to API limit being reached
        if (error.message && error.message.includes('API call limit')) {
          console.warn(`⚠️ ${error.message} - aborting path search`);
          return null; // Stop the search completely
        }
        
        continue; // Skip this word if we can't get associations for other reasons
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
      
      // Add ALL valid next words to the stack, but shuffle them first to avoid bias toward alphabetical ordering
      // In DFS, the order we add items is important since later additions will be explored first
      const shuffledNextWords = shuffle([...validNextWords]);
      
      for (const nextWord of shuffledNextWords) {
        const normalizedWord = nextWord.toLowerCase().trim();
        visited.add(normalizedWord); // Mark as visited
        
        // Create a new path by adding this word
        const newPath = [...path, nextWord];
        
        // Push to stack (for DFS - last in, first out)
        stack.push({
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
    throw error; // Re-throw after saving
  }
}

// Function to generate a puzzle
async function generatePuzzle(associationCache, anthropic, onApiCallMade, abortSignal) {
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
    
    // Step 2: Find a valid path from this seed word
    const result = await findPathThroughGraph(associationCache, seedWord, anthropic, onApiCallMade, abortSignal);
    
    // Handle case where path finding failed
    if (!result) {
      // Throw appropriate error
      throw new Error(`Failed to find a valid path from "${seedWord}".`);
    }
    
    const validPath = result.path;
    const targetWord = result.targetWord;
    
    console.log(`Final path: ${validPath.join(' → ')}`);
    console.log(`Target word: ${targetWord}`);
    
    // Step 3: Generate a theme based on the start and target words
    console.log("Generating theme based on start and target words...");
    if (onApiCallMade) onApiCallMade();
    
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
    
    return puzzle;
  } catch (error) {
    console.error('Error generating puzzle:', error);
    throw error;
  }
}

module.exports = {
  CACHE_FILE_PATH,
  cacheStats,
  loadAssociationCache,
  saveAssociationCache,
  getAssociations,
  getAssociationsFromAI,
  isValidTargetWord,
  findPathThroughGraph,
  generatePuzzle
};