import Foundation

/// Only a confirmed, brief route loss can authorize one continuation of the same video.
/// A pause by itself (including AirPods wear detection) never starts recovery.
struct AudioRecovery {
    struct Ticket: Equatable {
        let id: Int
        let media: String
        let outputs: Set<String>
        let deadline: TimeInterval
    }
    static let window: TimeInterval = 12
    static let pauseRace: TimeInterval = 0.75
    private(set) var media: String?
    private(set) var playing = false
    private var pausedAt: TimeInterval?
    private var serial = 0
    private(set) var ticket: Ticket?

    mutating func didPlay(_ key: String) {
        if media != key { cancel() }
        media = key
        playing = true
        pausedAt = nil
    }

    mutating func didPause(_ key: String, now: TimeInterval) {
        guard media == key else { return }
        if playing { pausedAt = now }
        playing = false
        // A second, later pause during recovery is ambiguous: prefer user control.
        if let t = ticket, now > t.deadline - Self.window + Self.pauseRace { cancel() }
    }

    @discardableResult
    mutating func lostRoute(outputs: Set<String>, now: TimeInterval) -> Ticket? {
        if let t = ticket { return now <= t.deadline ? t : nil }
        guard let media, !outputs.isEmpty,
              playing || pausedAt.map({ now >= $0 && now - $0 <= Self.pauseRace }) == true else { return nil }
        serial += 1
        let t = Ticket(id: serial, media: media, outputs: outputs, deadline: now + Self.window)
        ticket = t
        return t
    }

    func mayResume(_ t: Ticket, outputs: Set<String>, now: TimeInterval, active: Bool, blocked: Bool) -> Bool {
        ticket == t && media == t.media && now <= t.deadline && active && !blocked && outputs == t.outputs
    }

    /// Consume before calling play(), including if WebKit rejects its promise. Never loop.
    mutating func consume(_ t: Ticket) {
        guard ticket == t else { return }
        cancel()
    }

    mutating func cancel() {
        serial += 1
        ticket = nil
        media = nil
        playing = false
        pausedAt = nil
    }
}
