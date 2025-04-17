import { useState, useEffect, useRef } from 'react';
import * as Tone from 'tone';
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
  const [musicEnabled, setMusicEnabled] = useState(localStorage.getItem('musicEnabled') !== 'false'); // Music toggle state
  const synthRef = useRef(null); // Reference to synth object
  const sequenceRef = useRef(null); // Reference to sequence

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
  // Initialize synth and sequences
  useEffect(() => {
    // Create a simple polyphonic synth with triangle wave for softer sound
    synthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: "triangle"
      },
      envelope: {
        attack: 0.05,
        decay: 0.1,
        sustain: 0.4,
        release: 1.2
      }
    }).toDestination();
    synthRef.current.volume.value = -20; // Lower volume
    
    // Separate synth for melody
    const melodySynthRef = new Tone.Synth({
      oscillator: {
        type: "sine"
      },
      envelope: {
        attack: 0.1,
        decay: 0.2,
        sustain: 0.4,
        release: 1.5
      }
    }).toDestination();
    melodySynthRef.volume.value = -25; // Even softer melody
    
    // Simple percussion using noise and filters for gentle beats
    const percSynthHigh = new Tone.NoiseSynth({
      noise: {
        type: "pink",
        playbackRate: 3
      },
      envelope: {
        attack: 0.001,
        decay: 0.1,
        sustain: 0.01,
        release: 0.2
      }
    }).toDestination();
    percSynthHigh.volume.value = -30; // Very quiet hi-hat sound
    
    const percSynthLow = new Tone.NoiseSynth({
      noise: {
        type: "brown",
        playbackRate: 0.8
      },
      envelope: {
        attack: 0.005,
        decay: 0.1,
        sustain: 0.01,
        release: 0.4
      }
    }).toDestination();
    percSynthLow.volume.value = -28; // Soft kick drum sound
    
    // G minor → Eb major → Bb major → F major progression (more emotional/contemplative)
    const chordPattern = [
      // G minor (i)
      [
        { note: "G2", duration: "8n" },
        { note: "Bb2", duration: "8n" },
        { note: "D3", duration: "8n" },
        { note: "G3", duration: "8n" },
        { note: "D3", duration: "8n" },
        { note: "Bb2", duration: "8n" }
      ],
      // Eb major (VI)
      [
        { note: "Eb2", duration: "8n" },
        { note: "G2", duration: "8n" },
        { note: "Bb2", duration: "8n" },
        { note: "Eb3", duration: "8n" },
        { note: "Bb2", duration: "8n" },
        { note: "G2", duration: "8n" }
      ],
      // Bb major (III)
      [
        { note: "Bb2", duration: "8n" },
        { note: "D3", duration: "8n" },
        { note: "F3", duration: "8n" },
        { note: "Bb3", duration: "8n" },
        { note: "F3", duration: "8n" },
        { note: "D3", duration: "8n" }
      ],
      // F major (VII)
      [
        { note: "F2", duration: "8n" },
        { note: "A2", duration: "8n" },
        { note: "C3", duration: "8n" },
        { note: "F3", duration: "8n" },
        { note: "C3", duration: "8n" },
        { note: "A2", duration: "8n" }
      ]
    ];
    
    // Simple pentatonic-based melody that works with the chord progression
    const melodyPattern = [
      { note: "G4", time: 0, duration: "4n" },
      { note: "Bb4", time: 2, duration: "4n" },
      { note: "C5", time: 4, duration: "4n" },
      { note: "D5", time: 6, duration: "8n" },
      { note: "Bb4", time: 7, duration: "4n" },
      { note: "G4", time: 10, duration: "2n" },
      { note: "F4", time: 14, duration: "4n" },
      { note: "Bb4", time: 16, duration: "4n" },
      { note: "C5", time: 20, duration: "4n" },
      { note: "D5", time: 24, duration: "2n" },
      { note: null, time: 28, duration: "2n" } // Rest
    ];
    
    // Percussion pattern - simple 4/4 pattern with variations
    const percussionPattern = [
      // Beat positions (0-15 for a full bar at 16th notes)
      // Format: [position, type] where type is 'high' or 'low'
      [0, 'low'],   // Kick on the 1
      [4, 'high'],  // Hi-hat on the & of 2
      [8, 'low'],   // Kick on the 3
      [12, 'high'], // Hi-hat on the & of 4
      [14, 'high']  // Additional hi-hat for variation
    ];
    
    let currentChordIndex = 0;
    let noteIndex = 0;
    let melodyIndex = 0;
    let melodyCounter = 0;
    let percCounter = 0;
    
    // Set initial tempo
    Tone.Transport.bpm.value = 70; // Slower default tempo
    
    // Create a sequence that changes chords
    sequenceRef.current = new Tone.Loop((time) => {
      if (musicEnabled) {
        // Get current chord's note
        const currentChord = chordPattern[currentChordIndex];
        const note = currentChord[noteIndex];
        
        // Play the note
        synthRef.current.triggerAttackRelease(note.note, note.duration, time);
        
        // Move to next note in the arpeggio
        noteIndex = (noteIndex + 1) % currentChord.length;
        
        // If we've completed one arpeggio cycle, maybe change chords
        if (noteIndex === 0) {
          currentChordIndex = (currentChordIndex + 1) % chordPattern.length;
        }
        
        // Handle melody playback - separate from chord timing
        melodyCounter++;
        
        // Check if we need to play a melody note
        for (let i = 0; i < melodyPattern.length; i++) {
          const melodyNote = melodyPattern[i];
          if (melodyNote.time === melodyCounter % 32) { // 32-beat pattern
            if (melodyNote.note) { // Only play if not a rest
              melodySynthRef.triggerAttackRelease(
                melodyNote.note, 
                melodyNote.duration, 
                time
              );
            }
            break;
          }
        }
        
        // Handle percussion playback
        percCounter = (percCounter + 1) % 16; // 16 steps per bar (16th notes)
        
        // Check if we have a percussion hit on this step
        percussionPattern.forEach(([position, type]) => {
          if (percCounter === position) {
            if (type === 'high') {
              percSynthHigh.triggerAttackRelease('16n', time);
            } else if (type === 'low') {
              percSynthLow.triggerAttackRelease('8n', time);
            }
          }
        });
      }
    }, "8n");
    
    // Start the transport
    if (musicEnabled) {
      Tone.Transport.start();
      sequenceRef.current.start(0);
    }
    
    // Cleanup function
    return () => {
      if (sequenceRef.current) {
        sequenceRef.current.stop();
        sequenceRef.current.dispose();
      }
      Tone.Transport.stop();
      if (synthRef.current) {
        synthRef.current.dispose();
      }
      if (melodySynthRef) {
        melodySynthRef.dispose();
      }
      if (percSynthHigh) {
        percSynthHigh.dispose();
      }
      if (percSynthLow) {
        percSynthLow.dispose();
      }
    };
  }, [musicEnabled]);
  
  // Toggle music on/off
  const toggleMusic = () => {
    const newState = !musicEnabled;
    setMusicEnabled(newState);
    localStorage.setItem('musicEnabled', newState);
    
    if (newState) {
      // Start music
      Tone.start();
      Tone.Transport.start();
      sequenceRef.current.start(0);
    } else {
      // Stop music
      sequenceRef.current.stop();
      Tone.Transport.stop();
    }
  };
  
  // Adjust tempo based on game progress
  useEffect(() => {
    if (musicEnabled && path.length > 2 && !gameComplete) {
      // Gradually increase tempo as player makes progress
      const maxSteps = game?.minExpectedSteps || 10;
      const currentProgress = path.length - 1; // Subtract start word
      const progressRatio = Math.min(currentProgress / maxSteps, 1);
      
      // Start at 70 BPM, increase to 85 BPM (slower overall)
      const newTempo = 70 + (progressRatio * 15);
      Tone.Transport.bpm.value = newTempo;
    }
  }, [path.length, musicEnabled, gameComplete, game]);
  
  // Play success jingle when game is completed
  useEffect(() => {
    if (gameComplete && musicEnabled) {
      // Success jingle - more elaborate with delay
      const successNotes = [
        { note: "C4", time: 0 },
        { note: "E4", time: 0.2 },
        { note: "G4", time: 0.4 },
        { note: "C5", time: 0.6 },
        { note: "G4", time: 0.8 },
        { note: "C5", time: 1.0 },
        { note: "E5", time: 1.2 }
      ];
      
      successNotes.forEach(({ note, time }) => {
        synthRef.current.triggerAttackRelease(note, "8n", Tone.now() + time);
      });
    }
  }, [gameComplete, musicEnabled]);
  
  // Play note when selecting a word
  const playSelectNote = () => {
    if (musicEnabled) {
      // Play two-note "selection" sound
      synthRef.current.triggerAttackRelease("G4", "16n");
      setTimeout(() => {
        synthRef.current.triggerAttackRelease("C5", "16n");
      }, 100);
    }
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
    
    // Play selection sound
    playSelectNote();
    
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
    
    // Play "hint" sound effect
    if (musicEnabled) {
      synthRef.current.triggerAttackRelease("E5", "16n");
      setTimeout(() => {
        synthRef.current.triggerAttackRelease("G5", "16n");
      }, 150);
    }
    
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
    
    // Play "back" sound effect
    if (musicEnabled) {
      synthRef.current.triggerAttackRelease("D4", "16n");
      setTimeout(() => {
        synthRef.current.triggerAttackRelease("A3", "16n");
      }, 100);
    }
    
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
              <button
                onClick={toggleMusic}
                className={`music-button ${musicEnabled ? 'active' : ''}`}
                title={musicEnabled ? 'Disable background music' : 'Enable background music'}
              >
                {musicEnabled ? '🔊' : '🔇'}
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