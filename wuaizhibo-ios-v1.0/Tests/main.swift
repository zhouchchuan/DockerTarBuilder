import Foundation

var checks = 0
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    precondition(condition(), message)
    checks += 1
}
func error(_ code: Int, domain: String = NSURLErrorDomain) -> NSError {
    NSError(domain: domain, code: code)
}
var state = NavigationRecovery()
state.begin()
check(state.fail(error(NSURLErrorCancelled), generation: state.generation, method: "GET") == .ignore,
      "Cancelled navigation must not show a failure or schedule a reload")
check(state.retryCount == 0, "Cancellation must not consume retry budget")
check(state.fail(error(NSURLErrorTimedOut), generation: state.generation, method: "GET") == .retry(after: 2),
      "First timeout should retry after two seconds")
check(state.fail(error(NSURLErrorTimedOut), generation: state.generation, method: "GET") == .ignore,
      "Duplicate failure callback must not schedule another retry")
state.begin(preservingRetries: true)
check(state.fail(error(NSURLErrorNetworkConnectionLost), generation: state.generation, method: "GET") == .retry(after: 5),
      "Second transient failure should retry after five seconds")
state.begin(preservingRetries: true)
check(state.fail(error(NSURLErrorTimedOut), generation: state.generation, method: "GET") == .showFailure,
      "Retries must stop after two attempts")
check(state.fail(error(NSURLErrorTimedOut), generation: state.generation, method: "GET") == .ignore,
      "Repeated terminal callbacks must not repeat the UI")
let oldGeneration = state.generation
state.begin()
check(state.retryCount == 0, "A user navigation receives a fresh retry budget")
check(state.fail(error(NSURLErrorTimedOut), generation: oldGeneration, method: "GET") == .ignore,
      "An obsolete navigation must not affect a new page")
state.finish()
check(state.fail(error(NSURLErrorTimedOut), generation: state.generation, method: "GET") == .ignore,
      "Late failures after successful loading must be ignored")
for code in [NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost, NSURLErrorNotConnectedToInternet,
             NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed] {
    state.begin()
    check(state.fail(error(code), generation: state.generation, method: "GET") == .retry(after: 2),
          "Recoverable network errors should receive a bounded retry")
}
for method in ["POST", "PUT", "PATCH", "DELETE"] {
    state.begin()
    check(state.fail(error(NSURLErrorTimedOut), generation: state.generation, method: method) == .showFailure,
          "State-changing requests must never be automatically replayed")
}
for code in [NSURLErrorServerCertificateUntrusted, NSURLErrorSecureConnectionFailed, NSURLErrorBadURL] {
    state.begin()
    check(state.fail(error(code), generation: state.generation, method: "GET") == .showFailure,
          "TLS and malformed URL errors must not be retried as transient network errors")
}
state.begin()
check(state.fail(error(NSURLErrorCancelled, domain: "DifferentErrorDomain"), generation: state.generation, method: "GET") == .showFailure,
      "The domain must be checked as well as the error code")
state.begin()
check(state.fail(error(NSURLErrorTimedOut), generation: state.generation, method: "HEAD") == .retry(after: 2),
      "HEAD requests can be retried safely")
state.begin()
check(state.fail(error(102, domain: "WebKitErrorDomain"), generation: state.generation, method: "GET") == .ignore,
      "A WebKit policy hand-off must not report a network failure")
check(state.retryCount == 0, "Policy interruption must not consume retry budget")
check(state.fail(error(NSURLErrorTimedOut), generation: state.generation, method: "GET") == .retry(after: 2),
      "A policy interruption must leave the replacement navigation able to recover")
state.begin()
check(state.fail(error(102, domain: "WKErrorDomain"), generation: state.generation, method: "GET") == .showFailure,
      "Only the legacy WebKit policy error domain is ignored")
state.begin()
check(state.fail(error(101, domain: "WebKitErrorDomain"), generation: state.generation, method: "GET") == .showFailure,
      "Other WebKit failures must remain visible")
print("Navigation recovery: \(checks) checks passed")
