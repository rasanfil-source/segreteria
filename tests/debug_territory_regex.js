
function testTerritoryRegex() {
  const streetType = 'v[\\s.]*[iìíï][\\s.]*a(?:[\\s.]*l[\\s.]*e)?|p[\\s.]*[iìíï][\\s.]*a[\\s.]*z[\\s.]*z[\\s.]*a(?:[\\s.]*l[\\s.]*e)?|l[\\s.]*a[\\s.]*r[\\s.]*g[\\s.]*o|l[\\s.]*u[\\s.]*n[\\s.]*g[\\s.]*o[\\s.]*t[\\s.]*e[\\s.]*v[\\s.]*e[\\s.]*r[\\s.]*e|s[\\s.]*a[\\s.]*l[\\s.]*[iìíï][\\s.]*t[\\s.]*a';
  const pattern = new RegExp(`\\b(${streetType})(?:\\s*:\\s*|\\s+)([a-zA-ZàèéìòùÀÈÉÌÒÙ']{1,50}(?:\\s+[a-zA-ZàèéìòùÀÈÉÌÒÙ']{1,50}){0,5})\\s{0,3}(?:,|\\.|\\-|numero|civico|n\\.?|n[°º])?\\s{0,3}(\\d{1,4}(?:[/-]?[a-zA-Z])?)\\b`, 'gi');

  const texts = [
    "Via Roma 10",
    "Via G. Bruno 5",
    "Via 24 Maggio 10",
    "Via S. Francesco 5"
  ];

  texts.forEach(text => {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      console.log(`MATCH FOUND for "${text}": Type="${match[1]}", Name="${match[2]}", Civic="${match[3]}"`);
    } else {
      console.log(`NO MATCH for "${text}"`);
    }
  });
}

testTerritoryRegex();
