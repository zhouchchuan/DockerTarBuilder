from pathlib import Path

ROOT = Path("src")


def replace_once(path, old, new, label):
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"PATCH FAILED [{label}] pattern not found in {p}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}: {p}")

# Product name
replace_once(
    "iTorrent/Screens/TorrentList/TorrentListViewModel.swift",
    '        title = "iTorrent"',
    '        title = "BT Mobile"',
    "app title",
)

# DHT / tracker discovery tuning
replace_once(
    "Submodules/LibTorrent-Swift/LibTorrent/Core/SessionSettings/SessionSettings.mm",
    '    settings.set_str(lt::settings_pack::peer_fingerprint, [_peerFingerprint UTF8String]);\n',
    '    settings.set_str(lt::settings_pack::peer_fingerprint, [_peerFingerprint UTF8String]);\n'
    '    settings.set_str(lt::settings_pack::dht_bootstrap_nodes, "router.bittorrent.com:6881,dht.transmissionbt.com:6881,router.bt.ouinet.work:6881");\n'
    '    settings.set_bool(lt::settings_pack::use_dht_as_fallback, false);\n'
    '    settings.set_bool(lt::settings_pack::announce_to_all_tiers, true);\n'
    '    settings.set_bool(lt::settings_pack::announce_to_all_trackers, true);\n'
    '    settings.set_bool(lt::settings_pack::prefer_udp_trackers, true);\n',
    "dht bootstrap and tracker discovery",
)

# Peer telemetry bridge
replace_once(
    "Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.h",
    '- (void)forceReannounce:(int)index;\n\n- (void)updateSnapshot;',
    '- (void)forceReannounce:(int)index;\n\n- (NSArray<NSDictionary<NSString *, id> *> *)peerStats;\n\n- (void)updateSnapshot;',
    "peer stats header",
)
replace_once(
    "Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.mm",
    '#import "libtorrent/magnet_uri.hpp"\n',
    '#import "libtorrent/magnet_uri.hpp"\n#import "libtorrent/peer_info.hpp"\n',
    "peer info include",
)

peer_impl = r'''
- (NSArray<NSDictionary<NSString *, id> *> *)peerStats {
    __block NSMutableArray<NSDictionary<NSString *, id> *> *result = [NSMutableArray array];

    [self performOperation:@"peerStats" action:^(lt::torrent_handle const &handle) {
        std::vector<lt::peer_info> peers;
        handle.get_peer_info(peers);

        for (auto const &peer : peers) {
            std::string addressString = peer.ip.address().to_string();
            NSString *address = [NSString stringWithUTF8String:addressString.c_str()] ?: @"?";
            NSString *client = [NSString stringWithUTF8String:peer.client.c_str()] ?: @"";
            BOOL isUTP = (peer.flags & lt::peer_info::utp_socket) ? YES : NO;
            BOOL isOutgoing = (peer.flags & lt::peer_info::outgoing_connection) ? YES : NO;
            BOOL isHolepunched = (peer.flags & lt::peer_info::holepunched) ? YES : NO;

            [result addObject:@{
                @"ip": address,
                @"port": @(peer.ip.port()),
                @"downloadRate": @(peer.payload_down_speed),
                @"uploadRate": @(peer.payload_up_speed),
                @"totalDownload": @(peer.total_download),
                @"totalUpload": @(peer.total_upload),
                @"client": client,
                @"transport": isUTP ? @"uTP" : @"TCP",
                @"direction": isOutgoing ? @"OUT" : @"IN",
                @"holepunched": @(isHolepunched),
                @"progress": @(peer.progress)
            }];
        }
    }];

    return result;
}

'''
replace_once(
    "Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.mm",
    '- (void)updateSnapshot {\n',
    peer_impl + '- (void)updateSnapshot {\n',
    "peer stats implementation",
)

# Peer section in torrent details
replace_once(
    "iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift",
    '    private let leechersModel = DetailCellViewModel(title: %"details.transfer.leechers")\n\n    private lazy var downloadPathModel',
    '    private let leechersModel = DetailCellViewModel(title: %"details.transfer.leechers")\n\n'
    '    private var peerModels: [DetailCellViewModel] = []\n'
    '    private var lastPeerRefresh = Date.distantPast\n\n'
    '    private lazy var downloadPathModel',
    "peer ui state",
)

