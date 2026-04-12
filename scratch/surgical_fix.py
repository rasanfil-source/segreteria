import os

def final_sanitizer():
    # Mappa delle sequenze orrende trovate nel grep/logs verso i simboli corretti
    horrible_patterns = {
        '???': '🔍',
        'Ã°Å¸â€Â': '🔍',
        'Ã°Å¸â\x80\x9dÂ': '🔍',
        'Vo ': '🔍 ', 
        'Ã¢Å¡Â ': '⚠️ ',
        'Ã¢ÂÅ’': '❌',
        'Ã°Å¸ÂšÂ€': '🚀',
        'Ã¢Å“â•': '✓',
    }
    
    for file in os.listdir('.'):
        if not file.endswith('.js'):
            continue
            
        with open(file, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
            
        new_lines = []
        modified = False
        for line in lines:
            new_line = line
            for old, new in horrible_patterns.items():
                if old in new_line:
                    new_line = new_line.replace(old, new)
                    modified = True
            
            # Fix specifico per la riga della lente d'ingrandimento se ancora corrotta
            if 'Controllo rapido via' in new_line and ('?' in new_line or '' in new_line):
                # Ricostruiamo la riga in modo pulito
                indent = line[:line.find('console.log')] if 'console.log' in line else '    '
                if '${modelName}' in line:
                    new_line = f"{indent}console.log(`🔍 Controllo rapido via ${{modelName}}...`);\n"
                elif '${result.modelUsed}' in line:
                    new_line = f"{indent}console.log(`🔍 Controllo rapido via Rate Limiter(modello: ${{result.modelUsed}})`);\n"
                modified = True
                
            new_lines.append(new_line)
            
        if modified:
            with open(file, 'w', encoding='utf-8', newline='\n') as f:
                f.writelines(new_lines)
            print(f"File risanato: {file}")

if __name__ == '__main__':
    final_sanitizer()
