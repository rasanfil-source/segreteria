const fs = require('fs');

const files = fs.readdirSync('.').filter(f => f.endsWith('.js'));
files.forEach(f => {
  const buffer = fs.readFileSync(f);
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    console.log(`❌ BOM rilevato: ${f}`);
  }
});
