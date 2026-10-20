import Foundation

/// A bounded recovery policy shared by the WebKit delegate and the regression tests.
struct NavigationRecovery {
    enum Action: Equatable {
        case ignore
        case retry(after: TimeInterval)
        case showFailure
    }

    private(set) var generation = 0
    private(set) var retryCount = 0
    private var settled = false

    mutating func begin(preservingRetries: Bool = false) {
        generation += 1
        settled = false
        if !preservingRetries { retryCount = 0 }
    }

    mutating func finish() {
        settled = true
        retryCount = 0
    }

    static func isNavigationInterruption(_ error: NSError) -> Bool {
        (error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled)
            || (error.domain == "WebKitErrorDomain" && error.code == 102)
    }

    mutating func fail(_ error: NSError, generation expected: Int, method: String) -> Action {
        guard expected == generation, !settled else { return .ignore }
        // A replaced navigation, stopLoading, or an external URL hand-off is not a network failure.
        if Self.isNavigationInterruption(error) {
            return .ignore
        }
        settled = true
        let transient = [NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost,
                         NSURLErrorNotConnectedToInternet, NSURLErrorCannotConnectToHost,
                         NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed]
        let safeToReplay = ["GET", "HEAD"].contains(method.uppercased())
        if error.domain == NSURLErrorDomain && transient.contains(error.code)
            && safeToReplay && retryCount < 2 {
            retryCount += 1
            return .retry(after: retryCount == 1 ? 2 : 5)
        }
        return .showFailure
    }
}
