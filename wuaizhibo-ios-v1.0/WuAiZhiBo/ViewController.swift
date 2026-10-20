import UIKit
import WebKit
import OSLog

final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let homeURL = URL(string: "https://jiami.ttplays.uk:6067/")!
    private let trustedHost = "jiami.ttplays.uk"
    private let bridgeName = "WuAiNative"
    private let minimumSplashTime: TimeInterval = 1.0
    private let popupConfiguration: WKWebViewConfiguration?
    private let popupDepth: Int
    private let navigationLog = Logger(subsystem: "com.chatapp.bqimvip", category: "Navigation")

    init(configuration: WKWebViewConfiguration? = nil, popupDepth: Int = 0) {
        self.popupConfiguration = configuration
        self.popupDepth = popupDepth
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("Programmatic view controller") }

    private var webView: WKWebView!
    private var splashView: UIView!
    private var launchTime = Date()
    private var orientationMask: UIInterfaceOrientationMask = .portrait
    private var isManagedFullscreen = false
    private var recovery = NavigationRecovery()
    private let audioCoordinator = WebAudioCoordinator()
    private var activeNavigation: WKNavigation?
    private var initiatedNavigation: WKNavigation?
    private var currentRequest: URLRequest?
    private var pendingMainRequest: URLRequest?
    private var transitionPending = false
    private var retryWork: DispatchWorkItem?
    private var failureBar: UIStackView?
    private var failureLabel: UILabel?
    private var retryButton: UIButton?
    private var failedRequest: URLRequest?
    private let loadTimeout: TimeInterval = 120

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { orientationMask }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .portrait }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.02, green: 0.07, blue: 0.16, alpha: 1.0)
        buildWebView()
        if popupConfiguration == nil {
            buildSplash()
            BrowserCache.prepare(webView.configuration.websiteDataStore) { [weak self] in self?.loadHome() }
        }
    }

    deinit {
        retryWork?.cancel()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: bridgeName)
    }

    private func buildWebView() {
        let userContent = WKUserContentController()
        userContent.add(WeakScriptHandler(self), name: bridgeName)
        audioCoordinator.install(on: userContent)
        userContent.addUserScript(WKUserScript(
            source: Self.bridgeScript,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))

        let config = popupConfiguration ?? WKWebViewConfiguration()
        config.userContentController = userContent
        if popupConfiguration == nil { config.websiteDataStore = .default() }
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        webView = WKWebView(frame: .zero, configuration: config)
        audioCoordinator.attach(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.backgroundColor = view.backgroundColor
        webView.isOpaque = false
        webView.scrollView.backgroundColor = view.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = true
        if #available(iOS 16.4, *) {
            webView.isInspectable = false
        }

        view.addSubview(webView)
        var webTop = view.topAnchor
        if popupConfiguration != nil {
            let close = UIButton(type: .system)
            close.setTitle("关闭新页面", for: .normal)
            close.addTarget(self, action: #selector(closePopup), for: .touchUpInside)
            close.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(close)
            NSLayoutConstraint.activate([
                close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
                close.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
                close.heightAnchor.constraint(equalToConstant: 44)
            ])
            webTop = close.bottomAnchor
        }
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: webTop),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func buildSplash() {
        let root = GradientView()
        root.translatesAutoresizingMaskIntoConstraints = false
        root.startColor = UIColor(red: 0.01, green: 0.035, blue: 0.10, alpha: 1.0)
        root.midColor = UIColor(red: 0.025, green: 0.13, blue: 0.28, alpha: 1.0)
        root.endColor = UIColor(red: 0.13, green: 0.02, blue: 0.12, alpha: 1.0)

        let stack = UIStackView()
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 10

        let logo = UIImageView(image: UIImage(named: "BrandLogo") ?? UIImage(systemName: "play.circle.fill"))
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.contentMode = .scaleAspectFit
        logo.layer.shadowColor = UIColor.black.cgColor
        logo.layer.shadowOpacity = 0.35
        logo.layer.shadowRadius = 16
        logo.layer.shadowOffset = CGSize(width: 0, height: 8)

        let title = UILabel()
        title.text = "吾爱直播"
        title.textColor = .white
        title.font = .systemFont(ofSize: 30, weight: .bold)
        title.textAlignment = .center

        let subtitle = UILabel()
        subtitle.text = "精彩内容 · 即刻呈现"
        subtitle.textColor = UIColor(red: 0.75, green: 0.82, blue: 0.93, alpha: 1.0)
        subtitle.font = .systemFont(ofSize: 14, weight: .medium)
        subtitle.textAlignment = .center

        let spinner = UIActivityIndicatorView(style: .medium)
        spinner.color = UIColor(red: 1.0, green: 0.16, blue: 0.30, alpha: 1.0)
        spinner.startAnimating()

        let loading = UILabel()
        loading.text = "正在加载"
        loading.textColor = UIColor(red: 0.56, green: 0.64, blue: 0.76, alpha: 1.0)
        loading.font = .systemFont(ofSize: 12)

        stack.addArrangedSubview(logo)
        stack.setCustomSpacing(18, after: logo)
        stack.addArrangedSubview(title)
        stack.addArrangedSubview(subtitle)
        stack.setCustomSpacing(26, after: subtitle)
        stack.addArrangedSubview(spinner)
        stack.addArrangedSubview(loading)

        root.addSubview(stack)
        view.addSubview(root)

        let logoSize = min(max(UIScreen.main.bounds.width * 0.30, 110), 156)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            root.topAnchor.constraint(equalTo: view.topAnchor),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: root.centerYAnchor, constant: -8),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: root.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor, constant: -24),
            logo.widthAnchor.constraint(equalToConstant: logoSize),
            logo.heightAnchor.constraint(equalToConstant: logoSize)
        ])

        splashView = root
    }

    private func loadHome() {
        launchTime = Date()
        startLoad(URLRequest(url: homeURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: loadTimeout))
    }

    private func hideSplash() {
        guard splashView != nil, !splashView.isHidden else { return }
        let elapsed = Date().timeIntervalSince(launchTime)
        let delay = max(0, minimumSplashTime - elapsed)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, let splash = self.splashView, !splash.isHidden else { return }
            UIView.animate(withDuration: 0.26, animations: {
                splash.alpha = 0
            }, completion: { _ in
                splash.isHidden = true
                splash.alpha = 1
            })
        }
    }

    private func startLoad(_ request: URLRequest, preservingRetries: Bool = false) {
        retryWork?.cancel()
        retryWork = nil
        failureBar?.isHidden = true
        failedRequest = nil
        recovery.begin(preservingRetries: preservingRetries)
        let request = NavigationRouting.freshRequest(request)
        currentRequest = request
        pendingMainRequest = request
        transitionPending = true
        initiatedNavigation = webView.load(request)
        activeNavigation = initiatedNavigation
    }

    private func showLoadError(for request: URLRequest?, error: NSError) {
        hideSplash()
        failedRequest = request
        if failureBar == nil {
            let label = UILabel()
            label.textColor = .white
            label.font = .systemFont(ofSize: 14)
            label.numberOfLines = 0
            let retry = UIButton(type: .system)
            retry.setTitle("重试", for: .normal)
            retry.setContentHuggingPriority(.required, for: .horizontal)
            retry.addTarget(self, action: #selector(retryFailedPage), for: .touchUpInside)
            let close = UIButton(type: .system)
            close.setTitle("关闭", for: .normal)
            close.setContentHuggingPriority(.required, for: .horizontal)
            close.addTarget(self, action: #selector(dismissLoadError), for: .touchUpInside)
            let bar = UIStackView(arrangedSubviews: [label, retry, close])
            bar.translatesAutoresizingMaskIntoConstraints = false
            bar.axis = .horizontal
            bar.alignment = .center
            bar.spacing = 12
            bar.isLayoutMarginsRelativeArrangement = true
            bar.layoutMargins = UIEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
            bar.backgroundColor = UIColor(white: 0.12, alpha: 0.97)
            view.addSubview(bar)
            NSLayoutConstraint.activate([
                bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor)
            ])
            failureBar = bar
            failureLabel = label
            retryButton = retry
        }
        let safeToReplay = ["GET", "HEAD"].contains((request?.httpMethod ?? "GET").uppercased())
        retryButton?.setTitle(safeToReplay ? "重试" : "返回", for: .normal)
        retryButton?.isHidden = request == nil
        if error.domain == NSURLErrorDomain && error.code == NSURLErrorNotConnectedToInternet {
            failureLabel?.text = "网络未连接，请连接网络后重试。"
        } else if error.domain == NSURLErrorDomain &&
                    [NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted,
                     NSURLErrorServerCertificateHasBadDate].contains(error.code) {
            failureLabel?.text = "无法建立安全连接，请稍后重试。"
        } else if !["GET", "HEAD"].contains((request?.httpMethod ?? "GET").uppercased()) {
            failureLabel?.text = "提交未完成，请确认页面结果后再操作。"
        } else if error.domain == NSURLErrorDomain &&
                    [NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost, NSURLErrorCannotFindHost,
                     NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed].contains(error.code) {
            failureLabel?.text = "页面暂时无法连接，请重试。"
        } else {
            failureLabel?.text = "页面未能打开，请重试。"
        }
        let domain = error.domain == NSURLErrorDomain ? "URL" : (error.domain == "WebKitErrorDomain" ? "WebKit" : "页面")
        failureLabel?.text = (failureLabel?.text ?? "页面未能打开。") + "（\(domain) \(error.code)）"
        failureBar?.isHidden = false
        if let failureBar { view.bringSubviewToFront(failureBar) }
    }

    @objc private func retryFailedPage() {
        guard let request = failedRequest else { return }
        // Never replay a form/payment POST. Return to the retained page for an explicit resubmission.
        guard ["GET", "HEAD"].contains((request.httpMethod ?? "GET").uppercased()) else {
            dismissLoadError()
            return
        }
        // User retry refreshes the page cache after host/IP changes, preserving login data.
        retryWork?.cancel()
        recovery.begin()
        let generation = recovery.generation
        transitionPending = true
        activeNavigation = nil
        initiatedNavigation = nil
        webView.stopLoading()
        audioCoordinator.invalidate()
        retryButton?.isEnabled = false
        BrowserCache.refresh(webView.configuration.websiteDataStore) { [weak self] in
            guard let self else { return }
            self.retryButton?.isEnabled = true
            guard self.recovery.generation == generation else { return }
            self.startLoad(request)
        }
    }

    @objc private func dismissLoadError() {
        failureBar?.isHidden = true
    }

    private func handleLoadFailure(_ navigation: WKNavigation?, error: Error) {
        let error = error as NSError
        // This check comes before any UI or retry work, including during navigation replacement.
        if NavigationRecovery.isNavigationInterruption(error) { return }
        guard !transitionPending, let navigation, navigation === activeNavigation else { return }
        navigationLog.error("Page navigation failed: \(error.domain, privacy: .public) \(error.code)")
        let generation = recovery.generation
        let request = currentRequest
        switch recovery.fail(error, generation: generation, method: request?.httpMethod ?? "GET") {
        case .ignore:
            return
        case .retry(let delay):
            guard let request else { showLoadError(for: nil, error: error); return }
            retryWork?.cancel()
            let task = DispatchWorkItem { [weak self] in
                guard let self, self.recovery.generation == generation, !self.transitionPending else { return }
                self.startLoad(request, preservingRetries: true)
            }
            retryWork = task
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: task)
        case .showFailure:
            showLoadError(for: request, error: error)
        }
    }

    private func setManagedOrientation(_ mode: String) {
        switch mode.lowercased() {
        case "landscape":
            isManagedFullscreen = true
            orientationMask = [.landscapeLeft, .landscapeRight]
            requestOrientation(.landscapeRight)
        case "portrait":
            isManagedFullscreen = true
            orientationMask = .portrait
            requestOrientation(.portrait)
        default:
            isManagedFullscreen = false
            orientationMask = .portrait
            requestOrientation(.portrait)
        }
    }

    private func requestOrientation(_ orientation: UIInterfaceOrientation) {
        setNeedsUpdateOfSupportedInterfaceOrientations()
        if #available(iOS 16.0, *), let scene = view.window?.windowScene {
            let mask: UIInterfaceOrientationMask = orientation.isLandscape ? [.landscapeLeft, .landscapeRight] : .portrait
            let preferences = UIWindowScene.GeometryPreferences.iOS(interfaceOrientations: mask)
            scene.requestGeometryUpdate(preferences) { _ in }
            setNeedsUpdateOfSupportedInterfaceOrientations()
        } else {
            UIDevice.current.setValue(orientation.rawValue, forKey: "orientation")
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }

    private func isTrusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.host?.lowercased() == trustedHost
    }

    private func openExternal(_ url: URL) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        audioCoordinator.invalidate()
        retryWork?.cancel()
        retryWork = nil
        failureBar?.isHidden = true
        failedRequest = nil
        if navigation !== initiatedNavigation {
            recovery.begin()
            currentRequest = pendingMainRequest
        }
        initiatedNavigation = nil
        activeNavigation = navigation
        transitionPending = false
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard navigation === activeNavigation else { return }
        // Keep the original branded splash and minimum display time; do not wait for slow subresources.
        hideSplash()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard navigation === activeNavigation else { return }
        recovery.finish()
        retryWork?.cancel()
        retryWork = nil
        failureBar?.isHidden = true
        hideSplash()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(navigation, error: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(navigation, error: error)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }

        if NavigationRouting.destination(for: url) == .external {
            decisionHandler(.cancel)
            openExternal(url)
            return
        }

        // Preserve script URLs, iframe targets, referrers, POST bodies and browser window semantics.
        // WebKit will ask createWebViewWith for target=_blank / window.open; do not cancel/reissue here.
        if navigationAction.targetFrame?.isMainFrame == true && NavigationRouting.isPageRequest(url) {
            retryWork?.cancel()
            retryWork = nil
            failureBar?.isHidden = true
            failedRequest = nil
            // A redirect can also invoke this policy callback for the same WKNavigation.
            // Change navigation identity only in didStart, not while approving a redirect/hash link.
            pendingMainRequest = navigationAction.request
        }
        decisionHandler(.allow)
    }

    // MARK: WKUIDelegate

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil, presentedViewController == nil, popupDepth < 3 else { return nil }
        let child = ViewController(configuration: configuration, popupDepth: popupDepth + 1)
        child.modalPresentationStyle = .fullScreen
        child.loadViewIfNeeded()
        // Return the web view created from the exact WebKit-supplied configuration. WebKit loads it once.
        present(child, animated: true)
        return child.webView
    }

    func webViewDidClose(_ webView: WKWebView) { closePopup() }

    @objc private func closePopup() {
        guard popupConfiguration != nil else { return }
        audioCoordinator.invalidate()
        webView.stopLoading()
        dismiss(animated: true)
    }

    // MARK: WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == bridgeName, isTrusted(webView.url) else { return }
        if let mode = message.body as? String {
            setManagedOrientation(mode)
        }
    }

    private static let bridgeScript = #"""
    (function(){
      try {
        var d=document;if(!d||!d.head)return;
        var v=d.querySelector('meta[name="viewport"]');
        if(!v){v=d.createElement('meta');v.name='viewport';d.head.appendChild(v);}
        v.setAttribute('content','width=device-width, initial-scale=1.0, viewport-fit=cover');
        var s=d.getElementById('wuaizhibo-ios-fix');
        if(!s){s=d.createElement('style');s.id='wuaizhibo-ios-fix';d.head.appendChild(s);}
        s.textContent='html{-webkit-text-size-adjust:100% !important;text-size-adjust:100% !important;}'+
        'input,textarea,select{font-size:16px !important;}'+
        'html.wuai-portrait-page,body.wuai-portrait-page{margin:0 !important;padding:0 !important;width:100% !important;height:100% !important;overflow:hidden !important;background:#000 !important;overscroll-behavior:none !important;}'+
        '.madouym.wuai-portrait-player{position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;height:100dvh !important;max-width:none !important;max-height:none !important;margin:0 !important;padding:0 !important;z-index:2147483646 !important;background:#000 !important;overflow:hidden !important;}'+
        '.madouym.wuai-portrait-player iframe,.madouym.wuai-portrait-player video,.madouym.wuai-portrait-player>iframe,.madouym.wuai-portrait-player>video{width:100% !important;height:100% !important;max-width:none !important;max-height:none !important;margin:0 !important;padding:0 !important;}'+
        '.wuai-portrait-hitbox{position:absolute !important;right:0 !important;bottom:0 !important;width:78px !important;height:70px !important;z-index:2147483647 !important;display:block !important;margin:0 !important;padding:0 !important;border:0 !important;outline:0 !important;background:transparent !important;color:transparent !important;font-size:0 !important;-webkit-appearance:none !important;appearance:none !important;-webkit-tap-highlight-color:transparent !important;touch-action:manipulation !important;pointer-events:auto !important;}'+
        '.madouym.wuai-portrait-player .wuai-portrait-hitbox{position:fixed !important;right:0 !important;bottom:0 !important;}';

        if(window.__wuaiIOSV10)return;
        window.__wuaiIOSV10=true;
        var nativeSet=function(m){try{window.webkit.messageHandlers.WuAiNative.postMessage(m);}catch(e){}};
        var state={player:null,style:null,scrollX:0,scrollY:0,lastTap:0};

        var exitPortrait=function(){
          try{
            var p=state.player||d.querySelector('.madouym.wuai-portrait-player');
            if(p){
              p.classList.remove('wuai-portrait-player');
              if(state.style===null)p.removeAttribute('style');
              else if(state.style!==undefined)p.setAttribute('style',state.style);
            }
            if(d.documentElement)d.documentElement.classList.remove('wuai-portrait-page');
            if(d.body)d.body.classList.remove('wuai-portrait-page');
            try{window.scrollTo(state.scrollX||0,state.scrollY||0);}catch(q){}
            state.player=null;state.style=null;nativeSet('off');ensure();return true;
          }catch(x){nativeSet('off');return false;}
        };

        var enterPortrait=function(p){
          try{
            if(!p)return false;
            if(state.player&&state.player!==p)exitPortrait();
            state.player=p;state.style=p.getAttribute('style');
            state.scrollX=window.pageXOffset||0;state.scrollY=window.pageYOffset||0;
            if(d.documentElement)d.documentElement.classList.add('wuai-portrait-page');
            if(d.body)d.body.classList.add('wuai-portrait-page');
            p.classList.add('wuai-portrait-player');nativeSet('portrait');return true;
          }catch(x){return false;}
        };
        window.__WuAiExitPortrait=exitPortrait;

        var tap=function(e,p){
          try{
            var now=Date.now();if(now-state.lastTap<320)return false;state.lastTap=now;
            if(e){e.preventDefault();e.stopPropagation();if(typeof e.stopImmediatePropagation==='function')e.stopImmediatePropagation();}
            if(p.classList.contains('wuai-portrait-player'))return exitPortrait();
            return enterPortrait(p);
          }catch(x){return false;}
        };

        var bind=function(p){
          if(!p)return;
          var mode=p.getAttribute('data-video-orientation')||'';
          var b=null,cs=p.children||[];
          for(var ci=0;ci<cs.length;ci++){
            if(cs[ci].classList&&cs[ci].classList.contains('wuai-portrait-hitbox')){b=cs[ci];break;}
          }
          if(mode==='portrait'){
            if(!b){
              b=d.createElement('button');b.type='button';b.className='wuai-portrait-hitbox';
              b.setAttribute('aria-label','竖版视频全屏');
              var fire=function(e){tap(e,p);};
              b.addEventListener('touchend',fire,true);b.addEventListener('click',fire,true);p.appendChild(b);
            }
          }else if(b){b.parentNode.removeChild(b);}
        };

        var ensure=function(){
          try{var ps=d.querySelectorAll('.madouym');for(var i=0;i<ps.length;i++)bind(ps[i]);}catch(x){}
        };

        var sync=function(){
          try{
            ensure();var de=d.documentElement,b=d.body;
            var landscape=!!((de&&de.classList.contains('force-landscape-page'))||(b&&b.classList.contains('force-landscape-page'))||d.querySelector('.madouym.force-landscape-player'));
            var portrait=!!d.querySelector('.madouym.wuai-portrait-player');
            nativeSet(landscape?'landscape':(portrait?'portrait':'off'));
          }catch(x){}
        };

        var mo=new MutationObserver(function(){sync();});
        mo.observe(d.documentElement,{attributes:true,childList:true,subtree:true,attributeFilter:['class','data-video-orientation']});
        d.addEventListener('fullscreenchange',sync,true);
        window.addEventListener('pageshow',sync,true);
        window.addEventListener('pagehide',function(){try{exitPortrait();nativeSet('off');}catch(x){}},true);
        ensure();sync();
      } catch(e) {}
    })();
    """#
}

private final class GradientView: UIView {
    var startColor: UIColor = .black { didSet { updateColors() } }
    var midColor: UIColor = .darkGray { didSet { updateColors() } }
    var endColor: UIColor = .black { didSet { updateColors() } }

    override class var layerClass: AnyClass { CAGradientLayer.self }

    private var gradient: CAGradientLayer { layer as! CAGradientLayer }

    override init(frame: CGRect) {
        super.init(frame: frame)
        gradient.startPoint = CGPoint(x: 0, y: 0)
        gradient.endPoint = CGPoint(x: 1, y: 1)
        gradient.locations = [0, 0.55, 1]
        updateColors()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        gradient.startPoint = CGPoint(x: 0, y: 0)
        gradient.endPoint = CGPoint(x: 1, y: 1)
        gradient.locations = [0, 0.55, 1]
        updateColors()
    }

    private func updateColors() {
        gradient.colors = [startColor.cgColor, midColor.cgColor, endColor.cgColor]
    }
}
