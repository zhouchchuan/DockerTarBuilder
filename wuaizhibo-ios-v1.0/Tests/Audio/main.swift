import Foundation

var checks = 0
func check(_ value: @autoclosure () -> Bool, _ name: String) {
    guard value() else { fatalError("FAILED: \(name)") }; checks += 1
}
let airpods: Set<String> = ["headset-A"]
func playing() -> AudioRecovery { var p = AudioRecovery(); p.didPlay("doc:video"); return p }
func allowed(_ p: AudioRecovery, _ t: AudioRecovery.Ticket, at: Double = 12) -> Bool {
    p.mayResume(t, outputs: airpods, now: at, active: true, blocked: false)
}
var p = AudioRecovery()
check(p.lostRoute(outputs: airpods, now: 10) == nil, "idle never resumes")
p = playing()
check(p.lostRoute(outputs: [], now: 10) == nil, "speaker/wired/HFP not eligible")
let t = p.lostRoute(outputs: airpods, now: 10)!
check(allowed(p, t), "same Bluetooth device within window")
check(!p.mayResume(t, outputs: [], now: 12, active: true, blocked: false), "no speaker playback")
check(!p.mayResume(t, outputs: ["headset-B"], now: 12, active: true, blocked: false), "different headset")
check(!p.mayResume(t, outputs: ["headset-A", "headset-B"], now: 12, active: true, blocked: false), "additional output")
check(!p.mayResume(t, outputs: airpods, now: 12, active: false, blocked: false), "inactive")
check(!p.mayResume(t, outputs: airpods, now: 12, active: true, blocked: true), "call or Siri interruption")
check(!allowed(p, t, at: 22.001), "12 second expiry")
check(p.lostRoute(outputs: airpods, now: 11) == t, "duplicate loss does not extend deadline")
check(p.lostRoute(outputs: airpods, now: 23) == nil, "expired ticket not rearmed")
p.consume(t)
check(!allowed(p, t), "one attempt only")
check(p.lostRoute(outputs: airpods, now: 24) == nil, "failed play cannot loop")
p = playing(); p.didPause("doc:video", now: 9.5)
let raced = p.lostRoute(outputs: airpods, now: 10)
check(raced != nil, "pause can arrive before route notification")
p = playing(); p.didPause("doc:video", now: 9)
check(p.lostRoute(outputs: airpods, now: 10) == nil, "previously paused remains paused")
p = playing(); p.didPause("another:video", now: 9)
check(p.playing, "unrelated video pause ignored")
p = playing(); let lost = p.lostRoute(outputs: airpods, now: 10)!
p.didPause("doc:video", now: 10.3)
check(allowed(p, lost), "immediate route pause eligible")
p.didPause("doc:video", now: 12)
check(!allowed(p, lost), "later ambiguous pause cancels")
p = playing(); let old = p.lostRoute(outputs: airpods, now: 10)!
p.didPlay("new-document:video")
check(!allowed(p, old), "navigation or video switch")
p = playing(); let cancelled = p.lostRoute(outputs: airpods, now: 10)!
p.cancel()
check(!allowed(p, cancelled), "manual pause/background/interruption invalidation")
p.didPlay("doc:video"); let next = p.lostRoute(outputs: airpods, now: 11)!
check(next.id != cancelled.id, "stale asynchronous task has different identity")
p.consume(cancelled)
check(allowed(p, next), "old completion cannot consume new ticket")
p = playing(); p.didPause("doc:video", now: 10)
check(p.ticket == nil, "pause without route event never creates recovery")
print("Audio recovery: \(checks) checks passed")
