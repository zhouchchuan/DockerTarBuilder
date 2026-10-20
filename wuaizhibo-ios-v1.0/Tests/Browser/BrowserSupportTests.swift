import XCTest
import WebKit
@testable import BrowserSupport

final class BrowserSupportTests: XCTestCase {
    func testBrowserURLsStayInsideWebKit() {
        for raw in [
            "https://jiami.ttplays.uk:6067/index.php/vod/play/id/918/sid/1/nid/2.html",
            "https://100play.win/index.php/vod/play/id/918/sid/1/nid/3.html",
            "http://example.test/video#episode2", "about:blank",
            "javascript:void(0)", "blob:https://example.test/id", "data:text/html,hello"
        ] {
            XCTAssertEqual(NavigationRouting.destination(for: URL(string: raw)!), .web, raw)
        }
        XCTAssertFalse(NavigationRouting.isPageRequest(URL(string: "javascript:void(0)")!))
        XCTAssertTrue(NavigationRouting.isPageRequest(URL(string: "https://example.test/episode/2")!))
    }

    func testExplicitExternalApplicationsStillOpenExternally() {
        for raw in ["tel:123", "sms:123", "mailto:test@example.test", "weixin://pay",
                    "alipays://platformapi/startapp", "itms-apps://itunes.apple.com/app/id1"] {
            XCTAssertEqual(NavigationRouting.destination(for: URL(string: raw)!), .external)
        }
    }

    func testFreshRequestPreservesEpisodeHeadersAndFormBody() {
        var original = URLRequest(url: URL(string: "https://example.test/episode?sid=1&nid=2")!,
                                  cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 15)
        original.httpMethod = "POST"
        original.httpBody = Data("episode=2&token=example".utf8)
        original.setValue("https://example.test/list", forHTTPHeaderField: "Referer")
        original.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let updated = NavigationRouting.freshRequest(original)
        XCTAssertEqual(updated.url, original.url)
        XCTAssertEqual(updated.httpMethod, "POST")
        XCTAssertEqual(updated.httpBody, original.httpBody)
        XCTAssertEqual(updated.allHTTPHeaderFields, original.allHTTPHeaderFields)
        XCTAssertEqual(updated.cachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertEqual(updated.timeoutInterval, 120)
        original.timeoutInterval = 180
        XCTAssertEqual(NavigationRouting.freshRequest(original).timeoutInterval, 180)
    }

    func testCacheDeletionExcludesAccountData() {
        let retained: Set<String> = [WKWebsiteDataTypeCookies, WKWebsiteDataTypeLocalStorage,
                                    WKWebsiteDataTypeSessionStorage, WKWebsiteDataTypeIndexedDBDatabases]
        XCTAssertTrue(BrowserCache.disposableTypes.isDisjoint(with: retained))
        XCTAssertTrue(BrowserCache.disposableTypes.contains(WKWebsiteDataTypeDiskCache))
        XCTAssertTrue(BrowserCache.disposableTypes.contains(WKWebsiteDataTypeMemoryCache))
        XCTAssertTrue(BrowserCache.disposableTypes.contains(WKWebsiteDataTypeFetchCache))
        XCTAssertTrue(BrowserCache.disposableTypes.contains(WKWebsiteDataTypeServiceWorkerRegistrations))
    }

    @MainActor func testUpgradeClearsCachesOnceAndPreservesLoginCookieAndLocalStorage() throws {
        let suite = "WuAiUpgradeTest-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = WKWebsiteDataStore.nonPersistent()
        let fixture = BrowserFixture(store: store)
        fixture.load()
        wait(for: [fixture.loaded], timeout: 20)
        fixture.evaluate("localStorage.setItem('login-marker','retained'); true") { result in
            XCTAssertEqual(result as? Bool, true)
        }
        let cookie = HTTPCookie(properties: [
            .domain: "example.test", .path: "/", .name: "login", .value: "retained"
        ])!
        let cookieSet = expectation(description: "set login cookie")
        store.httpCookieStore.setCookie(cookie) { cookieSet.fulfill() }
        wait(for: [cookieSet], timeout: 10)
        let request = URLRequest(url: URL(string: "https://example.test/cache-check")!)
        let cached = CachedURLResponse(response: URLResponse(url: request.url!, mimeType: "text/html",
                                      expectedContentLength: 3, textEncodingName: "utf-8"), data: Data("old".utf8))
        URLCache.shared.storeCachedResponse(cached, for: request)
        XCTAssertNotNil(URLCache.shared.cachedResponse(for: request))
        let prepared = expectation(description: "upgrade migration")
        BrowserCache.prepare(store, defaults: defaults) {
            XCTAssertTrue(Thread.isMainThread)
            XCTAssertTrue(defaults.bool(forKey: BrowserCache.migrationKey))
            prepared.fulfill()
        }
        wait(for: [prepared], timeout: 20)
        XCTAssertNil(URLCache.shared.cachedResponse(for: request))
        let cookiesRead = expectation(description: "read preserved login cookie")
        store.httpCookieStore.getAllCookies { cookies in
            XCTAssertTrue(cookies.contains { $0.name == "login" && $0.value == "retained" })
            cookiesRead.fulfill()
        }
        wait(for: [cookiesRead], timeout: 10)
        // Reload to make sure the account marker survives a new document, not only the old JS context.
        fixture.loaded = expectation(description: "reload fixture after cache clear")
        fixture.webView.reload()
        wait(for: [fixture.loaded], timeout: 20)
        fixture.evaluate("localStorage.getItem('login-marker')") { result in
            XCTAssertEqual(result as? String, "retained")
        }
        URLCache.shared.storeCachedResponse(cached, for: request)
        let secondLaunch = expectation(description: "second launch does not delete cache")
        BrowserCache.prepare(store, defaults: defaults) { secondLaunch.fulfill() }
        wait(for: [secondLaunch], timeout: 10)
        XCTAssertNotNil(URLCache.shared.cachedResponse(for: request))
        let manualRetry = expectation(description: "manual retry clears again")
        BrowserCache.refresh(store) { manualRetry.fulfill() }
        wait(for: [manualRetry], timeout: 20)
        XCTAssertNil(URLCache.shared.cachedResponse(for: request))
    }

    @MainActor func testWebKitScriptEpisodeAndPopupKeepOpener() {
        let fixture = BrowserFixture(store: .nonPersistent())
        fixture.load()
        wait(for: [fixture.loaded], timeout: 20)
        fixture.evaluate("document.getElementById('episode').click(); document.body.dataset.episode") {
            XCTAssertEqual($0 as? String, "2")
        }
        fixture.popupLoaded = expectation(description: "popup loaded by WebKit")
        fixture.evaluate("window.open('fixture://example.test/popup','episodeWindow'); true") {
            XCTAssertEqual($0 as? Bool, true)
        }
        wait(for: [fixture.popupLoaded!], timeout: 20)
        XCTAssertEqual(fixture.popupCreations, 1)
        fixture.evaluate("window.opener != null", inPopup: true) {
            XCTAssertEqual($0 as? Bool, true)
        }
        fixture.evaluate("window.opener.document.body.dataset.episode", inPopup: true) {
            XCTAssertEqual($0 as? String, "2")
        }
        XCTAssertTrue(fixture.errors.isEmpty, "\(fixture.errors)")
    }
}

// Exercises real WebKit APIs on the macOS runner without the private site's login or external network.
// UIKit presentation and the user's real episode page still require the iPhone upgrade acceptance test.
@MainActor private final class BrowserFixture: NSObject, WKNavigationDelegate, WKUIDelegate, WKURLSchemeHandler {
    var webView: WKWebView!
    var popup: WKWebView?
    var loaded = XCTestExpectation(description: "fixture load")
    var popupLoaded: XCTestExpectation?
    var popupCreations = 0
    var errors: [NSError] = []

