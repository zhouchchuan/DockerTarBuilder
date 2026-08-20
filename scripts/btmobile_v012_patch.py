from pathlib import Path

root = Path('source')

# 1) LibTorrent-Swift: expose a typed real-time peer snapshot API.
h = root / 'Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.h'
s = h.read_text()
anchor = '@class TorrentHandleSnapshot;\n\nNS_SWIFT_NAME(TorrentHashes)'
insert = '''@class TorrentHandleSnapshot;\n\n@interface TorrentPeerSnapshot : NSObject\n@property (readonly, copy) NSString *ipAddress;\n@property (readonly) NSInteger port;\n@property (readonly, copy) NSString *client;\n@property (readonly) double progress;\n@property (readonly) uint64_t downloadRate;\n@property (readonly) uint64_t uploadRate;\n@property (readonly) uint64_t totalDownload;\n@property (readonly) uint64_t totalUpload;\n@property (readonly, copy) NSString *transport;\n@property (readonly, copy) NSString *state;\n@property (readonly) BOOL isSeed;\n@property (readonly) BOOL isIncoming;\n@end\n\nNS_SWIFT_NAME(TorrentHashes)'''
assert anchor in s
s = s.replace(anchor, insert, 1)
anchor = '@property (readonly) TorrentHandleSnapshot* snapshot;\n'
insert = '@property (readonly) TorrentHandleSnapshot* snapshot;\n@property (readonly) NSArray<TorrentPeerSnapshot *> *peerSnapshots;\n'
assert anchor in s
s = s.replace(anchor, insert, 1)
h.write_text(s)

mm = root / 'Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.mm'
s = mm.read_text()
anchor = '#import "libtorrent/magnet_uri.hpp"\n'
insert = '#import "libtorrent/magnet_uri.hpp"\n#import "libtorrent/peer_info.hpp"\n'
assert anchor in s
s = s.replace(anchor, insert, 1)
anchor = 'typedef void (^TorrentHandleOperation)(lt::torrent_handle const &handle);\n'
insert = '''typedef void (^TorrentHandleOperation)(lt::torrent_handle const &handle);\n\n@interface TorrentPeerSnapshot ()\n@property (readwrite, copy) NSString *ipAddress;\n@property (readwrite) NSInteger port;\n@property (readwrite, copy) NSString *client;\n@property (readwrite) double progress;\n@property (readwrite) uint64_t downloadRate;\n@property (readwrite) uint64_t uploadRate;\n@property (readwrite) uint64_t totalDownload;\n@property (readwrite) uint64_t totalUpload;\n@property (readwrite, copy) NSString *transport;\n@property (readwrite, copy) NSString *state;\n@property (readwrite) BOOL isSeed;\n@property (readwrite) BOOL isIncoming;\n@end\n\n@implementation TorrentPeerSnapshot\n@end\n'''
assert anchor in s
s = s.replace(anchor, insert, 1)
anchor = '- (void)updateSnapshot {\n'
peer_impl = r'''- (NSArray<TorrentPeerSnapshot *> *)peerSnapshots {
    __block NSMutableArray<TorrentPeerSnapshot *> *result = [NSMutableArray array];
    [self performOperation:@"peerSnapshots" action:^(lt::torrent_handle const &handle) {
        std::vector<lt::peer_info> peers;
        handle.get_peer_info(peers);

        for (auto const &peer : peers) {
            if (static_cast<bool>(peer.flags & lt::peer_info::i2p_socket)) { continue; }

            auto endpoint = peer.remote_endpoint();
            auto address = endpoint.address().to_string();

            TorrentPeerSnapshot *item = [TorrentPeerSnapshot new];
            item.ipAddress = [NSString stringWithUTF8String:address.c_str()] ?: @"";
            item.port = (NSInteger)endpoint.port();
            item.client = peer.client.empty() ? @"Unknown" : ([NSString stringWithUTF8String:peer.client.c_str()] ?: @"Unknown");
            item.progress = ((double)peer.progress_ppm) / 10000.0;
            item.downloadRate = (uint64_t)std::max(0, peer.payload_down_speed);
            item.uploadRate = (uint64_t)std::max(0, peer.payload_up_speed);
            item.totalDownload = (uint64_t)std::max<std::int64_t>(0, peer.total_download);
            item.totalUpload = (uint64_t)std::max<std::int64_t>(0, peer.total_upload);

            BOOL isUTP = static_cast<bool>(peer.flags & lt::peer_info::utp_socket);
            BOOL isSSL = static_cast<bool>(peer.flags & lt::peer_info::ssl_socket);
            item.transport = isUTP ? @"uTP" : (isSSL ? @"TCP/TLS" : @"TCP");
            item.isSeed = static_cast<bool>(peer.flags & lt::peer_info::seed);
            item.isIncoming = !static_cast<bool>(peer.flags & lt::peer_info::outgoing_connection);

            if (static_cast<bool>(peer.flags & lt::peer_info::connecting)) {
                item.state = @"连接中";
            } else if (static_cast<bool>(peer.flags & lt::peer_info::handshake)) {
                item.state = @"握手中";
            } else if (peer.payload_down_speed > 0 && peer.payload_up_speed > 0) {
                item.state = @"收发中";
            } else if (peer.payload_down_speed > 0) {
                item.state = @"下载中";
            } else if (peer.payload_up_speed > 0) {
                item.state = @"上传中";
            } else if (item.isSeed) {
                item.state = @"做种";
            } else {
                item.state = @"空闲";
            }
            [result addObject:item];
        }
    }];
    return result;
}

'''
assert anchor in s
s = s.replace(anchor, peer_impl + anchor, 1)
mm.write_text(s)

