import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentWord, setCurrentWord] = useState('');
  const [associations, setAssociations] = useState([]);
  const [detailedAssociations, setDetailedAssociations] = useState([]);
  const [path, setPath] = useState([]);
  const [backSteps, setBackSteps] = useState(0); // Track number of back steps
  const [totalSteps, setTotalSteps] = useState(0); // Track total steps including backs
  const [gameComplete, setGameComplete] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [showHints, setShowHints] = useState(false);
  const [loadingAssociations, setLoadingAssociations] = useState(false);
  const [isRestoringProgress, setIsRestoringProgress] = useState(false); // Flag for restoring progress
  const [notification, setNotification] = useState(null); // For showing temporary notifications

  // Get base API URL based on environment
  const getApiUrl = () => {
    // In production, use relative URLs
    return '/api';
  };

  // Function to save progress to localStorage
  const saveProgress = (gameData, currentPath, currBackSteps, currTotalSteps) => {
    if (!gameData || currentPath.length <= 1) return; // Don't save if we're just at the start

    const progressData = {
      gameDate: gameData.gameDate,
      path: currentPath,
      backSteps: currBackSteps,
      totalSteps: currTotalSteps,
      timestamp: new Date().toISOString()
    };
    
    localStorage.setItem('wordGameProgress', JSON.stringify(progressData));
    
    // Show a subtle notification that progress is saved
    if (!isRestoringProgress) {
      showNotification('Progress saved', 2000);
    }
  };
  
  // Function to clear saved progress
  const clearSavedProgress = () => {
    localStorage.removeItem('wordGameProgress');
  };
  
  // Function to show a temporary notification
  const showNotification = (message, duration = 3000) => {
    setNotification(message);
    setTimeout(() => {
      setNotification(null);
    }, duration);
  };

  // Fetch game data on component mount
  useEffect(() => {
    fetch(`${getApiUrl()}/game`)
      .then(response => response.json())
      .then(data => {
        setGame(data);
        
        // Check if there's saved progress for this game
        const savedProgress = localStorage.getItem('wordGameProgress');
        
        if (savedProgress) {
          try {
            const progressData = JSON.parse(savedProgress);
            
            // Only restore if it's for the current day's puzzle
            if (progressData.gameDate === data.gameDate && progressData.path.length > 1) {
              console.log('Restoring saved progress');
              // Show notification that progress was restored
              showNotification('Progress restored', 3000);
              setIsRestoringProgress(true);
              setPath(progressData.path);
              setCurrentWord(progressData.path[progressData.path.length - 1]);
              setBackSteps(progressData.backSteps || 0);
              setTotalSteps(progressData.totalSteps || 0);
              
              // Fetch associations for the last word in the restored path
              const lastWord = progressData.path[progressData.path.length - 1];
              setLoading(false);
              
              // Get associations for the current word
              return fetch(`${getApiUrl()}/associations/${lastWord}?detailed=true`);
            } else {
              // If the saved progress is for a different game or just the start, clear it
              clearSavedProgress();
              setCurrentWord(data.startWord);
              setPath([data.startWord]);
              setBackSteps(0);
              setTotalSteps(0);
              setLoading(false);
              
              // Fetch associations for the starting word
              return fetch(`${getApiUrl()}/associations/${data.startWord}?detailed=true`);
            }
          } catch (e) {
            console.error('Error parsing saved progress:', e);
            clearSavedProgress();
            setCurrentWord(data.startWord);
            setPath([data.startWord]);
            setBackSteps(0);
            setTotalSteps(0);
            setLoading(false);
            
            // Fetch associations for the starting word
            return fetch(`${getApiUrl()}/associations/${data.startWord}?detailed=true`);
          }
        } else {
          // No saved progress, start fresh
          setCurrentWord(data.startWord);
          setPath([data.startWord]);
          setBackSteps(0);
          setTotalSteps(0);
          setLoading(false);
          
          // Fetch associations for the starting word
          return fetch(`${getApiUrl()}/associations/${data.startWord}?detailed=true`);
        }
      })
      .then(response => response.json())
      .then(data => {
        setAssociations(data.associations);
        if (data.detailed) {
          setDetailedAssociations(data.detailed);
        }
        setIsRestoringProgress(false);
      })
      .catch(err => {
        console.error('Error fetching data:', err);
        setError('Failed to load game data. Please try again later.');
        setLoading(false);
        setIsRestoringProgress(false);
      });
  }, []);

  // Handle word selection
  const handleWordSelect = (word) => {
    // Check if game is already complete or if we're loading
    if (gameComplete || loadingAssociations) return;
    
    // Set loading state
    setLoadingAssociations(true);
    
    // Add word to path
    const newPath = [...path, word];
    setPath(newPath);
    setCurrentWord(word);
    
    // Increment total steps (forward step)
    const newTotalSteps = totalSteps + 1;
    setTotalSteps(newTotalSteps);
    
    // Check if target word reached (normalize case and whitespace)
    if (word.toLowerCase().trim() === game.targetWord.toLowerCase().trim()) {
      setGameComplete(true);
      setLoadingAssociations(false); // Reset loading state
      
      // Clear saved progress when the game is completed
      clearSavedProgress();
      
      // Submit result to server with total steps (including back steps)
      fetch(`${getApiUrl()}/game/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          steps: newPath.length - 1, // Path length minus start word
          backSteps: backSteps,      // Number of back steps
          totalSteps: newTotalSteps  // Total steps including backs
        })
      })
        .then(response => response.json())
        .then(data => {
          // Update game with new stats
          setGame({...game, stats: data.stats});
        })
        .catch(err => {
          console.error('Error submitting results:', err);
          setLoadingAssociations(false);
        });
    } else {
      // Get new associations with detailed info
      fetch(`${getApiUrl()}/associations/${word}?detailed=true`)
        .then(response => response.json())
        .then(data => {
          setAssociations(data.associations);
          if (data.detailed) {
            setDetailedAssociations(data.detailed);
          }
          setHint(''); // Clear any existing hint
          setLoadingAssociations(false); // Reset loading state
          
          // Save progress to localStorage
          saveProgress(game, newPath, backSteps, newTotalSteps);
        })
        .catch(err => {
          console.error('Error fetching associations:', err);
          setError('Failed to get associations. Please try again.');
          setLoadingAssociations(false); // Reset loading state
        });
    }
  };
  
  // Request a hint from the API
  const getHint = () => {
    // Don't allow hint request if already loading
    if (loadingAssociations) return;
    
    // Set loading state
    setLoadingAssociations(true);
    
    // Convert path to JSON string for the query parameter
    const pathJson = JSON.stringify(path);
    
    fetch(`${getApiUrl()}/game/hint?progress=${encodeURIComponent(pathJson)}`)
      .then(response => response.json())
      .then(data => {
        setHint(data.hint);
        setLoadingAssociations(false); // Reset loading state
      })
      .catch(err => {
        console.error('Error fetching hint:', err);
        setHint('Unable to get a hint right now. Try again later.');
        setLoadingAssociations(false); // Reset loading state
      });
  };

  // Toggle showing detailed hints for associations
  const toggleHints = () => {
    setShowHints(!showHints);
  };
  
  // Removed regenerateGame function since puzzles are generated hourly on the server

  // Handle going back to previous word
  const handleGoBack = () => {
    // Check if we can go back (at least 2 items in path) and not loading
    if (path.length < 2 || gameComplete || loadingAssociations) return;
    
    // Set loading state
    setLoadingAssociations(true);
    
    // Remove the last word from path
    const newPath = [...path];
    newPath.pop(); // Remove current word
    
    // Set previous word as current
    const previousWord = newPath[newPath.length - 1];
    setCurrentWord(previousWord);
    setPath(newPath);
    
    // Increment back steps and total steps
    setBackSteps(backSteps + 1);
    setTotalSteps(totalSteps + 1);
    
    // Get associations for the previous word with detailed info
    fetch(`${getApiUrl()}/associations/${previousWord}?detailed=true`)
      .then(response => response.json())
      .then(data => {
        setAssociations(data.associations);
        if (data.detailed) {
          setDetailedAssociations(data.detailed);
        }
        setHint(''); // Clear any existing hint
        setLoadingAssociations(false); // Reset loading state
        
        // Save updated progress to localStorage
        saveProgress(game, newPath, backSteps + 1, totalSteps + 1);
      })
      .catch(err => {
        console.error('Error fetching associations:', err);
        setError('Failed to get associations. Please try again.');
        setLoadingAssociations(false); // Reset loading state
      });
  };

  if (loading) {
    return (
      <div className="App">
        <header className="App-header">
          <h1>Word Association Game</h1>
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading game...</p>
          </div>
        </header>
      </div>
    );
  }

  if (error) {
    return (
      <div className="App">
        <header className="App-header">
          <h1>Word Association Game</h1>
          <p className="error">{error}</p>
          <button onClick={() => window.location.reload()}>Try Again</button>
        </header>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="App-header">
        {notification && (
          <div className="notification">
            {notification}
          </div>
        )}
        <h1>Word Association Game</h1>
        <p>Find your way from <strong>{game.startWord}</strong> to <strong>{game.targetWord}</strong> using word associations!</p>
        <div className="game-info">
          <div className="game-theme">
            {game.minExpectedSteps && <span className="min-steps">Par: {game.minExpectedSteps}</span>}
          </div>
          <div className="refresh-timer">
            New puzzle available every hour
          </div>
        </div>
        
        {gameComplete ? (
          <div className="game-complete">
            <h2>🎉 Congratulations! 🎉</h2>
            <p>Your path length: {path.length - 1} steps</p>
            <p>Total moves: {totalSteps} (including {backSteps} back steps)</p>
            {game.theme && (
              <div className="game-solution">
                <div className="solution-theme">
                  <strong>Theme:</strong> {game.theme}
                </div>
                {game.minExpectedSteps && (
                  <div className="solution-steps">
                    <strong>Par:</strong> {game.minExpectedSteps}
                    {path.length - 1 < game.minExpectedSteps && (
                      <span className="optimal-solution"> (You beat par by {game.minExpectedSteps - (path.length - 1)}!)</span>
                    )}
                    {path.length - 1 === game.minExpectedSteps && (
                      <span className="optimal-solution"> (You matched par!)</span>
                    )}
                    {path.length - 1 > game.minExpectedSteps && (
                      <span className="over-par"> (Over par by {(path.length - 1) - game.minExpectedSteps})</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <p className="stats-divider">Game Statistics</p>
            <div className="stats-grid">
              <div className="stat-box">
                <div className="stat-title">Path Length</div>
                <div className="stat-value">{game.stats.averageSteps.toFixed(1)}</div>
                <div className="stat-label">avg</div>
              </div>
              <div className="stat-box">
                <div className="stat-title">Back Steps</div>
                <div className="stat-value">{game.stats.averageBackSteps.toFixed(1)}</div>
                <div className="stat-label">avg</div>
              </div>
              <div className="stat-box">
                <div className="stat-title">Total Moves</div>
                <div className="stat-value">{game.stats.averageTotalSteps.toFixed(1)}</div>
                <div className="stat-label">avg</div>
              </div>
              <div className="stat-box">
                <div className="stat-title">Plays</div>
                <div className="stat-value">{game.stats.totalPlays}</div>
                <div className="stat-label">today</div>
              </div>
            </div>
            <div className="path-display">
              Your path: {path.join(' → ')}
            </div>
            <div className="button-group">
              <button onClick={() => window.location.reload()} className="play-again-button">
                Play Again
              </button>
              <div className="next-puzzle-timer">
                New puzzle available every hour
              </div>
            </div>
            <div className="win-footer">
              <a href="/about">About</a>
              <span>|</span>
              <a href="https://github.com/Ltrares/ai_assoc" target="_blank" rel="noopener noreferrer">GitHub</a>
            </div>
          </div>
        ) : (
          <>
            <div className="game-stats">
              <div className="current-word">
                Current word: <strong>{currentWord}</strong>
              </div>
              <div className="moves-counter">
                Moves: {totalSteps} {backSteps > 0 && `(${backSteps} back)`}
              </div>
            </div>
            
            <div className="path-display">
              Your path: {path.join(' → ')}
            </div>
            
            <div className="game-controls">
              {path.length > 1 && (
                <button 
                  onClick={handleGoBack} 
                  className="back-button"
                  disabled={loadingAssociations}
                  title="Go back one step (counts as a move)"
                >
                  ← Go Back
                </button>
              )}
              <button
                onClick={getHint}
                className="hint-button"
                disabled={loadingAssociations}
                title="Get a subtle hint to help you move forward"
              >
                💡 Get Hint
              </button>
              <button
                onClick={toggleHints}
                className={`detail-toggle ${showHints ? 'active' : ''}`}
                disabled={loadingAssociations}
                title="Show/hide detailed association explanations"
              >
                {showHints ? 'Hide Details' : 'Show Details'}
              </button>
            </div>
            
            {hint && (
              <div className="hint-display">
                <h3>Hint:</h3>
                <p>{hint}</p>
              </div>
            )}
            
            <div className="associations">
              <p>Choose your next word:</p>
              
              {loadingAssociations ? (
                <div className="associations-loading">
                  <div className="small-spinner"></div>
                  <p>Loading associations...</p>
                </div>
              ) : (
                <div className={`word-buttons ${showHints ? 'with-details' : ''}`}>
                  {associations.map((word, index) => {
                    // Find the detailed association if available
                    const details = detailedAssociations.find(d => d.word === word);
                    
                    return (
                      <div key={index} className="word-option">
                        <button 
                          onClick={() => handleWordSelect(word)}
                          disabled={path.some(p => p.toLowerCase().trim() === word.toLowerCase().trim()) || loadingAssociations}
                          className={path.some(p => p.toLowerCase().trim() === word.toLowerCase().trim()) ? 'used' : ''}
                        >
                          {word}
                        </button>
                        {showHints && details && (
                          <div className="word-details">
                            <span className="connection-type">{details.type}</span>
                            <p className="connection-hint">{details.hint}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
        <div className="footer">
          <a href="/about">About</a>
          <span>|</span>
          <a href="https://github.com/Ltrares/ai_assoc" target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
      </header>
    </div>
  );
}

export default App;