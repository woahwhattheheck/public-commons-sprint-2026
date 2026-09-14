from pathlib import Path

path = Path('.github/zph_cookie_crumbs_repair.py')
source = path.read_text()
start = source.index('    ci = Path(".github/workflows/cookie-crumbs-ci.yml")')
end = source.index('\n\ndef commit_runtime', start)
source = source[:start] + source[end:]
source = source.replace('        ".github/workflows/cookie-crumbs-ci.yml",\n', '')
path.write_text(source)
exec(compile(source, str(path), 'exec'), {'__name__': '__main__', '__file__': str(path)})
