from pathlib import Path
import os

ROOT = Path(os.environ.get("BTMOBILE_SRC", "src"))


def replace_once(path, old, new, label):
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"PATCH FAILED [{label}] marker not found in {p}: {old[:100]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}: {p}")


replace_once("iTorrent/Screens/TorrentList/TorrentListViewModel.swift", '        title = "iTorrent"', '        title = "BT Mobile"', "app title")

replace_once(
    "Submodules/LibTorrent-Swift/LibTorrent/Core/SessionSettings/SessionSettings.mm",
    '    settings.set_str(lt::settings_pack::peer_fingerprint, [_peerFingerprint UTF8String]);\n\n    // Torrent limitations\n',
    '    settings.set_str(lt::settings_pack::peer_fingerprint, [_peerFingerprint UTF8String]);\n\n'
    '    // BTMobile: make trackerless magnets discover peers reliably via DHT.\n'
    '    if (_isDhtEnabled) {\n'
    '        settings.set_str(lt::settings_pack::dht_bootstrap_nodes,\n'
    '                         "dht.libtorrent.org:25401,router.bittorrent.com:6881,dht.transmissionbt.com:6881,router.bt.ouinet.work:6881");\n'
    '        settings.set_bool(lt::settings_pack::use_dht_as_fallback, false);\n'
    '    }\n'
    '    settings.set_bool(lt::settings_pack::announce_to_all_tiers, true);\n'
    '    settings.set_bool(lt::settings_pack::announce_to_all_trackers, true);\n'
    '    settings.set_bool(lt::settings_pack::prefer_udp_trackers, true);\n\n'
    '    // Torrent limitations\n',
    "DHT bootstrap and tracker discovery",
)

replace_once(
    "Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.h",
    '@property (readonly) BOOL isPrivate;\n',
    '@property (readonly) BOOL isPrivate;\n@property (readonly) NSArray<NSDictionary<NSString *, NSString *> *> *peerStats;\n',
    "peer stats header",
)
replace_once(
    "Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.mm",
    '#import "libtorrent/magnet_uri.hpp"\n',
    '#import "libtorrent/magnet_uri.hpp"\n#import "libtorrent/peer_info.hpp"\n',
    "peer info include",
)

peer_method = r'''- (NSArray<NSDictionary<NSString *, NSString *> *> *)peerStats {
    NSMutableArray<NSDictionary<NSString *, NSString *> *> *result = [NSMutableArray array];
    [self performOperation:@"peerStats" action:^(lt::torrent_handle const &handle) {
        std::vector<lt::peer_info> peers;
        handle.get_peer_info(peers);
        for (auto const &peer : peers) {
            auto endpoint = peer.remote_endpoint();
            auto addressString = endpoint.address().to_string();
            if (addressString.empty()) { continue; }
            NSString *host = [NSString stringWithUTF8String:addressString.c_str()];
            if (host == nil || host.length == 0) { continue; }
            unsigned int port = static_cast<unsigned int>(endpoint.port());
            NSString *client = peer.client.empty() ? @"" : ([NSString stringWithUTF8String:peer.client.c_str()] ?: @"");
            NSString *transport = (peer.flags & lt::peer_info::utp_socket) ? @"uTP" : @"TCP";
            NSString *direction = (peer.flags & lt::peer_info::outgoing_connection) ? @"OUT" : @"IN";
            NSString *holepunched = (peer.flags & lt::peer_info::holepunched) ? @"1" : @"0";
            [result addObject:@{
                @"ip": host,
                @"port": [NSString stringWithFormat:@"%u", port],
                @"downloadRate": [NSString stringWithFormat:@"%d", peer.payload_down_speed],
                @"uploadRate": [NSString stringWithFormat:@"%d", peer.payload_up_speed],
                @"totalDownload": [NSString stringWithFormat:@"%lld", (long long)peer.total_download],
                @"totalUpload": [NSString stringWithFormat:@"%lld", (long long)peer.total_upload],
                @"client": client,
                @"transport": transport,
                @"direction": direction,
                @"holepunched": holepunched,
            }];
        }
    }];
    return result;
}

'''
replace_once("Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.mm", '- (void)updateSnapshot {\n', peer_method + '- (void)updateSnapshot {\n', "peer stats implementation")

