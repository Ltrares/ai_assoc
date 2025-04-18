/**
 * Utility for sanitizing user input to prevent injection attacks
 */

/**
 * Sanitizes user input by removing potentially harmful characters
 * @param {string} input - The input to sanitize 
 * @returns {string} - The sanitized input string
 */
function sanitizeInput(input) {
  // Return empty string if input is not a string or is empty
  if (typeof input !== 'string' || input.trim() === '') {
    return '';
  }

  // Trim whitespace and convert to lowercase
  const trimmed = input.trim().toLowerCase();
  
  // Sanitize input to prevent HTML/script injection
  // We replace < and > characters to prevent HTML/script injection
  return trimmed
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\\/g, '&#092;');
}

module.exports = {
  sanitizeInput
};