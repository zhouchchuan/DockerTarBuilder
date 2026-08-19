from pathlib import Path
import os

ROOT = Path(os.environ.get("BTMOBILE_SRC", "src"))


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f"marker not found in {path}: {old[:80]!r}")
    path.write_text(text.replace(old, new, 1))


# Expose connected peer endpoints through the existing LibTorrent-Swift bridge.
handle_h = ROOT / "Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.h"
replace_once(
    handle_h,
    "@property (readonly) BOOL isPrivate;\n",
    "@property (readonly) BOOL isPrivate;\n"
    "@property (readonly) NSArray<NSString *> *peerAddresses;\n",
)

handle_mm = ROOT / "Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.mm"
replace_once(
    handle_mm,
    '#import "libtorrent/magnet_uri.hpp"\n',
    '#import "libtorrent/magnet_uri.hpp"\n#import "libtorrent/peer_info.hpp"\n',
)

peer_method = r'''- (NSArray<NSString *> *)peerAddresses {
    NSMutableArray<NSString *> *result = [NSMutableArray array];
    [self performOperation:@"peerAddresses" action:^(lt::torrent_handle const &handle) {
        std::vector<lt::peer_info> peers;
        handle.get_peer_info(peers);
        for (auto const &peer : peers) {
            auto endpoint = peer.ip;
            auto addressString = endpoint.address().to_string();
            if (addressString.empty()) { continue; }
            NSString *host = [NSString stringWithUTF8String:addressString.c_str()];
            if (host == nil || host.length == 0) { continue; }
            NSString *value = [host containsString:@":"]
                ? [NSString stringWithFormat:@"[%@]:%u", host, endpoint.port()]
                : [NSString stringWithFormat:@"%@:%u", host, endpoint.port()];
            [result addObject:value];
        }
    }];
    return result;
}

'''
replace_once(handle_mm, "- (void)updateSnapshot {\n", peer_method + "- (void)updateSnapshot {\n")

# Add Peer/IP rows to the native torrent detail page. Existing upstream detail page
# already exposes live total download/upload rates, progress, transfer totals, files
# and trackers; this patch adds the missing connected-peer endpoint view.
vm = ROOT / "iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift"
replace_once(
    vm,
    "    private var torrentHandle: TorrentHandle!\n",
    "    private var torrentHandle: TorrentHandle!\n"
    "    private let peerCountModel = DetailCellViewModel(title: \"连接 Peer\")\n"
    "    private var peerAddressModels: [DetailCellViewModel] = []\n"
    "    private var lastPeerAddresses: [String] = []\n",
)

replace_once(
    vm,
    "        stateModel.detail = friendlyState.name\n\n",
    "        stateModel.detail = friendlyState.name\n\n"
    "        let peerAddresses = torrentHandle.peerAddresses.sorted()\n"
    "        peerCountModel.detail = \"\\(peerAddresses.count)\"\n"
    "        if peerAddresses != lastPeerAddresses {\n"
    "            lastPeerAddresses = peerAddresses\n"
    "            peerAddressModels = Array(peerAddresses.prefix(100)).enumerated().map { item in\n"
    "                DetailCellViewModel(\n"
    "                    title: \"Peer \\(item.offset + 1)\",\n"
    "                    detail: item.element,\n"
    "                    spacer: 108,\n"
    "                    isBold: false\n"
    "                )\n"
    "            }\n"
    "            reload()\n"
    "        }\n\n",
)

replace_once(
    vm,
    '        sections.append(.init(id: "actions", header: %"details.actions") {\n',
    "        let peerItems: [MvvmViewModel] = [peerCountModel] + peerAddressModels.map { $0 as MvvmViewModel }\n"
    '        sections.append(.init(id: "peers", header: "Peer / IP 地址", items: peerItems))\n\n'
    '        sections.append(.init(id: "actions", header: %"details.actions") {\n',
)

(ROOT / "BTMOBILE_0.1.2.md").write_text(
    "# BTMobile 0.1.2 Test\n\n"
    "Base: XITRIX/iTorrent v2.2.0-1\n"
    "Test bundle ID: com.mxmall123.app\n"
    "Display name: BT Mobile\n\n"
    "Changes:\n"
    "- Native per-torrent details page.\n"
    "- Live total download/upload speeds (upstream detail snapshot).\n"
    "- Live connected Peer count.\n"
    "- Up to 100 connected Peer IP:port endpoints; IPv6 uses [address]:port.\n"
)

print("BTMobile 0.1.2 patch applied")
