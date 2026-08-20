from pathlib import Path

path = Path("src/iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift")
text = path.read_text(encoding="utf-8")
old = r'String(format: \"%.1f\", progress * 100)'
new = 'String(format: "%.1f", progress * 100)'
if old not in text:
    raise SystemExit("V0.1.2 Swift fix failed: escaped format string not found")
text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")

fixed = path.read_text(encoding="utf-8")
expected = 'String(format: "%.1f", progress * 100)'
if expected not in fixed:
    raise SystemExit("V0.1.2 Swift fix verification failed")
print("BTMobile V0.1.2 Swift format-string fix applied")
