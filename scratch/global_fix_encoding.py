import os
import re

def fix_encoding(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except UnicodeDecodeError:
        # Se non è UTF-8, proviamo a leggerlo come latin-1 e convertirlo
        with open(file_path, 'r', encoding='latin-1') as f:
            content = f.read()

    # Mappa di riparazione per Mojibake comuni (UTF-8 interpretato come Latin-1)
    patterns = {
        'Ã°ÂŸÂ”Â': '🔍',
        'Ã°ÂŸÂ’Â¡': '💡',
        'Ã°ÂŸÂ“Â§': '📧',
        'Ã°ÂŸÂ“Â¦': '📦',
        'Ã°ÂŸÂšÂ€': '🚀',
        'Ã°ÂŸÂ“ÂŠ': '📊',
        'Ã°ÂŸÂ§Â ': '🧠',
        'Ã°ÂŸÂŒÂ ': '🌐',
        'Ã¢ÂšÂ': '⚠️',
        'Ã¯Â¸Â': '', # Variant selector spesso corrotto
        'Ã¢ÂœÂ…': '✅',
        'Ã¢ÂœÂ–': '✖',
        'Ã¢ÂœÂ–': '❌',
        'Ã¢ÂœÂ–': '❌',
        'Ã¢ÂÂ': '❌',
        'Ã¢ÂœÂ“': '✓',
        'Ã¢Â–Â': '■',
        'Ã¢Â—Â': '⊖',
        'Ã°ÂŸÂÂ': '🔒',
        'Ã°ÂŸÂÂ“': '🔓',
        'Ã°ÂŸÂ•Â': '⏳',
        'Ã¢Â†Â³': '↪️',
        'Ã¢ÂšÂ«': '🛑',
        'Ã¢Â†Â»': '↻',
        'Ã¢ÂœÂ•': '✕',
        'ÃƒÂ ': 'à', 'ÃƒÂ ': 'à', 'ÃƒÂ¨': 'è', 'ÃƒÂ©': 'é',
        'ÃƒÂ¬': 'ì', 'ÃƒÂ²': 'ò', 'ÃƒÂ¹': 'ù', 'Ãƒâ‚¬': 'À',
        'Ã¢â‚¬â„¢': "'", 'Ã¢â€ â€™': '→', 'Ã‚Â': '',
        'Ã¢â€¢Â': '=', # Fix separatori
    }
    
    # Emojis specifiche viste nei log
    content = content.replace('Ã°Å¸â€Â', '🔍')
    content = content.replace('Ã¢Å¡Â', '⚠️')
    content = content.replace('Ã¢ÂÅ’', '❌')
    content = content.replace('Ã¢Å“â•', '✓')
    content = content.replace('Ã°Å¸â€™Â¡', '💡')
    content = content.replace('Ã°Å¸Â“Â§', '📧')
    content = content.replace('Ã°Å¸ÂšÂ€', '🚀')
    content = content.replace('Ã¢ÂÂ»', '↻')
    content = content.replace('Ã¢ÂÂ³', '↪️')
    content = content.replace('Ã¢ÂšÂ«', '🛑')
    content = content.replace('Ã¢Â—Â', '⊖')

    # Fix separatori infiniti o multipli
    content = re.sub(r'Ã¢â€¢Â+', '====================================================================', content)
    
    for old, new in patterns.items():
        content = content.replace(old, new)

    # Collassa separatori eccessivi
    content = re.sub(r'(=| ){100,}', ' ====================================================================', content)

    with open(file_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print(f"File bonificato: {file_path}")

def run_global_fix():
    for file in os.listdir('.'):
        if file.endswith('.js'):
            fix_encoding(file)

if __name__ == '__main__':
    run_global_fix()