peer_helpers = r'''
    func refreshPeerModelsIfNeeded() {
        let now = Date()
        guard now.timeIntervalSince(lastPeerRefresh) >= 1.0 else { return }
        lastPeerRefresh = now

        let rawPeers = torrentHandle.peerStats() as? [[String: Any]] ?? []
        let sortedPeers = rawPeers.sorted { lhs, rhs in
            let lDown = (lhs["downloadRate"] as? NSNumber)?.int64Value ?? 0
            let lUp = (lhs["uploadRate"] as? NSNumber)?.int64Value ?? 0
            let rDown = (rhs["downloadRate"] as? NSNumber)?.int64Value ?? 0
            let rUp = (rhs["uploadRate"] as? NSNumber)?.int64Value ?? 0
            return (lDown + lUp) > (rDown + rUp)
        }

        peerModels = sortedPeers.prefix(30).map { peer in
            let ip = peer["ip"] as? String ?? "?"
            let port = (peer["port"] as? NSNumber)?.intValue ?? 0
            let down = (peer["downloadRate"] as? NSNumber)?.int64Value ?? 0
            let up = (peer["uploadRate"] as? NSNumber)?.int64Value ?? 0
            let client = peer["client"] as? String ?? ""
            let transport = peer["transport"] as? String ?? "TCP"
            let direction = peer["direction"] as? String ?? ""
            let holepunched = (peer["holepunched"] as? NSNumber)?.boolValue ?? false

            let host = ip.contains(":") ? "[\(ip)]" : ip
            let model = DetailCellViewModel(title: "\(host):\(port)  \(transport)", spacer: 120)
            var suffix = direction.isEmpty ? "" : "  \(direction)"
            if holepunched { suffix += "  HP" }
            if !client.isEmpty { suffix += "  \(client)" }
            model.detail = "↓ \(Self.formatPeerRate(down))/s   ↑ \(Self.formatPeerRate(up))/s\(suffix)"
            return model
        }
    }

    static func formatPeerRate(_ bytesPerSecond: Int64) -> String {
        guard bytesPerSecond > 0 else { return "0 B" }
        let formatter = ByteCountFormatter()
        formatter.countStyle = .binary
        formatter.allowedUnits = [.useKB, .useMB, .useGB]
        formatter.includesUnit = true
        formatter.isAdaptive = true
        return formatter.string(fromByteCount: bytesPerSecond)
    }

'''
replace_once(
    "iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift",
    '    func reload() {\n        let snapshot = torrentHandle.observableSnapshot\n',
    peer_helpers + '    func reload() {\n        refreshPeerModelsIfNeeded()\n        let snapshot = torrentHandle.observableSnapshot\n',
    "peer ui helpers",
)
replace_once(
    "iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift",
    '        sections.append(.init(id: "actions", header: %"details.actions") {\n            trackersModel\n            filesModel\n        })',
    '        if !peerModels.isEmpty {\n'
    '            sections.append(MvvmCollectionSectionModel(\n'
    '                id: "peers",\n'
    '                header: "Peers (\(peerModels.count))  ↓下载 / ↑上传",\n'
    '                style: .platformPlain,\n'
    '                items: peerModels\n'
    '            ))\n'
    '        }\n\n'
    '        sections.append(.init(id: "actions", header: %"details.actions") {\n'
    '            trackersModel\n'
    '            filesModel\n'
    '        })',
    "peer details section",
)

# Magnet normalization
magnet_normalizer = r'''
    func normalizedMagnetString(_ input: String) -> String {
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
replace_once(
    "iTorrent/Screens/TorrentList/TorrentListViewController.swift",
    '    func makeMagnetAlert() -> UIAlertController {\n',
    magnet_normalizer + '    func makeMagnetAlert() -> UIAlertController {\n',
    "magnet normalization helper",
)
replace_once(
    "iTorrent/Screens/TorrentList/TorrentListViewController.swift",
    '            guard let text = alert.textFields?.first?.text,\n                  let url = URL(string: text),\n                  let magnet = MagnetURI(with: url)',
    '            guard let text = alert.textFields?.first?.text,\n'
    '                  let url = URL(string: normalizedMagnetString(text)),\n'
    '                  let magnet = MagnetURI(with: url)',
    "magnet normalization paste path",
)

scene_helper = r'''
    func normalizedIncomingMagnetURL(_ url: URL) -> URL {
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
replace_once(
    "iTorrent/Core/SceneDelegate/SceneDelegate+URLProcessing.swift",
    'private extension SceneDelegate {\n',
    'private extension SceneDelegate {\n' + scene_helper,
    "scene magnet helper",
)
replace_once(
    "iTorrent/Core/SceneDelegate/SceneDelegate+URLProcessing.swift",
    '        guard url.absoluteString.hasPrefix("magnet:"),\n              let magnet = MagnetURI(with: url)',
    '        guard url.absoluteString.hasPrefix("magnet:"),\n'
    '              let magnet = MagnetURI(with: normalizedIncomingMagnetURL(url))',
    "scene magnet normalization",
)

print("BT Mobile V0.1.1 patch2 applied successfully")
