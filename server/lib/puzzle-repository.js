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
    
    // Get current date and time for timestamping
    const now = new Date();
    const dateStr = puzzle.gameDate || now.toISOString().split('T')[0];
    
    // Format time as HH-MM-SS
    const timeStr = now.toISOString().split('T')[1].substring(0, 8).replace(/:/g, '-');
    
    // Generate a filename based on date, time, start word, and target word
    const filename = `${dateStr}_${timeStr}_${puzzle.startWord}_${puzzle.targetWord}.json`;
    const filePath = path.join(PUZZLES_DIR, filename);
    
    // Add timestamp to puzzle data
    const puzzleWithTimestamp = {
      ...puzzle,
      generatedAt: now.toISOString(),
      timestamp: now.getTime()
    };
    
    // Save the puzzle with timestamp
    await writeFileAsync(filePath, JSON.stringify(puzzleWithTimestamp, null, 2), 'utf8');
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
    console.log(`Using random puzzle file: ${randomFile}`);
    
    const puzzle = await loadPuzzleByFilename(randomFile);
    
    // Validate puzzle data before returning
    if (puzzle && puzzle.startWord && puzzle.targetWord) {
      // Log timestamp information if available
      if (puzzle.generatedAt) {
        console.log(`Puzzle was generated at: ${puzzle.generatedAt}`);
      }
      
      // Verify that hiddenSolution is properly formed - this is critical
      if (!Array.isArray(puzzle.hiddenSolution) || puzzle.hiddenSolution.length < 2) {
        console.warn(`Warning: Puzzle ${randomFile} has invalid hiddenSolution - creating fallback path`);
        // Create a minimal valid path from start to target
        puzzle.hiddenSolution = [puzzle.startWord, puzzle.targetWord];
        // Also update minExpectedSteps to match path length
        puzzle.minExpectedSteps = 1;
      } else {
        console.log(`Hidden path: ${puzzle.hiddenSolution.join(' → ')}`);
        // Make sure minExpectedSteps is consistent with the path
        if (puzzle.minExpectedSteps === undefined || puzzle.minExpectedSteps === null) {
          puzzle.minExpectedSteps = puzzle.hiddenSolution.length - 1;
          console.log(`Set missing minExpectedSteps to ${puzzle.minExpectedSteps}`);
        }
      }
      
      return puzzle;
    } else {
      console.warn(`Warning: Invalid puzzle data in ${randomFile}`);
      return null;
    }
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
    
    // Sort by timestamp in filename - our new format is YYYY-MM-DD_HH-MM-SS_*
    // This will order newest first, even with the updated filename format
    puzzleFiles.sort().reverse();
    
    // Optionally log the newest file
    if (puzzleFiles.length > 0) {
      console.log(`Using newest puzzle file: ${puzzleFiles[0]}`);
    }
    
    // Try to get a valid puzzle from the most recent files
    // If the first one is invalid, try others until we find a valid one
    for (let i = 0; i < Math.min(puzzleFiles.length, 5); i++) {
      const puzzle = await loadPuzzleByFilename(puzzleFiles[i]);
      
      // Validate the puzzle
      if (puzzle && puzzle.startWord && puzzle.targetWord) {
        // Verify that hiddenSolution is properly formed
        if (!Array.isArray(puzzle.hiddenSolution) || puzzle.hiddenSolution.length < 2) {
          console.warn(`Warning: Fallback puzzle ${puzzleFiles[i]} has invalid hiddenSolution - creating fallback path`);
          // Create a minimal valid path
          puzzle.hiddenSolution = [puzzle.startWord, puzzle.targetWord];
          puzzle.minExpectedSteps = 1;
        } else {
          console.log(`Fallback puzzle hidden path: ${puzzle.hiddenSolution.join(' → ')}`);
          // Make sure minExpectedSteps is consistent with the path
          if (puzzle.minExpectedSteps === undefined || puzzle.minExpectedSteps === null) {
            puzzle.minExpectedSteps = puzzle.hiddenSolution.length - 1;
            console.log(`Set missing minExpectedSteps to ${puzzle.minExpectedSteps}`);
          }
        }
        
        return puzzle;
      } else {
        console.warn(`Warning: Invalid fallback puzzle data in ${puzzleFiles[i]}, trying next file`);
      }
    }
    
    console.warn(`Failed to find any valid fallback puzzles after checking ${Math.min(puzzleFiles.length, 5)} files`);
    return null;
  } catch (error) {
    console.error('Error getting fallback puzzle:', error);
    return null;
  }
}