replace_once(
    "iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift",
    '    private var torrentHandle: TorrentHandle!\n',
    '''    private var torrentHandle: TorrentHandle!\n    private var peerModels: [DetailCellViewModel] = []\n    private var lastPeerSignature = ""\n    private var isPeersExpanded = false\n    private lazy var peerSummaryModel = DetailCellViewModel(\n        title: "Peers",\n        detail: "0",\n        spacer: 72,\n        isBold: true\n    ) { [weak self] in\n        guard let self else { return }\n        isPeersExpanded.toggle()\n        reload()\n    }\n''',
    "peer UI state",
)

peer_update = r'''        let peerStats = torrentHandle.peerStats
        let totalPeerDown = peerStats.reduce(UInt64(0)) { partial, peer in
            partial + (UInt64(peer["downloadRate"] ?? "") ?? 0)
        }
        let totalPeerUp = peerStats.reduce(UInt64(0)) { partial, peer in
            partial + (UInt64(peer["uploadRate"] ?? "") ?? 0)
        }
        peerSummaryModel.detail = "\(peerStats.count) 个  ↓ \(totalPeerDown.bitrateToHumanReadable)/s  ↑ \(totalPeerUp.bitrateToHumanReadable)/s  ·  \(isPeersExpanded ? "点击折叠" : "点击展开")"
        let peerSignature = peerStats.map { peer in
            [peer["ip"], peer["port"], peer["downloadRate"], peer["uploadRate"], peer["client"], peer["transport"], peer["direction"], peer["holepunched"]]
                .compactMap { $0 }
                .joined(separator: "|")
        }.joined(separator: "\n")
        if peerSignature != lastPeerSignature {
            lastPeerSignature = peerSignature
            peerModels = peerStats
                .sorted { lhs, rhs in
                    let lhsRate = (UInt64(lhs["downloadRate"] ?? "") ?? 0) + (UInt64(lhs["uploadRate"] ?? "") ?? 0)
                    let rhsRate = (UInt64(rhs["downloadRate"] ?? "") ?? 0) + (UInt64(rhs["uploadRate"] ?? "") ?? 0)
                    return lhsRate > rhsRate
                }
                .prefix(60)
                .map { peer in
                    let ip = peer["ip"] ?? "?"
                    let port = peer["port"] ?? "0"
                    let host = ip.contains(":") ? "[\(ip)]" : ip
                    let down = UInt64(peer["downloadRate"] ?? "") ?? 0
                    let up = UInt64(peer["uploadRate"] ?? "") ?? 0
                    let transport = peer["transport"] ?? "TCP"
                    let direction = peer["direction"] == "OUT" ? "出站" : "入站"
                    let holepunched = peer["holepunched"] == "1" ? " · HP" : ""
                    let client = peer["client"] ?? ""
                    let clientPart = client.isEmpty ? "" : " · \(client)"
                    return DetailCellViewModel(
                        title: "\(host):\(port)",
                        detail: "↓ \(down.bitrateToHumanReadable)/s   ↑ \(up.bitrateToHumanReadable)/s · \(transport) · \(direction)\(holepunched)\(clientPart)",
                        spacer: 32,
                        isBold: false
                    )
                }
            if isPeersExpanded { reload() }
        }

'''
replace_once("iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift", '        stateModel.detail = friendlyState.name\n\n', '        stateModel.detail = friendlyState.name\n\n' + peer_update, "peer live update")

