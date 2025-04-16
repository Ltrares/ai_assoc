import React from 'react';
import './App.css';

function About() {
  return (
    <div className="App">
      <header className="App-header">
        <div className="about-container">
          <h1>About AI Association Game</h1>
          
          <section className="about-section">
            <h2>What is it?</h2>
            <p>
              AI Association Game is a word puzzle that challenges your lateral thinking skills. 
              Starting with one word, you must reach a target word by creating a chain of associated words. 
              Each step must have a clear, intuitive connection to the next.
            </p>
          </section>
          
          <section className="about-section">
            <h2>How to Play</h2>
            <p>
              1. You begin with a starting word and a target word to reach
              <br />
              2. Click on one of the associated words that you think will lead you closer to the target
              <br />
              3. Continue selecting associated words until you reach the target
              <br />
              4. Try to solve the puzzle in as few steps as possible
            </p>
          </section>
          
          <section className="about-section">
            <h2>Game Features</h2>
            <ul>
              <li><strong>Daily Puzzles:</strong> A new puzzle is generated hourly</li>
              <li><strong>Themed Challenges:</strong> Puzzles cover topics like movies, music, sports, food, technology, and more</li>
              <li><strong>Hints:</strong> Get help when you're stuck</li>
              <li><strong>Detailed Explanations:</strong> Learn why words are associated</li>
              <li><strong>Statistics:</strong> Track how many moves it takes to solve</li>
            </ul>
          </section>
          
          <section className="about-section">
            <h2>Technology</h2>
            <p>
              This game is powered by Claude AI from Anthropic, which generates the word associations and hints.
              The frontend is built with React, while the backend uses Node.js and Express.
              The entire codebase was generated interactively with Claude Code.
            </p>
          </section>
          
          <section className="about-section">
            <h2>Project Roadmap</h2>
            <p>
              Future plans include user accounts, leaderboards, custom puzzles, multiplayer mode, 
              and more game features. See our <a href="https://github.com/Ltrares/ai_assoc/blob/main/server/ROADMAP.md" target="_blank" rel="noopener noreferrer">project roadmap</a> for details.
            </p>
          </section>
          
          <div className="back-to-game">
            <button onClick={() => window.location.href = '/'}>Back to Game</button>
          </div>
        </div>
      </header>
    </div>
  );
}

export default About;