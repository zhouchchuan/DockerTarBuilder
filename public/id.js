let fallbackSequence = 0;

// randomUUID is unavailable when the WebUI is opened through ordinary LAN
// HTTP (for example http://192.168.50.82:9899). These identifiers only need
// to be unique inside the local configuration, so a timestamp/counter fallback
// keeps rule and downloader creation working without weakening any security.
export function createClientId(prefix = 'item', webCrypto = typeof crypto === 'undefined' ? null : crypto) {
  if (typeof webCrypto?.randomUUID === 'function') {
    try {
      return webCrypto.randomUUID();
    } catch {
      // Some browsers expose the method but reject it outside secure contexts.
    }
  }
  fallbackSequence += 1;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 12);
  return `${prefix}-${timestamp}-${fallbackSequence.toString(36)}-${random}`;
}
