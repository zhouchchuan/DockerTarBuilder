from pathlib import Path

ROOT = Path("src")


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path, old, new, label):
    text = read(path)
    if old not in text:
        raise SystemExit(f"V0.1.2 PATCH FAILED [{label}] pattern not found in {path}")
    write(path, text.replace(old, new, 1))
    print(f"patched {label}: {path}")


def replace_between(path, start_marker, end_marker, replacement, label):
    text = read(path)
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"V0.1.2 PATCH FAILED [{label}] start marker not found in {path}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"V0.1.2 PATCH FAILED [{label}] end marker not found in {path}")
    write(path, text[:start] + replacement + text[end:])
    print(f"patched {label}: {path}")


# ---------------------------------------------------------------------------
# 1. Enrich the V0.1.1 libtorrent peer bridge with connection state metadata.
#    The low-level get_peer_info() bridge already worked in V0.1.1; the real
#    user-visible bug was that the details screen did not keep polling it.
# ---------------------------------------------------------------------------
replace_once(
    "Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.mm",
    '''            BOOL isUTP = (peer.flags & lt::peer_info::utp_socket) ? YES : NO;\n            BOOL isOutgoing = (peer.flags & lt::peer_info::outgoing_connection) ? YES : NO;\n            BOOL isHolepunched = (peer.flags & lt::peer_info::holepunched) ? YES : NO;\n\n            [result addObject:@{''',
    '''            BOOL isUTP = static_cast<bool>(peer.flags & lt::peer_info::utp_socket);\n            BOOL isOutgoing = static_cast<bool>(peer.flags & lt::peer_info::outgoing_connection);\n            BOOL isHolepunched = static_cast<bool>(peer.flags & lt::peer_info::holepunched);\n            BOOL isSeed = static_cast<bool>(peer.flags & lt::peer_info::seed);\n            BOOL isConnecting = static_cast<bool>(peer.flags & lt::peer_info::connecting);\n            BOOL isHandshake = static_cast<bool>(peer.flags & lt::peer_info::handshake);\n\n            NSString *state = @"空闲";\n            if (isConnecting) {\n                state = @"连接中";\n            } else if (isHandshake) {\n                state = @"握手中";\n            } else if (peer.payload_down_speed > 0 && peer.payload_up_speed > 0) {\n                state = @"下载 + 上传";\n            } else if (peer.payload_down_speed > 0) {\n                state = @"下载中";\n            } else if (peer.payload_up_speed > 0) {\n                state = @"上传中";\n            } else if (isSeed) {\n                state = @"完整节点 / 空闲";\n            }\n\n            [result addObject:@{''',
    "peer connection state",
)

replace_once(
    "Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.mm",
    '''                @"direction": isOutgoing ? @"OUT" : @"IN",\n                @"holepunched": @(isHolepunched),\n                @"progress": @(peer.progress)\n''',
    '''                @"direction": isOutgoing ? @"OUT" : @"IN",\n                @"holepunched": @(isHolepunched),\n                @"seed": @(isSeed),\n                @"state": state,\n                @"ipv6": @(peer.ip.address().is_v6()),\n                @"progress": @(peer.progress)\n''',
    "peer extra fields",
)


# ---------------------------------------------------------------------------
# 2. V0.1.2 UI state: keep stable row models and a real one-second timer.
# ---------------------------------------------------------------------------
replace_once(
    "iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift",
    '''    private var peerModels: [DetailCellViewModel] = []\n    private var lastPeerRefresh = Date.distantPast\n''',
    '''    private var peerModels: [DetailCellViewModel] = []\n    private var peerCount: Int = 0\n    private var peerRefreshTimer: AnyCancellable?\n    private let noPeersModel = DetailCellViewModel(title: "Peer 节点", detail: "当前暂无已连接 Peer", spacer: 90)\n''',
    "peer timer state",
)

replace_once(
    "iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift",
    '''        trackDataUpdate()\n        trackReload()\n\n        disposeBag.bind {''',
    '''        trackDataUpdate()\n        trackReload()\n\n        // V0.1.2: peer telemetry must be refreshed independently of torrent\n        // section/state changes. V0.1.1 only refreshed peers from reload(),\n        // which meant a page opened before peers connected could stay empty.\n        peerRefreshTimer?.cancel()\n        peerRefreshTimer = Timer.publish(every: 1.0, on: .main, in: .common)\n            .autoconnect()\n            .sink { [weak self] _ in\n                self?.refreshPeerModels()\n            }\n\n        disposeBag.bind {''',
    "one second peer timer",
)

