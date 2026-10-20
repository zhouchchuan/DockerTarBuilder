import Foundation
import WebKit

/// Reset render/HTTP caches after a server migration without deleting account storage.
enum BrowserCache {
    static let migrationKey = "WuAiWebCacheMigration-1.0.4"
    static let disposableTypes: Set<String> = [
        WKWebsiteDataTypeMemoryCache, WKWebsiteDataTypeDiskCache,
        WKWebsiteDataTypeFetchCache, WKWebsiteDataTypeServiceWorkerRegistrations
    ]

    static func prepare(_ store: WKWebsiteDataStore, defaults: UserDefaults = .standard,
                        completion: @escaping () -> Void) {
        guard !defaults.bool(forKey: migrationKey) else { completion(); return }
        refresh(store) {
            defaults.set(true, forKey: migrationKey)
            completion()
        }
    }

    static func refresh(_ store: WKWebsiteDataStore, completion: @escaping () -> Void) {
        // These are per-app stores. Cookies, local/session storage and IndexedDB stay intact.
        // This does not claim to flush the system DNS resolver, which has no public WKWebView API.
        URLCache.shared.removeAllCachedResponses()
        store.removeData(ofTypes: disposableTypes, modifiedSince: .distantPast) {
            DispatchQueue.main.async(execute: completion)
        }
    }
}
