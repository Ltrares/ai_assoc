#!/usr/bin/env node

/**
 * Script to download cache files and puzzles from Heroku app
 * 
 * Usage:
 *   node download-heroku-data.js
 * 
 * Requirements:
 *   - Heroku CLI installed and authenticated
 *   - Access to the Heroku app
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const https = require('https');

// Convert fs functions to promises
const mkdirAsync = promisify(fs.mkdir);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);

// Configuration
const HEROKU_APP_NAME = 'ai-association-game'; // Replace with your Heroku app name
const LOCAL_DATA_DIR = path.join(__dirname, '..', 'data');
const LOCAL_PUZZLES_DIR = path.join(LOCAL_DATA_DIR, 'puzzles');
const BACKUP_DIR = path.join(__dirname, '..', '..', 'heroku_backups');
const CACHE_FILENAME = 'association-cache.json';

// Admin token from environment variable
const ADMIN_TOKEN = process.env.ADMIN_SECRET;

// Ensure all directories exist
async function ensureDirectories() {
  try {
    await mkdirAsync(LOCAL_DATA_DIR, { recursive: true });
    await mkdirAsync(LOCAL_PUZZLES_DIR, { recursive: true });
    await mkdirAsync(BACKUP_DIR, { recursive: true });
    console.log('Directories created/verified successfully');
  } catch (error) {
    console.error('Error creating directories:', error);
    throw error;
  }
}

// Create a timestamped backup directory
function createTimestampDir() {
  const now = new Date();
  const timestamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
  const backupDir = path.join(BACKUP_DIR, timestamp);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.mkdirSync(path.join(backupDir, 'puzzles'), { recursive: true });
  return backupDir;
}

// Backup the current local files before replacing
async function backupLocalFiles(backupDir) {
  console.log('Backing up local files...');
  
  // Backup the cache file if it exists
  const localCachePath = path.join(LOCAL_DATA_DIR, CACHE_FILENAME);
  if (fs.existsSync(localCachePath)) {
    try {
      const cacheContent = await readFileAsync(localCachePath, 'utf8');
      await writeFileAsync(path.join(backupDir, CACHE_FILENAME), cacheContent, 'utf8');
      console.log(`Backed up ${CACHE_FILENAME}`);
    } catch (error) {
      console.error(`Error backing up ${CACHE_FILENAME}:`, error);
    }
  }
  
  // Backup puzzle files if they exist
  if (fs.existsSync(LOCAL_PUZZLES_DIR)) {
    try {
      const puzzleFiles = fs.readdirSync(LOCAL_PUZZLES_DIR);
      for (const file of puzzleFiles) {
        if (file.endsWith('.json')) {
          const content = await readFileAsync(path.join(LOCAL_PUZZLES_DIR, file), 'utf8');
          await writeFileAsync(path.join(backupDir, 'puzzles', file), content, 'utf8');
        }
      }
      console.log(`Backed up ${puzzleFiles.length} puzzle files`);
    } catch (error) {
      console.error('Error backing up puzzle files:', error);
    }
  }
  
  return true;
}

// Get a file using Heroku's one-off dyno
function getFileFromHeroku(remotePath, localPath) {
  try {
    console.log(`Downloading ${remotePath}...`);
    const command = `heroku run "cat ${remotePath}" --app ${HEROKU_APP_NAME}`;
    const content = execSync(command).toString().trim();
    
    // Skip the first line which may contain Heroku run output
    const contentLines = content.split('\n');
    if (contentLines[0].includes('Running') && contentLines[0].includes('on')) {
      contentLines.shift();
    }
    const cleanContent = contentLines.join('\n');
    
    fs.writeFileSync(localPath, cleanContent);
    console.log(`Downloaded and saved to ${localPath}`);
    return true;
  } catch (error) {
    console.error(`Error getting file from Heroku (${remotePath}):`, error.message);
    return false;
  }
}

// Get list of puzzle files from Heroku
function getPuzzleFilesFromHeroku() {
  try {
    console.log('Getting list of puzzle files...');
    const command = `heroku run "ls -1 /app/server/data/puzzles/" --app ${HEROKU_APP_NAME}`;
    const output = execSync(command).toString().trim();
    
    // Skip the first line which contains Heroku run info
    const lines = output.split('\n');
    if (lines[0].includes('Running') && lines[0].includes('on')) {
      lines.shift();
    }
    
    // Filter out any empty lines
    return lines.filter(line => line.trim() !== '' && line.endsWith('.json'));
  } catch (error) {
    console.error('Error getting puzzle files list from Heroku:', error.message);
    return [];
  }
}

// Function to download recent puzzles via API endpoint
async function downloadRecentPuzzlesViaAPI() {
  return new Promise((resolve, reject) => {
    try {
      console.log("Downloading recent puzzles via API...");
      
      // Create URL with auth token
      const url = `https://${HEROKU_APP_NAME}.herokuapp.com/api/admin/recent-puzzles?limit=10${ADMIN_TOKEN ? `&token=${ADMIN_TOKEN}` : ''}`;
      
      // Make the request
      const req = https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', async () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const response = JSON.parse(data);
              
              if (response.puzzles && response.puzzles.length > 0) {
                console.log(`Got ${response.puzzles.length} recent puzzles via API`);
                
                // Get current puzzle via API if available
                const currentPuzzle = response.puzzles[0];
                if (currentPuzzle) {
                  // Attempt to get more details for this puzzle
                  console.log(`Latest puzzle: ${currentPuzzle.startWord} → ${currentPuzzle.targetWord} (${currentPuzzle.theme})`);
                  
                  // If the puzzle has a filename, we can try to get it directly
                  if (currentPuzzle.filename) {
                    const remotePath = `/app/server/data/puzzles/${currentPuzzle.filename}`;
                    const localPath = path.join(LOCAL_PUZZLES_DIR, currentPuzzle.filename);
                    getFileFromHeroku(remotePath, localPath);
                  }
                }
                
                resolve(response.puzzles);
              } else {
                console.log('No puzzles found via API');
                resolve([]);
              }
            } catch (error) {
              console.error('Error parsing API response:', error);
              resolve([]);
            }
          } else {
            console.error(`API returned status code ${res.statusCode}: ${data}`);
            resolve([]);
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('Error making API request:', error);
        resolve([]);
      });
      
      req.end();
    } catch (error) {
      console.error('Error downloading recent puzzles via API:', error);
      resolve([]);
    }
  });
}

// Download the current active puzzle
async function getCurrentActivePuzzle() {
  try {
    console.log("Getting current active puzzle from Heroku...");
    const remotePath = '/app/server/data/generated-puzzle.json';
    const tempPath = path.join(LOCAL_DATA_DIR, 'temp-current-puzzle.json');
    
    if (getFileFromHeroku(remotePath, tempPath)) {
      try {
        const content = await readFileAsync(tempPath, 'utf8');
        const puzzle = JSON.parse(content);
        
        // Check if puzzle data is valid
        if (puzzle && puzzle.startWord && puzzle.targetWord) {
          console.log(`Current active puzzle: ${puzzle.startWord} → ${puzzle.targetWord}`);
          console.log(`Theme: ${puzzle.theme} (${puzzle.difficulty})`);
          
          // Create a timestamped filename based on current puzzle
          const now = new Date();
          // Format time as HH-MM-SS
          const timeStr = now.toISOString().split('T')[1].substring(0, 8).replace(/:/g, '-');
          const dateStr = now.toISOString().split('T')[0];
          const filename = `${dateStr}_${timeStr}_${puzzle.startWord}_${puzzle.targetWord}.json`;
          
          // Add generation timestamp
          const puzzleWithTimestamp = {
            ...puzzle,
            generatedAt: now.toISOString(),
            timestamp: now.getTime()
          };
          
          // Save as a regular puzzle file
          const localPath = path.join(LOCAL_PUZZLES_DIR, filename);
          await writeFileAsync(localPath, JSON.stringify(puzzleWithTimestamp, null, 2));
          console.log(`Current active puzzle saved to: ${filename}`);
          
          // Also save as current-puzzle.json
          const currentPuzzlePath = path.join(LOCAL_DATA_DIR, 'current-puzzle.json');
          await writeFileAsync(currentPuzzlePath, JSON.stringify(puzzleWithTimestamp, null, 2));
          console.log(`Current active puzzle also saved to: current-puzzle.json`);
          
          return puzzleWithTimestamp;
        }
      } catch (error) {
        console.error('Error parsing current puzzle:', error.message);
      }
    }
    return null;
  } catch (error) {
    console.error('Error getting current active puzzle:', error.message);
    return null;
  }
}

// Main function to download and update files
async function downloadAndUpdateFiles() {
  try {
    console.log(`Starting download from Heroku app: ${HEROKU_APP_NAME}`);
    
    // Ensure all necessary directories exist
    await ensureDirectories();
    
    // Create a backup of current local files
    const backupDir = createTimestampDir();
    await backupLocalFiles(backupDir);
    
    // Try to get recent puzzles via API first
    const recentPuzzles = await downloadRecentPuzzlesViaAPI();
    
    // Get current active puzzle directly from Heroku's memory
    const currentPuzzle = await getCurrentActivePuzzle();
    
    // Traditional file download
    console.log('Continuing with traditional file download...');
    
    // Download the association cache
    const remoteCachePath = '/app/server/data/association-cache.json';
    const localCachePath = path.join(LOCAL_DATA_DIR, CACHE_FILENAME);
    getFileFromHeroku(remoteCachePath, localCachePath);
    
    // Get list of puzzle files from Heroku
    const puzzleFiles = getPuzzleFilesFromHeroku();
    console.log(`Found ${puzzleFiles.length} puzzle files on Heroku's filesystem`);
    
    // Download each puzzle file
    for (const file of puzzleFiles) {
      const remotePath = `/app/server/data/puzzles/${file}`;
      const localPath = path.join(LOCAL_PUZZLES_DIR, file);
      getFileFromHeroku(remotePath, localPath);
    }
    
    console.log('Download complete!');
    console.log(`Local files backed up to: ${backupDir}`);
    
    // Write a summary of what we obtained
    console.log("\nSUMMARY OF DOWNLOAD:");
    console.log(`- Association cache: Downloaded`);
    console.log(`- Puzzles from filesystem: ${puzzleFiles.length} files`);
    console.log(`- Current active puzzle: ${currentPuzzle ? "Downloaded" : "Not available"}`);
    if (currentPuzzle) {
      console.log(`  ${currentPuzzle.startWord} → ${currentPuzzle.targetWord} (${currentPuzzle.theme})`);
    }
    console.log(`- Recent puzzles via API: ${recentPuzzles.length > 0 ? `${recentPuzzles.length} puzzles` : "Not available"}`);
    
    // Count total local puzzle files after download
    const localPuzzleFiles = fs.readdirSync(LOCAL_PUZZLES_DIR).filter(file => file.endsWith('.json'));
    console.log(`\nTotal puzzle files now available locally: ${localPuzzleFiles.length}`);
    
  } catch (error) {
    console.error('Error during download process:', error);
  }
}

// Execute the main function
downloadAndUpdateFiles();