import re

def fix_file():
    with open('gas_gemini_service.js', 'r', encoding='utf-8') as f:
        lines = f.readlines()

    fixed_lines = []
    for line in lines:
        # Se la riga è lunghissima (>100) e contiene molti '=', la resettiamo
        if len(line) > 100 and line.count('=') > 50:
            # Preserviamo l'indentazione se possibile (spazi iniziali)
            indent = re.match(r'^\s*', line).group(0)
            fixed_lines.append(f"{indent}// " + "=" * 68 + "\n")
        else:
            fixed_lines.append(line)

    content = "".join(fixed_lines)

    # Re-apply accent fixes just in case
    patterns = {
        'ÃƒÂ ': 'à', 'ÃƒÂ ': 'à', 'ÃƒÂ¨': 'è', 'ÃƒÂ©': 'é',
        'ÃƒÂ¬': 'ì', 'ÃƒÂ²': 'ò', 'ÃƒÂ¹': 'ù', 'Ãƒâ‚¬': 'À',
        'Ã¢â‚¬â„¢': "'", 'Ã¢â€ â€™': '→', 'Ã¢Å“â€': '✓',
        'Ã¢Å“â•': '✓', 'Ã¢â€“Â': '■', 'Ã‚Â': ''
    }
    for old, new in patterns.items():
        content = content.replace(old, new)

    with open('gas_gemini_service.js', 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)

if __name__ == '__main__':
    fix_file()
