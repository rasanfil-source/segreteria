import re

def fix_file():
    with open('gas_gemini_service.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # Define the exact blocks as they should be
    spanish_block = """    const spanishKeywords = [
      'he ido', 'había', 'hay', 'ido', 'sido',
      'hacer', 'haber', 'poder', 'estar', 'estoy', 'están',
      'por qué', 'porque', 'cuándo', 'cómo', 'dónde', 'qué tal',
      'por favor', 'muchas gracias', 'buenos días', 'buenas tardes',
      'misa', 'misas', 'iglesia', 'parroquia',
      'hola', 'gracias', 'necesito', 'quiero',
      'querido', 'estimado', 'saludos',
      'no', 'un', 'unos', 'unas',
      'del', 'con el', 'en el', 'es'
    ];"""

    portuguese_unique_block = """    const portugueseUniqueKeywords = [
      'olá', 'obrigado', 'obrigada', 'agradecemos', 'agradeço',
      'por favor', 'bom dia', 'boa tarde', 'boa noite',
      'missa', 'missas', 'igreja', 'paróquia',
      'atenciosamente', 'cumprimentos', 'abrigado'
    ];"""

    portuguese_standard_block = """    const portugueseStandardKeywords = [
      'por', 'para', 'com', 'não', 'uma', 'seu', 'sua',
      'dos', 'das', 'ao', 'aos'
    ];"""

    italian_block = """    const italianKeywords = [
      'sono', 'siamo', 'stato', 'stata', 'ho', 'hai', 'abbiamo',
      'fare', 'avere', 'essere', 'potere', 'volere',
      'perché', 'perchè', 'quando', 'come', 'dove', 'cosa',
      'per favore', 'per piacere', 'molte grazie', 'buongiorno',
      'buonasera', 'gentile', 'egregio', 'cordiali saluti',
      'non', 'il', 'di', 'da',
      'nel', 'della', 'degli', 'delle'
    ];"""

    # Use regex to find and replace the blocks regardless of their current (possibly corrupted) content
    content = re.sub(r'const spanishKeywords = \[[\s\S]*?\];', spanish_block, content)
    content = re.sub(r'const portugueseUniqueKeywords = \[[\s\S]*?\];', portuguese_unique_block, content)
    content = re.sub(r'const portugueseStandardKeywords = \[[\s\S]*?\];', portuguese_standard_block, content)
    content = re.sub(r'const italianKeywords = \[[\s\S]*?\];', italian_block, content)

    with open('gas_gemini_service.js', 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)

if __name__ == '__main__':
    fix_file()
