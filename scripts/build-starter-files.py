"""Build the small ZIP overlay used to initialize DOSBox after its main bundle."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
examples = json.loads((root / 'programs/examples.json').read_text(encoding='utf-8'))
with ZipFile(root / 'programs/starter-files.bin', 'w', ZIP_DEFLATED) as bundle:
    bundle.writestr('.jsdos/dosbox.conf', (root / 'programs/startup.conf').read_bytes())
    for program in examples:
        bundle.writestr('TURBOC3/BIN/' + program['filename'], program['code'].replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8'))
print('Built programs/starter-files.bin')
