#!/bin/bash

# download-heroku-backup.sh
# Downloads association cache and puzzles from Heroku using the Heroku CLI
# Requires Heroku CLI to be installed and authenticated

# Configuration
APP_NAME="ai-association-game"  # Replace with your actual Heroku app name
LOCAL_BACKUP_DIR="./heroku_backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOCAL_DATA_DIR="../data"

# Create backup directories
mkdir -p "$LOCAL_BACKUP_DIR/$TIMESTAMP/puzzles"
mkdir -p "$LOCAL_DATA_DIR/puzzles"

# Echo with timestamp
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "Starting Heroku data download from $APP_NAME"

# Download association cache file
log "Downloading association cache file..."
heroku run "cat /app/server/data/association-cache.json" --app $APP_NAME > "$LOCAL_BACKUP_DIR/$TIMESTAMP/association-cache.json"

if [ $? -eq 0 ]; then
  # Copy to local data directory
  log "Copying cache to local data directory..."
  cp "$LOCAL_BACKUP_DIR/$TIMESTAMP/association-cache.json" "$LOCAL_DATA_DIR/"
else
  log "Error downloading association cache file"
fi

# Get list of puzzle files
log "Getting list of puzzle files..."
PUZZLE_FILES=$(heroku run "ls -1 /app/server/data/puzzles/" --app $APP_NAME | grep -v "Running")

# Download each puzzle file
for file in $PUZZLE_FILES; do
  if [ ! -z "$file" ] && [[ "$file" == *".json" ]]; then
    log "Downloading puzzle file: $file"
    heroku run "cat /app/server/data/puzzles/$file" --app $APP_NAME > "$LOCAL_BACKUP_DIR/$TIMESTAMP/puzzles/$file"
    
    if [ $? -eq 0 ]; then
      # Copy to local puzzles directory
      log "Copying $file to local puzzles directory..."
      cp "$LOCAL_BACKUP_DIR/$TIMESTAMP/puzzles/$file" "$LOCAL_DATA_DIR/puzzles/"
    else
      log "Error downloading puzzle file: $file"
    fi
  fi
done

log "Backup completed successfully to $LOCAL_BACKUP_DIR/$TIMESTAMP"
log "Local data directory updated with Heroku data"