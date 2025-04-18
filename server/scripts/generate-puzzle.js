// Standalone script to generate a puzzle and populate the association cache
// Run with: node scripts/generate-puzzle.js [API_CALL_LIMIT]

const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); // Load environment variables from server/.env file
const Anthropic = require('@anthropic-ai/sdk');

// Import shared puzzle generator
const puzzleGenerator = require('../lib/puzzle-generator');

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

// Path for generated puzzle file
const PUZZLE_FILE_PATH = path.join(__dirname, '..', 'data', 'generated-puzzle.json');

// Promisify fs functions
const writeFileAsync = promisify(fs.writeFile);

// API call counter to track usage
let apiCallCounter = 0;

// Get API limit from command line argument or use default
const API_CALL_LIMIT = process.argv[2] ? parseInt(process.argv[2], 10) : 100;
console.log(`Setting API call limit to: ${API_CALL_LIMIT}`);

// API call callback
function onApiCallMade() {
  apiCallCounter++;
  console.log(`API Call #${apiCallCounter}`);
  
  // Check if we've hit the limit
  if (apiCallCounter > API_CALL_LIMIT) {
    throw new Error(`API call limit of ${API_CALL_LIMIT} reached. Stopping to prevent excessive usage.`);
  }
}

// Main function
async function main() {
  let associationCache = {};
  
  try {
    console.log(`Starting puzzle generation with API call limit: ${API_CALL_LIMIT}`);
    
    // Load existing cache if available
    associationCache = await puzzleGenerator.loadAssociationCache();
    console.log(`Initial cache size: ${Object.keys(associationCache).length} entries`);
    
    // Generate a puzzle
    const puzzle = await puzzleGenerator.generatePuzzle(
      associationCache, 
      anthropic, 
      onApiCallMade
    );
    
    // Save updated cache to disk (final save)
    await puzzleGenerator.saveAssociationCache(associationCache);
    
    // Save the completed puzzle to a file
    await writeFileAsync(PUZZLE_FILE_PATH, JSON.stringify(puzzle, null, 2), 'utf8');
    console.log(`Puzzle saved to ${PUZZLE_FILE_PATH}`);
    
    // Summary
    console.log(`\n=== EXECUTION SUMMARY ===`);
    console.log(`API calls made: ${apiCallCounter}/${API_CALL_LIMIT}`);
    console.log(`Final cache size: ${Object.keys(associationCache).length} entries`);
    console.log(`Cache hits: ${puzzleGenerator.cacheStats.hits}, misses: ${puzzleGenerator.cacheStats.misses}`);
    
    return puzzle;
  } catch (error) {
    console.error('Failed to generate puzzle:', error);
    
    // Save the cache before exit
    try {
      // Make sure we have a valid associationCache to save
      if (associationCache && Object.keys(associationCache).length > 0) {
        console.warn("Ensuring cache is saved before exit...");
        await puzzleGenerator.saveAssociationCache(associationCache);
        console.log(`Cache saved with ${Object.keys(associationCache).length} entries despite error`);
      }
    } catch (saveError) {
      console.error("Failed to save cache during error handling:", saveError);
    }
    
    // Exit with error code to indicate failure
    process.exit(1);
  }
}

// Run the script
main();