
function testRegex() {
    const text = "Via cancani 2 e via aldrovandi 8";
    const pattern = /((?:via|viale|piazza|piazzale|largo|lungotevere|salita)\s+(?:[a-zA-ZàèéìòùÀÈÉÌÒÙ']+\s+){0,6}?[a-zA-ZàèéìòùÀÈÉÌÒÙ']+)(?!\s*(?:n\.?\s*|civico\s+)?\d+)/gi;

    let match;
    console.log("Testing text:", text);
    while ((match = pattern.exec(text)) !== null) {
        console.log("Match found:", match[1]);
    }
}

testRegex();