peer_section = r'''        let peerItems: [MvvmViewModel] = isPeersExpanded
            ? [peerSummaryModel] + peerModels.map { $0 as MvvmViewModel }
            : [peerSummaryModel]
        sections.append(.init(
            id: "peers",
            header: isPeersExpanded ? "Peer 连接详情" : "Peer 连接",
            items: peerItems
        ))

'''
replace_once("iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift", '        sections.append(.init(id: "actions", header: %"details.actions") {\n', peer_section + '        sections.append(.init(id: "actions", header: %"details.actions") {\n', "peer collapsible section")

magnet_helper = r'''    func normalizedMagnetString(_ input: String) -> String {
        let cleaned = input
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "&amp;", with: "&")
        guard cleaned.lowercased().hasPrefix("magnet:?") else { return cleaned }
        let parts = cleaned.split(separator: "&", omittingEmptySubsequences: false)
        guard let first = parts.first else { return cleaned }
        let tail = parts.dropFirst().compactMap { part -> String? in
            let item = String(part).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !item.isEmpty else { return nil }
            let lower = item.lowercased()
            if lower == "dn" || lower == "dn=" { return nil }
            return item
        }
        return ([String(first)] + tail).joined(separator: "&")
    }

'''
replace_once("iTorrent/Screens/TorrentList/TorrentListViewController.swift", '    func makeMagnetAlert() -> UIAlertController {\n', magnet_helper + '    func makeMagnetAlert() -> UIAlertController {\n', "magnet normalization helper")
replace_once("iTorrent/Screens/TorrentList/TorrentListViewController.swift", '            guard let text = alert.textFields?.first?.text,\n                  let url = URL(string: text),\n                  let magnet = MagnetURI(with: url)', '            guard let text = alert.textFields?.first?.text,\n                  let url = URL(string: normalizedMagnetString(text)),\n                  let magnet = MagnetURI(with: url)', "magnet paste normalization")

scene_helper = r'''    func normalizedIncomingMagnetURL(_ url: URL) -> URL {
        let cleaned = url.absoluteString
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "&amp;", with: "&")
        let parts = cleaned.split(separator: "&", omittingEmptySubsequences: false)
        guard let first = parts.first else { return url }
        let tail = parts.dropFirst().compactMap { part -> String? in
            let item = String(part).trimmingCharacters(in: .whitespacesAndNewlines)
            let lower = item.lowercased()
            if item.isEmpty || lower == "dn" || lower == "dn=" { return nil }
            return item
        }
        return URL(string: ([String(first)] + tail).joined(separator: "&")) ?? url
    }

'''
replace_once("iTorrent/Core/SceneDelegate/SceneDelegate+URLProcessing.swift", 'private extension SceneDelegate {\n', 'private extension SceneDelegate {\n' + scene_helper, "incoming magnet normalization helper")
replace_once("iTorrent/Core/SceneDelegate/SceneDelegate+URLProcessing.swift", '        guard url.absoluteString.hasPrefix("magnet:"),\n              let magnet = MagnetURI(with: url)', '        guard url.absoluteString.hasPrefix("magnet:"),\n              let magnet = MagnetURI(with: normalizedIncomingMagnetURL(url))', "incoming magnet normalization")

(ROOT / "BTMOBILE_0.1.3.md").write_text(
    "# BTMobile 0.1.3 Test\n\nBase: XITRIX/iTorrent v2.2.0-1 + BTMobile CrashFix line\nBundle ID for test signing: com.mxmall123.app\nDisplay name: BT Mobile\nVersion: 0.1.3 (build 13)\n\nChanges:\n- Collapsible qBittorrent-style Peer summary/details section.\n- Per-peer IP:port, download/upload rate, TCP/uTP, IN/OUT, HP and client.\n- Multi-router DHT bootstrap for trackerless magnet metadata discovery.\n- DHT works alongside trackers rather than only as fallback.\n- Normalizes empty trailing &dn / &dn= and HTML escaped &amp; magnet links.\n- Keeps the valid Firebase startup configuration used by the CrashFix build.\n",
    encoding="utf-8",
)
print("BTMobile 0.1.3 patch applied successfully")