# 2) iTorrent details UI: render a live Peer section on the existing torrent detail page.
vm = root / 'iTorrent/Screens/TorrentDetails/TorrentDetailsViewModel.swift'
s = vm.read_text()
anchor = '    func reload() {\n'
helper = r'''    func peerModels(from peers: [TorrentPeerSnapshot]) -> [MvvmViewModel] {
        let sorted = peers.sorted {
            ($0.downloadRate + $0.uploadRate) > ($1.downloadRate + $1.uploadRate)
        }

        guard !sorted.isEmpty else {
            return [DetailCellViewModel(
                title: "暂无已连接 Peer",
                detail: "等待 Tracker / DHT / PEX 建立节点连接",
                spacer: 12,
                isBold: false,
                isEnabled: false
            )]
        }

        return sorted.map { peer in
            let endpoint = peer.ipAddress.contains(":")
                ? "[\(peer.ipAddress)]:\(peer.port)"
                : "\(peer.ipAddress):\(peer.port)"
            let progress = String(format: "%.1f%%", peer.progress)
            let down = peer.downloadRate.bitrateToHumanReadable
            let up = peer.uploadRate.bitrateToHumanReadable
            let totalDown = peer.totalDownload.bitrateToHumanReadable
            let totalUp = peer.totalUpload.bitrateToHumanReadable
            let direction = peer.isIncoming ? "入站" : "出站"
            let seed = peer.isSeed ? " · Seed" : ""
            let client = peer.client.isEmpty ? "Unknown" : peer.client
            let detail = "客户端 \(client) · \(peer.transport) · \(direction)\(seed)\nPeer进度 \(progress) · 当前下载 ↓ \(down)/s · 当前上传 ↑ \(up)/s\n累计下载 ↓ \(totalDown) · 累计上传 ↑ \(totalUp) · 状态 \(peer.state)"
            return DetailCellViewModel(title: endpoint, detail: detail, spacer: 12)
        }
    }

'''
assert anchor in s
s = s.replace(anchor, helper + anchor, 1)
anchor = '''        sections.append(.init(id: "transfer", header: %"details.transfer") {
            selectedModel
            completedModel
            selectedProgressModel
            downloadedModel
            uploadedModel
            seedersModel
            leechersModel
        })

'''
insert = anchor + '''        let peers = torrentHandle.peerSnapshots
        sections.append(.init(
            id: "peers",
            header: "Peer 节点 · \\(peers.count)",
            items: peerModels(from: peers)
        ))

'''
assert anchor in s
s = s.replace(anchor, insert, 1)
vm.write_text(s)

print('BTMobile V0.1.2 peer patch applied successfully')
