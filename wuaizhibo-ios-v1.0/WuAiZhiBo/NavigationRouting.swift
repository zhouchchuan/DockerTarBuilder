import Foundation

enum NavigationRouting {
    enum Destination: Equatable { case web, external }

    static func destination(for url: URL) -> Destination {
        // javascript:, blob:, data: and about: belong to WebKit. Do not open them with UIApplication.
        let external: Set<String> = ["tel", "telprompt", "mailto", "sms", "weixin", "weixinapp",
                                     "alipay", "alipays", "alipayqr", "itms-apps", "itms-services"]
        return external.contains(url.scheme?.lowercased() ?? "") ? .external : .web
    }

    static func isPageRequest(_ url: URL) -> Bool {
        ["http", "https"].contains(url.scheme?.lowercased() ?? "")
    }

    static func freshRequest(_ request: URLRequest) -> URLRequest {
        var result = request
        result.cachePolicy = .reloadIgnoringLocalCacheData
        result.timeoutInterval = max(120, result.timeoutInterval)
        return result
    }
}