peer_refresh = r'''    func refreshPeerModels() {
        let rawPeers = torrentHandle.peerStats() as? [[String: Any]] ?? []

        // Keep ordering stable by endpoint so scrolling does not jump while
        // rates change every second. Limit the rendered list for phone UI,
        // while the header still reports the real connected count.
        let sortedPeers = rawPeers.sorted { lhs, rhs in
            let lIP = lhs["ip"] as? String ?? ""
            let rIP = rhs["ip"] as? String ?? ""
            if lIP != rIP { return lIP.localizedStandardCompare(rIP) == .orderedAscending }
            let lPort = (lhs["port"] as? Int) ?? 0
            let rPort = (rhs["port"] as? Int) ?? 0
            return lPort < rPort
        }
        let shownPeers = Array(sortedPeers.prefix(20))
        let oldPeerCount = peerCount
        peerCount = rawPeers.count

        let requiredRows = shownPeers.count * 3
        let structureChanged = peerModels.count != requiredRows
        if structureChanged {
            peerModels = (0..<shownPeers.count).flatMap { index -> [DetailCellViewModel] in
                let number = index + 1
                return [
                    DetailCellViewModel(title: "#\(number) IP / 端口", spacer: 105),
                    DetailCellViewModel(title: "#\(number) 客户端 / 状态", spacer: 130),
                    DetailCellViewModel(title: "#\(number) ↓下载 / ↑上传", spacer: 120),
                ]
            }
        }

        for (index, peer) in shownPeers.enumerated() {
            let ip = peer["ip"] as? String ?? "?"
            let port = (peer["port"] as? Int) ?? 0
            let down = (peer["downloadRate"] as? Int64) ?? 0
            let up = (peer["uploadRate"] as? Int64) ?? 0
            let totalDown = (peer["totalDownload"] as? Int64) ?? 0
            let totalUp = (peer["totalUpload"] as? Int64) ?? 0
            let client = (peer["client"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "未知客户端"
            let transport = peer["transport"] as? String ?? "TCP"
            let direction = peer["direction"] as? String ?? ""
            let state = peer["state"] as? String ?? "空闲"
            let holepunched = (peer["holepunched"] as? Bool) ?? false
            let progress = min(max((peer["progress"] as? Double) ?? 0, 0), 1)

            let host = ip.contains(":") ? "[\(ip)]" : ip
            let directionText = direction == "OUT" ? "出站" : (direction == "IN" ? "入站" : direction)
            let hpText = holepunched ? " · HP" : ""

            let base = index * 3
            peerModels[base].detail = "\(host):\(port) · \(transport)" + (directionText.isEmpty ? "" : " · \(directionText)")
            peerModels[base + 1].detail = "\(client) · \(String(format: \"%.1f\", progress * 100))% · \(state)\(hpText)"
            peerModels[base + 2].detail = "↓ \(Self.formatPeerRate(down))/s  ↑ \(Self.formatPeerRate(up))/s · 累计 ↓ \(Self.formatPeerRate(totalDown))  ↑ \(Self.formatPeerRate(totalUp))"
        }

        // Rebuild the collection structure only when the number of rows
        // changes. When peers remain the same, @Published detail updates the
        // existing visible cells without a full-screen reload/flicker.
        if structureChanged || oldPeerCount != peerCount {
            reload(refreshPeers: false)
        }
    }

'''
replace_between(
    "iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift",
    "    func refreshPeerModelsIfNeeded() {\n",
    "    static func formatPeerRate",
    peer_refresh,
    "stable live peer rows",
)

replace_once(
    "iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift",
    '''    func reload() {\n        refreshPeerModelsIfNeeded()\n        let snapshot = torrentHandle.observableSnapshot\n''',
    '''    func reload(refreshPeers: Bool = true) {\n        if refreshPeers {\n            refreshPeerModels()\n        }\n        let snapshot = torrentHandle.observableSnapshot\n''',
    "reload recursion guard",
)

peer_section = r'''        let peerItems = peerModels.isEmpty ? [noPeersModel] : peerModels
        let peerHeader: String
        if peerCount > 20 {
            peerHeader = "Peer 节点（显示 20 / \(peerCount)） · 1秒实时刷新"
        } else {
            peerHeader = "Peer 节点（\(peerCount)） · 1秒实时刷新"
        }
        sections.append(MvvmCollectionSectionModel(
            id: "peers",
            header: peerHeader,
            items: peerItems
        ))

'''
replace_between(
    "iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift",
    '''        if !peerModels.isEmpty {\n''',
    '''        sections.append(.init(id: "actions", header: %"details.actions") {\n''',
    peer_section,
    "always visible peer section",
)


# ---------------------------------------------------------------------------
# 3. Static build markers so CI can prove the requested code landed.
# ---------------------------------------------------------------------------
vm = read("iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift")
for marker in ["Peer 节点", "Timer.publish(every: 1.0", "peerStats()", "累计 ↓"]:
    if marker not in vm:
        raise SystemExit(f"V0.1.2 VERIFY FAILED: missing marker {marker!r}")

mm = read("Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.mm")
for marker in ["get_peer_info", "payload_down_speed", "payload_up_speed", '@"state"']:
    if marker not in mm:
        raise SystemExit(f"V0.1.2 VERIFY FAILED: missing libtorrent marker {marker!r}")

print("BT Mobile V0.1.2 live Peer region patch applied successfully")
