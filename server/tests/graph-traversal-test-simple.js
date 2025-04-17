// Simple test to verify the core graph traversal approach
// Run with: node tests/graph-traversal-test-simple.js

console.log("=== SIMPLE GRAPH TRAVERSAL TEST ===");

// Create a simple test graph with a known valid path
const graph = {
  "start": ["a", "b", "c"],
  "a": ["d", "e"],
  "d": ["target", "f"],
  "b": ["g", "h"],
  "c": ["i", "j"],
  "e": ["k", "l"],
  "f": ["m", "n"],
  "g": ["o", "p"],
  "h": ["q", "r"],
  "i": ["s", "t"],
  "j": ["u", "v"]
};

// Simple function to get associations from our predefined graph
async function getAssociations(word) {
  return graph[word] || [];
}

// Function to check if a word is a valid target
async function isValidTargetWord(candidateTarget, previousWords) {
  // In this simple test, "target" is always a valid target if it's not directly
  // associated with any previous words (except the immediate parent)
  if (candidateTarget !== "target") {
    return false; // For simplicity, only "target" is valid
  }
  
  // Only accept "target" if it's not directly connected to any word in the path 
  // except the last one
  for (let i = 0; i < previousWords.length - 1; i++) {
    const word = previousWords[i];
    const associations = await getAssociations(word);
    
    if (associations.includes(candidateTarget)) {
      console.log(`${candidateTarget} is directly associated with ${word} - not valid`);
      return false;
    }
  }
  
  // Make sure the immediate parent has "target" as an association
  const parent = previousWords[previousWords.length - 1];
  const parentAssocs = await getAssociations(parent);
  
  if (!parentAssocs.includes(candidateTarget)) {
    console.log(`${candidateTarget} is not directly associated with the immediate parent ${parent}`);
    return false;
  }
  
  return true;
}

// Find a path through the graph
async function findValidPath() {
  const startWord = "start";
  console.log(`Starting at: ${startWord}`);
  
  // Define parameters
  const MIN_PATH_LENGTH = 3; // at least 3 words total
  const MAX_DEPTH = 5;      // don't go too deep
  
  // Initialize queue for breadth-first search
  const queue = [{
    path: [startWord],
    depth: 1
  }];
  
  // Track visited nodes to avoid cycles
  const visited = new Set([startWord]);
  
  // Process the queue for breadth-first traversal
  let exploredPaths = 0;
  
  while (queue.length > 0) {
    exploredPaths++;
    
    // Get the next path to explore
    const { path, depth } = queue.shift();
    const currentWord = path[path.length - 1];
    
    console.log(`Exploring from: ${currentWord} [depth=${depth}, path=${path.join(' → ')}]`);
    
    // If we've reached sufficient depth, check if this could be a target
    if (depth >= MIN_PATH_LENGTH - 1) {
      // Get associations for current node
      const associations = await getAssociations(currentWord);
      console.log(`Associations for ${currentWord}: ${associations.join(', ')}`);
      
      // Check each association to see if it could be a valid target
      for (const assoc of associations) {
        console.log(`Checking if ${assoc} is a valid target from ${path.join(' → ')}`);
        const isValid = await isValidTargetWord(assoc, path);
        
        if (isValid) {
          const completePath = [...path, assoc];
          console.log(`Found valid path: ${completePath.join(' → ')}`);
          return completePath;
        }
      }
    }
    
    // If we're too deep, stop exploring this path
    if (depth >= MAX_DEPTH) {
      console.log(`Maximum depth reached for ${currentWord}, stopping exploration`);
      continue;
    }
    
    // Get associations for current word
    const associations = await getAssociations(currentWord);
    console.log(`Associations for ${currentWord}: ${associations.join(', ')}`);
    
    // Filter to avoid visited words and add to queue
    for (const nextWord of associations) {
      if (visited.has(nextWord)) {
        continue;
      }
      
      // Mark as visited and create new path
      visited.add(nextWord);
      const newPath = [...path, nextWord];
      queue.push({
        path: newPath,
        depth: depth + 1
      });
      
      console.log(`Added ${nextWord} to queue with path: ${newPath.join(' → ')}`);
    }
  }
  
  console.log(`No valid path found after exploring ${exploredPaths} paths`);
  return null;
}

// Run the test
findValidPath().then(result => {
  if (result) {
    console.log(`\n=== TEST PASSED ===`);
    console.log(`Found path: ${result.join(' → ')}`);
    console.log(`Expected path: start → a → d → target`);
    
    const isExpectedPath = 
      result[0] === "start" && 
      result[1] === "a" && 
      result[2] === "d" && 
      result[3] === "target";
      
    console.log(`Path matches expected: ${isExpectedPath ? 'Yes ✓' : 'No ✗'}`);
  } else {
    console.log(`\n=== TEST FAILED ===`);
    console.log(`No valid path found`);
  }
});