    init(store: WKWebsiteDataStore) {
        super.init()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = store
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.setURLSchemeHandler(self, forURLScheme: "fixture")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    func load() { webView.load(URLRequest(url: URL(string: "fixture://example.test/index")!)) }

    func evaluate(_ script: String, inPopup: Bool = false, check: @escaping (Any?) -> Void) {
        let evaluated = XCTestExpectation(description: "script result")
        (inPopup ? popup : webView)?.evaluateJavaScript(script) { result, error in
            XCTAssertNil(error)
            check(result)
            evaluated.fulfill()
        }
        XCTAssertEqual(XCTWaiter.wait(for: [evaluated], timeout: 10), .completed)
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let html = """
        <!doctype html><html><body>
        <a id="episode" href="javascript:document.body.dataset.episode='2';void(0)">Episode 2</a>
        </body></html>
        """
        let data = Data(html.utf8)
        urlSchemeTask.didReceive(URLResponse(url: urlSchemeTask.request.url!, mimeType: "text/html",
                                           expectedContentLength: data.count, textEncodingName: "utf-8"))
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView === popup { popupLoaded?.fulfill() } else { loaded.fulfill() }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        errors.append(error as NSError)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let external = navigationAction.request.url.map { NavigationRouting.destination(for: $0) == .external } ?? false
        decisionHandler(external ? .cancel : .allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        popupCreations += 1
        let child = WKWebView(frame: .zero, configuration: configuration)
        child.navigationDelegate = self
        child.uiDelegate = self
        popup = child
        return child
    }
}
