// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "WuAiBrowserChecks",
    platforms: [.macOS(.v13)],
    targets: [
        .target(
            name: "BrowserSupport",
            path: "WuAiZhiBo",
            exclude: ["AppDelegate.swift", "ViewController.swift", "AudioRecovery.swift",
                      "WebAudioCoordinator.swift", "AudioRecovery.js", "Info.plist",
                      "Assets.xcassets", "LaunchScreen.storyboard"],
            sources: ["BrowserCache.swift", "NavigationRouting.swift", "NavigationRecovery.swift"]
        ),
        .testTarget(name: "BrowserSupportTests", dependencies: ["BrowserSupport"], path: "Tests/Browser")
    ]
)
