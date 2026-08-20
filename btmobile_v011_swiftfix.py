from pathlib import Path

p = Path("src/iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift")
text = p.read_text(encoding="utf-8")

replacements = {
    '(lhs["downloadRate"] as? NSNumber)?.int64Value ?? 0': '(lhs["downloadRate"] as? Int64) ?? 0',
    '(lhs["uploadRate"] as? NSNumber)?.int64Value ?? 0': '(lhs["uploadRate"] as? Int64) ?? 0',
    '(rhs["downloadRate"] as? NSNumber)?.int64Value ?? 0': '(rhs["downloadRate"] as? Int64) ?? 0',
    '(rhs["uploadRate"] as? NSNumber)?.int64Value ?? 0': '(rhs["uploadRate"] as? Int64) ?? 0',
    '(peer["port"] as? NSNumber)?.intValue ?? 0': '(peer["port"] as? Int) ?? 0',
    '(peer["downloadRate"] as? NSNumber)?.int64Value ?? 0': '(peer["downloadRate"] as? Int64) ?? 0',
    '(peer["uploadRate"] as? NSNumber)?.int64Value ?? 0': '(peer["uploadRate"] as? Int64) ?? 0',
    '(peer["holepunched"] as? NSNumber)?.boolValue ?? false': '(peer["holepunched"] as? Bool) ?? false',
    '                style: .platformPlain,\n': '',
}

for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f"SWIFT FIX FAILED: pattern not found: {old}")
    text = text.replace(old, new)

p.write_text(text, encoding="utf-8")
print("Swift 6 peer telemetry fixes applied")
