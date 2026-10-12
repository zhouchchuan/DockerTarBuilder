import UIKit
import WebKit
import AVFAudio
import OSLog

/// Public AVAudioSession/WebKit APIs only. No route override, HFP, microphone or background audio.
final class WebAudioCoordinator: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private let session = AVAudioSession.sharedInstance()
    private let log = Logger(subsystem: "com.chatapp.bqimvip", category: "AudioRecovery")
    private var policy = AudioRecovery()
    private var frame: WKFrameInfo?
    private var document = ""
    private var media = ""
    private var observers: [NSObjectProtocol] = []
    private var resumeWork: DispatchWorkItem?
    private var expiryWork: DispatchWorkItem?
    private var knownOutputs = Set<String>()
    private var otherInterruption = false
    private var sessionActive = false
    private var armedID: Int?
    private var now: TimeInterval { ProcessInfo.processInfo.systemUptime }
    private var active: Bool { UIApplication.shared.applicationState == .active }

    func install(on controller: WKUserContentController) {
        controller.add(WeakScriptHandler(self), name: "WuAiAudio")
        if let url = Bundle.main.url(forResource: "AudioRecovery", withExtension: "js"),
           let source = try? String(contentsOf: url, encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        }
        configureSession()
        knownOutputs = bluetoothOutputs(session.currentRoute)
        observe(AVAudioSession.routeChangeNotification) { $0.routeChanged($1) }
        observe(AVAudioSession.interruptionNotification) { $0.interrupted($1) }
        observe(AVAudioSession.mediaServicesWereLostNotification) { owner, _ in
            owner.invalidate(); owner.sessionActive = false
        }
        observe(AVAudioSession.mediaServicesWereResetNotification) { owner, _ in
            owner.invalidate(); owner.sessionActive = false; owner.configureSession()
        }
        observe(UIApplication.didEnterBackgroundNotification) { owner, _ in
            owner.invalidate()
            if owner.sessionActive {
                try? owner.session.setActive(false, options: .notifyOthersOnDeactivation)
                owner.sessionActive = false
            }
        }
        observe(UIApplication.didBecomeActiveNotification) { owner, _ in owner.scheduleResume() }
    }

    func attach(_ webView: WKWebView) { self.webView = webView }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
        resumeWork?.cancel(); expiryWork?.cancel()
    }

    private func configureSession() {
        do {
            // Playback already supports A2DP; requesting playAndRecord/HFP can switch AirPods profiles.
            try session.setCategory(.playback, mode: .moviePlayback, options: [])
        } catch { log.error("Audio configuration failed: \((error as NSError).code)") }
    }

    private func observe(_ name: Notification.Name, handler: @escaping (WebAudioCoordinator, Notification) -> Void) {
        observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
            guard let self else { return }; handler(self, note)
        })
    }

    private func bluetoothOutputs(_ route: AVAudioSessionRouteDescription) -> Set<String> {
        // Reject mixed outputs and call-mode HFP; never resume over the loudspeaker.
        guard !route.outputs.isEmpty,
              route.outputs.allSatisfy({ ($0.portType == .bluetoothA2DP || $0.portType == .bluetoothLE) && !$0.uid.isEmpty }) else { return [] }
        return Set(route.outputs.map(\.uid))
    }

    func invalidate() {
        policy.cancel(); armedID = nil
        resumeWork?.cancel(); expiryWork?.cancel()
        resumeWork = nil; expiryWork = nil
        if let frame {
            webView?.callAsyncJavaScript("window.__WuAiAudio103?.cancel();", arguments: [:], in: frame, in: .page, completionHandler: nil)
        }
        self.frame = nil; document = ""; media = ""
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.name == "WuAiAudio", origin.protocol == "https", origin.host == "jiami.ttplays.uk", origin.port == 6067,
              let body = message.body as? [String: Any], let event = body["event"] as? String,
              let doc = body["doc"] as? String, let item = body["media"] as? String,
              doc.count < 100, item.count < 40 else { return }
        let key = doc + ":" + item
        switch event {
        case "playing":
            guard active, !otherInterruption else { return }
            if policy.media != key { invalidate() }
            document = doc; media = item; frame = message.frameInfo
            policy.didPlay(key)
            knownOutputs = bluetoothOutputs(session.currentRoute)
            if !sessionActive {
                do { try session.setActive(true); sessionActive = true }
                catch { log.error("Audio activation failed: \((error as NSError).code)") }
            }
        case "pause":
            guard policy.media == key else { return }
            policy.didPause(key, now: now)
            log.info("Video pause; recovery pending: \(self.policy.ticket != nil)")
            if policy.ticket == nil { armedID = nil; resumeWork?.cancel() }
        case "cancel":
            // User interaction in any participating frame invalidates recovery, even on a parent page.
            invalidate()
        default: break
        }
    }

    private func routeChanged(_ note: Notification) {
        let raw = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue ?? 0
        let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
        let current = bluetoothOutputs(session.currentRoute)
        log.info("Route change reason: \(raw); Bluetooth output: \(!current.isEmpty)")
        if reason == .oldDeviceUnavailable {
            let previous = note.userInfo?[AVAudioSessionRouteChangePreviousRouteKey] as? AVAudioSessionRouteDescription
            beginLoss(previous.map(bluetoothOutputs) ?? knownOutputs)
        } else if reason == .override {
            invalidate()
        }
        knownOutputs = current
        scheduleResume()
    }

    private func interrupted(_ note: Notification) {
        let info = note.userInfo ?? [:]
        let type = (info[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue
        guard let type, let kind = AVAudioSession.InterruptionType(rawValue: type) else { return }
        if kind == .began {
            sessionActive = false
            let raw = (info[AVAudioSessionInterruptionReasonKey] as? NSNumber)?.uintValue
            var routeLoss = false
            if #available(iOS 17.0, *), let raw {
                routeLoss = AVAudioSession.InterruptionReason(rawValue: raw) == .routeDisconnected
            }
            log.info("Audio interruption; route loss: \(routeLoss)")
            if routeLoss { beginLoss(knownOutputs); scheduleResume() }
            else { otherInterruption = true; invalidate() }
        } else {
            // Calls, Siri and unknown interruptions do not carry a recovery ticket forward.
            if otherInterruption { otherInterruption = false; invalidate(); return }
            let options = AVAudioSession.InterruptionOptions(rawValue: (info[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue ?? 0)
            if options.contains(.shouldResume) { scheduleResume() }
            else { invalidate() }
        }
    }

    private func beginLoss(_ outputs: Set<String>) {
        guard active, !otherInterruption, let frame,
              let t = policy.lostRoute(outputs: outputs, now: now) else { return }
        guard armedID != t.id else { return }
        armedID = t.id
        let args: [String: Any] = ["doc": document, "media": media, "id": t.id]
        webView?.callAsyncJavaScript("return window.__WuAiAudio103?.arm(doc, media, id) === true;", arguments: args, in: frame, in: .page) { [weak self] result in
            guard let self, self.policy.ticket == t else { return }
            guard case .success(let value) = result, (value as? Bool) == true else { self.invalidate(); return }
            self.scheduleResume()
        }
        expiryWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.policy.ticket == t else { return }
            self.log.info("Bluetooth continuation expired"); self.invalidate()
        }
        expiryWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, t.deadline - now), execute: work)
    }

    private func scheduleResume() {
        resumeWork?.cancel(); resumeWork = nil
        guard let t = policy.ticket, armedID == t.id,
              policy.mayResume(t, outputs: bluetoothOutputs(session.currentRoute), now: now, active: active, blocked: otherInterruption) else { return }
        let work = DispatchWorkItem { [weak self] in self?.resume(t) }
        resumeWork = work
        // Coalesce rapid audio route changes before one attempt on the restored headset.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: work)
    }

    private func resume(_ t: AudioRecovery.Ticket) {
        guard let frame,
              policy.mayResume(t, outputs: bluetoothOutputs(session.currentRoute), now: now, active: active, blocked: otherInterruption) else { return }
        do { try session.setActive(true); sessionActive = true }
        catch { log.error("Continuation activation failed: \((error as NSError).code)"); invalidate(); return }
        // Activation can synchronously change the route. Validate again before the WebKit call.
        guard policy.mayResume(t, outputs: bluetoothOutputs(session.currentRoute), now: now, active: active, blocked: otherInterruption) else { return }
        let args: [String: Any] = ["doc": document, "media": media, "id": t.id]
        policy.consume(t); armedID = nil; expiryWork?.cancel()
        webView?.callAsyncJavaScript("return await window.__WuAiAudio103?.resume(doc, media, id);", arguments: args, in: frame, in: .page) { [weak self] result in
            switch result {
            case .success(let value): self?.log.info("Continuation result: \(String(describing: value), privacy: .public)")
            case .failure: self?.log.info("Continuation unavailable in this frame")
            }
        }
    }
}

final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