// Get a puzzle from the current hour, or null if none exists
async function getPuzzleFromCurrentHour() {
  try {
    // Make sure the directory exists
    await ensurePuzzlesDir();
    
    // Get current date and hour
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const currentHour = now.getHours();
    
    // Get all puzzle files
    const files = await readdirAsync(PUZZLES_DIR);
    const puzzleFiles = files.filter(file => file.endsWith('.json'));
    
    // Sort newest first
    puzzleFiles.sort().reverse();
    
    // Look through files to find one from the current hour
    for (const file of puzzleFiles) {
      const puzzle = await loadPuzzleByFilename(file);
      
      if (puzzle && puzzle.generatedAt) {
        const puzzleTime = new Date(puzzle.generatedAt);
        const puzzleDate = puzzleTime.toISOString().split('T')[0];
        const puzzleHour = puzzleTime.getHours();
        
        // Check if puzzle is from the current date and hour
        if (puzzleDate === currentDate && puzzleHour === currentHour) {
          console.log(`Found puzzle from current hour (${currentHour}:00): ${file}`);
          
          // Validate puzzle data before returning
          if (puzzle && puzzle.startWord && puzzle.targetWord) {
            // Verify that hiddenSolution is properly formed - this is critical
            if (!Array.isArray(puzzle.hiddenSolution) || puzzle.hiddenSolution.length < 2) {
              console.warn(`Warning: Puzzle ${file} has invalid hiddenSolution - creating fallback path`);
              // Create a minimal valid path from start to target
              puzzle.hiddenSolution = [puzzle.startWord, puzzle.targetWord];
              // Also update minExpectedSteps to match path length
              puzzle.minExpectedSteps = 1;
            } else {
              console.log(`Hidden path: ${puzzle.hiddenSolution.join(' → ')}`);
              // Make sure minExpectedSteps is consistent with the path
              if (puzzle.minExpectedSteps === undefined || puzzle.minExpectedSteps === null) {
                puzzle.minExpectedSteps = puzzle.hiddenSolution.length - 1;
                console.log(`Set missing minExpectedSteps to ${puzzle.minExpectedSteps}`);
              }
            }
            
            return puzzle;
          } else {
            console.warn(`Warning: Invalid puzzle data in ${file}`);
            continue; // Try the next file
          }
        }
      }
    }
    
    console.log(`No puzzle found from current hour (${currentHour}:00)`);
    return null;
  } catch (error) {
    console.error('Error finding puzzle from current hour:', error);
    return null;
  }
}

// Get recent puzzles, sorted by generation time
async function getRecentPuzzles(limit = 5) {
  try {
    // Make sure the directory exists
    await ensurePuzzlesDir();
    
    // Get all puzzle files
    const files = await readdirAsync(PUZZLES_DIR);
    const puzzleFiles = files.filter(file => file.endsWith('.json'));
    
    // Sort newest first
    puzzleFiles.sort().reverse();
    
    // Limit the number of files
    const recentFiles = puzzleFiles.slice(0, limit);
    
    // Load each puzzle
    const puzzles = [];
    for (const file of recentFiles) {
      const puzzle = await loadPuzzleByFilename(file);
      if (puzzle) {
        puzzles.push({
          filename: file,
          puzzle: puzzle
        });
      }
    }
    
    return puzzles;
  } catch (error) {
    console.error('Error getting recent puzzles:', error);
    return [];
  }
}

module.exports = {
  savePuzzle,
  loadPuzzleByFilename,
  getRandomPuzzle,
  listPuzzles,
  getFallbackPuzzle,
  getRecentPuzzles,
  getPuzzleFromCurrentHour,
  PUZZLES_DIR
};