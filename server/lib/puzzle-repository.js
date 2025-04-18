/**
 * Puzzle repository module for saving and loading puzzles
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

// Promisify fs functions
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);
const readdirAsync = promisify(fs.readdir);

// Path for saved puzzles
const PUZZLES_DIR = path.join(__dirname, '..', 'data', 'puzzles');

// Ensure the puzzles directory exists
async function ensurePuzzlesDir() {
  try {
    await mkdirAsync(PUZZLES_DIR, { recursive: true });
    return true;
  } catch (error) {
    console.error('Error creating puzzles directory:', error);
    return false;
  }
}

// Save a puzzle to the repository
async function savePuzzle(puzzle) {
  try {
    // Make sure the puzzle is valid
    if (!puzzle || !puzzle.startWord || !puzzle.targetWord || !puzzle.hiddenSolution) {
      throw new Error('Invalid puzzle format - missing required properties');
    }
    
    // Make sure the directory exists
    await ensurePuzzlesDir();
    
    // Generate a filename based on date, start word, and target word
    const dateStr = puzzle.gameDate || new Date().toISOString().split('T')[0];
    const filename = `${dateStr}_${puzzle.startWord}_${puzzle.targetWord}.json`;
    const filePath = path.join(PUZZLES_DIR, filename);
    
    // Save the puzzle
    await writeFileAsync(filePath, JSON.stringify(puzzle, null, 2), 'utf8');
    console.log(`Puzzle saved to repository: ${filename}`);
    
    return { success: true, filename };
  } catch (error) {
    console.error('Error saving puzzle to repository:', error);
    return { success: false, error: error.message };
  }
}

// Load a specific puzzle by filename
async function loadPuzzleByFilename(filename) {
  try {
    const filePath = path.join(PUZZLES_DIR, filename);
    const data = await readFileAsync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error loading puzzle ${filename}:`, error);
    return null;
  }
}

// Get a random saved puzzle
async function getRandomPuzzle() {
  try {
    // Make sure the directory exists
    await ensurePuzzlesDir();
    
    // Get all puzzle files
    const files = await readdirAsync(PUZZLES_DIR);
    const puzzleFiles = files.filter(file => file.endsWith('.json'));
    
    if (puzzleFiles.length === 0) {
      console.log('No saved puzzles found in repository');
      return null;
    }
    
    // Select a random puzzle
    const randomFile = puzzleFiles[Math.floor(Math.random() * puzzleFiles.length)];
    return await loadPuzzleByFilename(randomFile);
  } catch (error) {
    console.error('Error getting random puzzle:', error);
    return null;
  }
}

// List all available puzzles
async function listPuzzles() {
  try {
    // Make sure the directory exists
    await ensurePuzzlesDir();
    
    // Get all puzzle files
    const files = await readdirAsync(PUZZLES_DIR);
    const puzzleFiles = files.filter(file => file.endsWith('.json'));
    
    return puzzleFiles;
  } catch (error) {
    console.error('Error listing puzzles:', error);
    return [];
  }
}

// Get a fallback puzzle (newest if available)
async function getFallbackPuzzle() {
  try {
    // Make sure the directory exists
    await ensurePuzzlesDir();
    
    // Get all puzzle files
    const files = await readdirAsync(PUZZLES_DIR);
    const puzzleFiles = files.filter(file => file.endsWith('.json'));
    
    if (puzzleFiles.length === 0) {
      console.log('No saved puzzles found for fallback');
      return null;
    }
    
    // Sort by date (assuming filename starts with date)
    puzzleFiles.sort().reverse(); // Newest first
    
    // Get the newest puzzle
    return await loadPuzzleByFilename(puzzleFiles[0]);
  } catch (error) {
    console.error('Error getting fallback puzzle:', error);
    return null;
  }
}

module.exports = {
  savePuzzle,
  loadPuzzleByFilename,
  getRandomPuzzle,
  listPuzzles,
  getFallbackPuzzle,
  PUZZLES_DIR
};