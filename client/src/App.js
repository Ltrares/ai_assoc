import { useState, useEffect, useRef, useCallback } from 'react';
import * as Tone from 'tone';
import './App.css';

// Timer component to display countdown to next puzzle or a button when time is up
function NewPuzzleTimer({ nextGameTime, onLoadNewPuzzle }) {
  const [timeRemaining, setTimeRemaining] = useState("");
  const [isTimeUp, setIsTimeUp] = useState(false);
  
  useEffect(() => {
    // Function to calculate and format time remaining
    const updateTimeRemaining = () => {
      // Parse the nextGameTime string to a Date object if it's a string
      const targetTime = typeof nextGameTime === 'string' 
        ? new Date(nextGameTime) 
        : nextGameTime;
      
      // Calculate time difference
      const now = new Date();
      const diff = targetTime - now;
      
      // If time is up or invalid, show a button
      if (isNaN(diff) || diff <= 0) {
        setTimeRemaining("New puzzle available!");
        setIsTimeUp(true);
        return;
      }
      
      // Time is not up yet
      setIsTimeUp(false);
      
      // Format minutes and seconds as MM:SS
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      
      // Format with leading zeros
      const formattedMinutes = String(minutes).padStart(2, '0');
      const formattedSeconds = String(seconds).padStart(2, '0');
      
      setTimeRemaining(`New puzzle in ${formattedMinutes}:${formattedSeconds}`);
    };
    
    // Update immediately
    updateTimeRemaining();
    
    // Then update every second
    const interval = setInterval(updateTimeRemaining, 1000);
    
    // Clean up interval on component unmount
    return () => clearInterval(interval);
  }, [nextGameTime]);
  
  // Handle loading the new puzzle
  const handleLoadNewPuzzle = () => {
    // Show a loading message
    setTimeRemaining("Loading new puzzle...");
    setIsTimeUp(false);
    
    // Call the provided callback
    if (onLoadNewPuzzle) {
      onLoadNewPuzzle();
    } else {
      // Fallback if callback not provided
      window.location.reload();
    }
  };
  
  return isTimeUp ? (
    <button 
      onClick={handleLoadNewPuzzle} 
      className="new-puzzle-button"
    >
      Load New Puzzle
    </button>
  ) : (
    <span>{timeRemaining}</span>
  );
}

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
  const [musicEnabled, setMusicEnabled] = useState(false); // Always start muted, regardless of localStorage
  const [showAnswer, setShowAnswer] = useState(false); // State to control showing the answer
  const [solution, setSolution] = useState(null); // Store the solution path when requested
  const synthRef = useRef(null); // Reference to synth object
  const sequenceRef = useRef(null); // Reference to sequence

  // Get base API URL based on environment 
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const getApiUrl = useCallback(() => {
    const hostname = window.location.hostname;
    
    // If we're running locally (localhost or 127.0.0.1)
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      // In development mode, the proxy in package.json will handle redirecting '/api' to the server
      if (process.env.NODE_ENV === 'development') {
        return '/api';
      } else {
        // If running in production mode locally, explicit port is needed
        // The proxy in package.json points to port 5050
        return 'http://localhost:5050/api';
      }
    }
    
    // For Heroku or other production environments, use relative URL
    return '/api';
  }, []);

  // Function to save progress to localStorage
  const saveProgress = (gameData, currentPath, currBackSteps, currTotalSteps) => {
    if (!gameData || currentPath.length <= 1) return; // Don't save if we're just at the start

    // Ensure the path is stored with consistent sanitized format
    const sanitizedPath = currentPath.map(word => word.trim().toLowerCase());

    const progressData = {
      gameDate: gameData.gameDate,
      path: sanitizedPath,
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
    synthRef.current.volume.value = -18; // Increased overall volume by 20% (approximately 2dB)
    
    // Separate synth for melody - store as ref to avoid recreation issues
    const melodySynth = new Tone.Synth({
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
    melodySynth.volume.value = -23; // Increased overall volume by 20% (approximately 2dB)
    // Store in a ref for proper cleanup
    const melodySynthRef = melodySynth;
    
    // Simple percussion using noise and filters for gentle beats - store in local variables
    // for clear scoping and memory management
    const highPerc = new Tone.NoiseSynth({
      noise: {
        type: "pink",
        playbackRate: 3.5 // Slightly higher playback rate for brighter sound
      },
      envelope: {
        attack: 0.001,
        decay: 0.15, // Slightly longer decay
        sustain: 0.02, // Slightly higher sustain
        release: 0.25 // Slightly longer release
      }
    }).toDestination();
    highPerc.volume.value = -18; // Significantly increased hi-hat volume to make it more audible
    const percSynthHigh = highPerc; // Reference for cleanup
    
    const lowPerc = new Tone.NoiseSynth({
      noise: {
        type: "brown",
        playbackRate: 1.0 // Slightly higher playback rate for more presence
      },
      envelope: {
        attack: 0.002, // Faster attack for more punch
        decay: 0.15, // Slightly longer decay
        sustain: 0.04, // Higher sustain for more body
        release: 0.5 // Longer release for more presence
      }
    }).toDestination();
    lowPerc.volume.value = -16; // Significantly increased kick drum volume to make it more audible
    const percSynthLow = lowPerc; // Reference for cleanup
    
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
    
    // Variation on the melody that moves in the opposite direction at times
    const melodyVariationPattern = [
      { note: "D5", time: 32, duration: "4n" },
      { note: "C5", time: 34, duration: "4n" },
      { note: "Bb4", time: 36, duration: "4n" },
      { note: "G4", time: 38, duration: "8n" },
      { note: "Bb4", time: 39, duration: "4n" },
      { note: "D5", time: 42, duration: "2n" },
      { note: "F5", time: 46, duration: "4n" },
      { note: "D5", time: 48, duration: "4n" },
      { note: "Bb4", time: 52, duration: "4n" },
      { note: "C5", time: 56, duration: "2n" },
      { note: null, time: 60, duration: "2n" } // Rest
    ];
    
    // Percussion pattern - enhanced 4/4 pattern with more hits for greater prominence
    const percussionPattern = [
      // Beat positions (0-15 for a full bar at 16th notes)
      // Format: [position, type] where type is 'high' or 'low'
      [0, 'low'],   // Kick on the 1
      [2, 'high'],  // Hi-hat on the & of 1
      [4, 'high'],  // Hi-hat on the 2
      [6, 'high'],  // Hi-hat on the & of 2
      [8, 'low'],   // Kick on the 3
      [10, 'high'], // Hi-hat on the & of 3
      [12, 'high'], // Hi-hat on the 4
      [14, 'high']  // Hi-hat on the & of 4
    ];
    
    let currentChordIndex = 0;
    let noteIndex = 0;
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
        
        // Determine if we're in a pause cycle
        // After playing twice (2 * 64 = 128 beats), pause for one cycle (64 beats)
        const totalCycleLength = 64 * 3; // Two melody cycles plus one pause cycle
        const currentPosition = melodyCounter % totalCycleLength;
        const isInPauseCycle = currentPosition >= 128 && currentPosition < 192;
        
        // Only play melody if not in pause cycle
        if (!isInPauseCycle) {
          // Adjust counter to work with the combined pattern during play cycles
          const adjustedCounter = currentPosition % 64;
          
          // Check if we need to play a melody note (now includes both patterns)
          // Create combined array of both patterns
          const combinedMelodyPatterns = [...melodyPattern, ...melodyVariationPattern];
          
          for (let i = 0; i < combinedMelodyPatterns.length; i++) {
            const melodyNote = combinedMelodyPatterns[i];
            if (melodyNote.time === adjustedCounter) {
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
    
    // Start the transport - but only if music is enabled
    if (musicEnabled) {
      // Need to initialize the audio context with a user gesture, so we'll start it
      // conditionally in toggleMusic() instead of here for first-time users
      Tone.Transport.start();
      sequenceRef.current.start(0);
    } else {
      // Make sure transport is stopped when music is disabled
      Tone.Transport.stop();
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
    
    // Handle audio state change
    if (newState) {
      // Start music - this first Tone.start() call is critical
      // as it starts the audio context with a user gesture
      Tone.start().then(() => {
        console.log("Audio started successfully");
        Tone.Transport.start();
        if (sequenceRef.current) {
          // Ensure sequence is started only if it exists
          sequenceRef.current.start(0);
        }
        
        // Only set state after successful audio start
        setMusicEnabled(true);
        localStorage.setItem('musicEnabled', 'true');
      }).catch(err => {
        console.error("Error starting audio:", err);
        // Don't update state if audio fails to start
      });
    } else {
      // Stop music safely with checks
      if (sequenceRef.current) {
        sequenceRef.current.stop();
      }
      Tone.Transport.stop();
      
      // Update state
      setMusicEnabled(false);
      localStorage.setItem('musicEnabled', 'false');
    }
  };
  
  // Adjust tempo based on game progress
  useEffect(() => {
    if (musicEnabled && path && path.length > 2 && !gameComplete) {
      // Gradually increase tempo as player makes progress
      const maxSteps = game?.minExpectedSteps || 10;
      const currentProgress = path.length - 1; // Subtract start word
      const progressRatio = Math.min(currentProgress / maxSteps, 1);
      
      // Start at 70 BPM, increase to 85 BPM (slower overall)
      const newTempo = 70 + (progressRatio * 15);
      Tone.Transport.bpm.value = newTempo;
    }
  }, [path, path?.length, musicEnabled, gameComplete, game]);
  
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
    if (musicEnabled && synthRef.current) {
      // Only play if music is enabled and synth is initialized
      // Play two-note "selection" sound
      try {
        synthRef.current.triggerAttackRelease("G4", "16n");
        setTimeout(() => {
          if (synthRef.current) { // Double-check it still exists
            synthRef.current.triggerAttackRelease("C5", "16n");
          }
        }, 100);
      } catch (err) {
        console.error("Error playing selection sound:", err);
      }
    }
  };
  
  // Fetch game data on component mount
  // Function to reset all game state
  const resetGameState = () => {
    setGame(null);
    setCurrentWord('');
    setAssociations([]);
    setDetailedAssociations([]);
    setPath([]);
    setBackSteps(0);
    setTotalSteps(0);
    setGameComplete(false);
    setError('');
    setHint('');
    setShowHints(false);
    setLoadingAssociations(false);
    setIsRestoringProgress(false);
    localStorage.removeItem('wordGameProgress'); // Directly clear saved progress
  };
  
  // Load or reload game data (wrapped in useCallback to avoid recreating on every render)
  const loadGameData = useCallback((shouldReset = false) => {
    // Reset game state if requested
    if (shouldReset) {
      resetGameState();
    }
    
    // Reset loading state first
    setLoading(true);
    setError('');
    
    fetch(`${getApiUrl()}/game`)
      .then(response => {
        if (!response.ok) {
          // If the response indicates an error (like 503 when puzzle is generating)
          return response.json().then(errorData => {
            throw new Error(errorData.message || 'Failed to load game data');
          });
        }
        return response.json();
      })
      .then(data => {
        // Check if we received a new game (different from current game)
        const isNewGame = !game || data.gameDate !== game.gameDate;
        
        // Log game data for debugging
        console.log("Game data received from server:", {
          startWord: data.startWord,
          targetWord: data.targetWord,
          minExpectedSteps: data.minExpectedSteps,
          nextGameTime: data.nextGameTime
        });
        
        // Always set the game data
        setGame(data);
        
        // If it's a new game, clear any saved progress
        if (isNewGame) {
          console.log('New game detected - resetting progress');
          localStorage.removeItem('wordGameProgress');
          setGameComplete(false);
        }
        
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
              
              // Ensure path is properly sanitized
              const sanitizedPath = progressData.path.map(word => typeof word === 'string' ? word.trim().toLowerCase() : word);
              setPath(sanitizedPath);
              setCurrentWord(sanitizedPath[sanitizedPath.length - 1]);
              setBackSteps(progressData.backSteps || 0);
              setTotalSteps(progressData.totalSteps || 0);
              
              // Fetch associations for the last word in the restored path
              const lastWord = sanitizedPath[sanitizedPath.length - 1];
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
      .then(response => {
        if (!response || !response.json) return null; // If no response (due to early return above)
        return response.json();
      })
      .then(data => {
        if (!data) return; // Skip if no data (from early return above)
        setAssociations(data.associations);
        if (data.detailed) {
          setDetailedAssociations(data.detailed);
        }
        setIsRestoringProgress(false);
      })
      .catch(err => {
        console.error('Error fetching data:', err);
        if (err.message && err.message.includes('No game has been generated yet')) {
          setError('Please wait - new puzzle coming soon...');
        } else {
          setError('Failed to load game data. Please try again later.');
        }
        setLoading(false);
        setIsRestoringProgress(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getApiUrl]);
  
  // Initial game load on component mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Load game data with reset (the reset is now handled within loadGameData)
    loadGameData(true);
  }, []);

  // Handle word selection
  const handleWordSelect = (word) => {
    // Check if game is already complete or if we're loading
    if (gameComplete || loadingAssociations) return;
    
    // Play selection sound
    playSelectNote();
    
    // Set loading state
    setLoadingAssociations(true);
    
    // Sanitize input on client side (basic XSS protection)
    const sanitizedWord = word.trim().toLowerCase();
    
    // Add word to path
    const newPath = [...path, sanitizedWord];
    setPath(newPath);
    setCurrentWord(sanitizedWord);
    
    // Increment total steps (forward step)
    const newTotalSteps = totalSteps + 1;
    setTotalSteps(newTotalSteps);
    
    // Check if target word reached (normalize case and whitespace)
    if (sanitizedWord === game.targetWord.toLowerCase().trim()) {
      setGameComplete(true);
      setLoadingAssociations(false); // Reset loading state
      
      // Clear saved progress when the game is completed
      localStorage.removeItem('wordGameProgress');
      
      // Submit result to server with path and step stats for verification
      fetch(`${getApiUrl()}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          path: newPath, // The complete path including start and target
          backSteps: backSteps, // Number of back steps
          totalSteps: newTotalSteps // Total steps including forward and back
        })
      })
        .then(response => response.json())
        .then(data => {
          // Update game with stats from server if available
          if (data && data.success && data.stats) {
            setGame({...game, stats: data.stats});
          }
        })
        .catch(err => {
          console.error('Error submitting results:', err);
          setLoadingAssociations(false);
        });
    } else {
      // Get new associations with detailed info
      fetch(`${getApiUrl()}/associations/${sanitizedWord}?detailed=true`)
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
    
    // Sanitize input before sending to API
    const sanitizedCurrentWord = currentWord.trim().toLowerCase();
    
    // Get hint for the current word
    fetch(`${getApiUrl()}/hint/${sanitizedCurrentWord}`)
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
  
  // Toggle showing the solution/answer
  const toggleShowAnswer = () => {
    // If already showing, just hide it
    if (showAnswer) {
      setShowAnswer(false);
      return;
    }
    
    // Otherwise, request the solution if we don't have it yet
    if (!solution) {
      setLoadingAssociations(true);
      fetch(`${getApiUrl()}/solution?moves=${totalSteps}`)
        .then(response => {
          if (!response.ok) {
            throw new Error('Failed to fetch solution');
          }
          return response.json();
        })
        .then(data => {
          setSolution(data.solution);
          setShowAnswer(true);
          setLoadingAssociations(false);
        })
        .catch(err => {
          console.error('Error fetching solution:', err);
          setError('Failed to get solution. Please try again.');
          setLoadingAssociations(false);
        });
    } else {
      // If we already have the solution, just show it
      setShowAnswer(true);
    }
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

  // Add auto-refresh effect when puzzle is generating
  useEffect(() => {
    let refreshTimer;
    if (error && error.includes('new puzzle coming soon')) {
      // Auto-refresh every 10 seconds to check if puzzle is ready
      refreshTimer = setInterval(() => {
        console.log('Auto-checking for puzzle availability...');
        // Use our loadGameData function instead of full page reload
        loadGameData(true);
      }, 10000); // Check every 10 seconds
    }
    
    return () => {
      if (refreshTimer) clearInterval(refreshTimer);
    };
  }, [error, loadGameData]);
  
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
    const isPuzzleGenerating = error.includes('new puzzle coming soon');
    return (
      <div className="App">
        <header className="App-header">
          <h1>Word Association Game</h1>
          <div className={isPuzzleGenerating ? "loading-container" : ""}>
            {isPuzzleGenerating && <div className="loading-spinner"></div>}
            <p className={isPuzzleGenerating ? "" : "error"}>{error}</p>
            {isPuzzleGenerating && (
              <p className="auto-refresh-notice">
                <small>Checking for new puzzle every 10 seconds...</small>
              </p>
            )}
          </div>
          <button 
            onClick={() => isPuzzleGenerating ? loadGameData(true) : window.location.reload()}
            className={isPuzzleGenerating ? "primary-button" : ""}
          >
            {isPuzzleGenerating ? "Check Now" : "Try Again"}
          </button>
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
        <p>Find your way from <strong style={{color: '#ffcc00'}}>{game.startWord}</strong> to <strong style={{color: '#ffcc00'}}>{game.targetWord}</strong> using word associations!</p>
        <div className="game-info">
          <div className="game-theme">
            {(game.minExpectedSteps !== undefined && game.minExpectedSteps !== null) && 
              <span className="min-steps">Par: {game.minExpectedSteps}</span>
            }
          </div>
          <div className="refresh-timer">
            {game.nextGameTime && (
              <NewPuzzleTimer 
                nextGameTime={game.nextGameTime} 
                onLoadNewPuzzle={() => loadGameData(true)}
              />
            )}
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
                {(game.minExpectedSteps !== undefined && game.minExpectedSteps !== null) && (
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
            {game.stats && (
              <>
                <p className="stats-divider">Game Statistics</p>
                <div className="stats-grid">
                  <div className="stat-box">
                    <div className="stat-title">Path Length</div>
                    <div className="stat-value">
                      {game.stats.averageSteps ? Number(game.stats.averageSteps).toFixed(1) : path.length - 1}
                    </div>
                    <div className="stat-label">
                      {game.stats.averageSteps ? 'avg' : 'your score'}
                    </div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-title">Back Steps</div>
                    <div className="stat-value">
                      {game.stats.averageBackSteps ? Number(game.stats.averageBackSteps).toFixed(1) : backSteps}
                    </div>
                    <div className="stat-label">
                      {game.stats.averageBackSteps ? 'avg' : 'your score'}
                    </div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-title">Total Moves</div>
                    <div className="stat-value">
                      {game.stats.averageTotalSteps ? Number(game.stats.averageTotalSteps).toFixed(1) : totalSteps}
                    </div>
                    <div className="stat-label">
                      {game.stats.averageTotalSteps ? 'avg' : 'your score'}
                    </div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-title">Plays</div>
                    <div className="stat-value">
                      {game.stats.totalPlays || 1}
                    </div>
                    <div className="stat-label">today</div>
                  </div>
                </div>
              </>
            )}
            <div className="path-display">
              Your path: {path.join(' → ')}
            </div>
            <div className="button-group">
              <button onClick={() => window.location.reload()} className="play-again-button">
                Play Again
              </button>
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
              
              {/* Reveal answer button - only shows when player has made 20+ moves */}
              {totalSteps >= 20 && (
                <button
                  onClick={toggleShowAnswer}
                  className={`reveal-button ${showAnswer ? 'active' : ''}`}
                  title="Reveal the solution path"
                >
                  {showAnswer ? "Hide Solution" : "Reveal Solution"}
                </button>
              )}
            </div>
            
            {hint && (
              <div className="hint-display">
                <h3>Hint:</h3>
                <p>{hint}</p>
              </div>
            )}
            
            {/* Display solution when revealed */}
            {showAnswer && solution && (
              <div className="solution-display">
                <h3>Solution Path:</h3>
                <p className="solution-path">{solution.join(' → ')}</p>
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
                <div className={`word-buttons two-columns ${showHints ? 'with-details' : ''}`}>
                  {associations && associations.length > 0 ? (
                    // Filter out words already used in the path
                    associations
                      .filter(word => !path.some(p => p.toLowerCase().trim() === word.toLowerCase().trim()))
                      .map((word, index) => {
                        // Find the detailed association if available
                        const details = detailedAssociations && detailedAssociations.length > 0 
                          ? detailedAssociations.find(d => d.word === word)
                          : null;
                        
                        return (
                          <div key={index} className="word-option">
                            <button 
                              onClick={() => handleWordSelect(word)}
                              disabled={loadingAssociations}
                              // No need for 'used' class since we filter them out entirely
                            >
                              {word}
                            </button>
                            {showHints && details && details.hint && (
                              <div className="word-details">
                                <p className="connection-hint">{details.hint}</p>
                              </div>
                            )}
                          </div>
                        );
                      })
                  ) : (
                    <div className="no-associations">No associations available</div>
                  )}
                  
                  {/* Show a message if all associations are filtered out because they've been used */}
                  {associations && associations.length > 0 && 
                   !associations.some(word => !path.some(p => p.toLowerCase().trim() === word.toLowerCase().trim())) && (
                    <div className="no-associations">All associations have been used. Try going back.</div>
                  )}
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