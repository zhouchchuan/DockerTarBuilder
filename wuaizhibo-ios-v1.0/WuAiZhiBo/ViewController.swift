import UIKit
import WebKit

final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let homeURL = URL(string: "https://jiami.ttplays.uk:6067/")!
    private let trustedHost = "jiami.ttplays.uk"
    private let bridgeName = "WuAiNative"
    private let minimumSplashTime: TimeInterval = 1.0

    private var webView: WKWebView!
    private var splashView: UIView!
    private var launchTime = Date()
    private var orientationMask: UIInterfaceOrientationMask = .portrait
    private var isManagedFullscreen = false

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { orientationMask }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .portrait }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.02, green: 0.07, blue: 0.16, alpha: 1.0)
        buildWebView()
        buildSplash()
        loadHome()
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: bridgeName)
    }

    private func buildWebView() {
        let userContent = WKUserContentController()
        userContent.add(self, name: bridgeName)
        userContent.addUserScript(WKUserScript(
            source: Self.bridgeScript,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        ))

        let config = WKWebViewConfiguration()
        config.userContentController = userContent
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        webView = WKWebView(frame: .zero, configuration: config)
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
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
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
        webView.load(URLRequest(url: homeURL, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
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

    private func showLoadError(_ text: String) {
        hideSplash()
        let alert = UIAlertController(title: "加载失败", message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "重试", style: .default) { [weak self] _ in
            self?.splashView.isHidden = false
            self?.splashView.alpha = 1
            self?.loadHome()
        })
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        present(alert, animated: true)
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

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hideSplash()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showLoadError(error.localizedDescription)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showLoadError(error.localizedDescription)
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

        if navigationAction.targetFrame == nil {
            if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
                webView.load(navigationAction.request)
                decisionHandler(.cancel)
                return
            }
        }

        guard let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow)
            return
        }

        if scheme == "http" || scheme == "https" || scheme == "about" || scheme == "data" || scheme == "blob" {
            decisionHandler(.allow)
        } else {
            openExternal(url)
            decisionHandler(.cancel)
        }
    }

    // MARK: WKUIDelegate

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
                webView.load(navigationAction.request)
            } else {
                openExternal(url)
            }
        }
        return nil
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
