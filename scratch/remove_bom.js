const fs = require('fs');
const path = 'gas_gemini_service.js';
const buffer = fs.readFileSync(path);
if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
  console.log('BOM detected, removing...');
  const newBuffer = buffer.slice(3);
  fs.writeFileSync(path, newBuffer);
  console.log('BOM removed successfully.');
} else {
  console.log('No BOM detected.');
}
