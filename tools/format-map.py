"""Lays out a map JSON from the generator one entry per line, so diffs stay readable.

Usage: python3 tools/format-map.py <generator output> <map file>
"""
import json
import sys

data = json.load(open(sys.argv[1]))
compact = lambda v: json.dumps(v, separators=(',', ':'), ensure_ascii=False)
lines = []
for key, value in data.items():
    if isinstance(value, list):
        inner = ',\n'.join('  ' + compact(v) for v in value)
        lines.append(f' "{key}": [\n{inner}\n ]')
    else:
        lines.append(f' "{key}": {compact(value) if isinstance(value, dict) else json.dumps(value, ensure_ascii=False)}')
open(sys.argv[2], 'w').write('{\n' + ',\n'.join(lines) + '\n}\n')
