from pathlib import Path
import os

ROOT = Path(os.environ.get('BTMOBILE_SRC', 'src'))


def replace_once(rel, old, new, label):
    p = ROOT / rel
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'PATCH FAILED [{label}] marker not found in {p}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print('patched', label)

# -----------------------------------------------------------------------------
# 1) Direct in-app subfolder save path support. This does NOT touch DHT/tracker
#    settings from V0.1.3.
# -----------------------------------------------------------------------------
replace_once(
    'Submodules/LibTorrent-Swift/LibTorrent/Core/Session/Session.h',
    '- (TorrentHandle* _Nullable)addTorrent:(id<Downloadable>)torrent to: (NSUUID* _Nullable)storage;\n',
    '- (TorrentHandle* _Nullable)addTorrent:(id<Downloadable>)torrent to: (NSUUID* _Nullable)storage;\n'
    '- (TorrentHandle* _Nullable)addTorrent:(id<Downloadable>)torrent savePath:(NSURL *)savePath;\n',
    'session direct save path header'
)

session_mm = ROOT / 'Submodules/LibTorrent-Swift/LibTorrent/Core/Session/Session.mm'
s = session_mm.read_text(encoding='utf-8')
old_start = '''- (TorrentHandle* _Nullable)addTorrent:(id<Downloadable>)torrent {\n    return [self addTorrent:torrent to:NULL];\n}\n\n- (TorrentHandle* _Nullable)addTorrent:(id<Downloadable>)torrent to: (NSUUID* _Nullable)storage {\n    lt::add_torrent_params params;\n'''
new_start = '''- (TorrentHandle* _Nullable)addTorrent:(id<Downloadable>)torrent {\n    return [self addTorrent:torrent to:NULL savePath:NULL];\n}\n\n- (TorrentHandle* _Nullable)addTorrent:(id<Downloadable>)torrent to: (NSUUID* _Nullable)storage {\n    return [self addTorrent:torrent to:storage savePath:NULL];\n}\n\n- (TorrentHandle* _Nullable)addTorrent:(id<Downloadable>)torrent savePath:(NSURL *)savePath {\n    return [self addTorrent:torrent to:NULL savePath:savePath];\n}\n\n- (TorrentHandle* _Nullable)addTorrent:(id<Downloadable>)torrent to:(NSUUID* _Nullable)storage savePath:(NSURL* _Nullable)explicitSavePath {\n    lt::add_torrent_params params;\n'''
if old_start not in s:
    raise SystemExit('PATCH FAILED [session internal add helper]')
s = s.replace(old_start, new_start, 1)

old_path = '''    // Set custom or default save path\n    StorageModel* storageModel = NULL;\n    BOOL customPathSetted = false;\n    if (storage != NULL && [_storages objectForKey:storage] != NULL) {\n        storageModel = [_storages objectForKey:storage];\n        params.save_path = [storageModel.URL.path UTF8String];\n        customPathSetted = true;\n    } else if (params.save_path.length() != 0) {\n        auto storageUUID = [[NSUUID alloc] initWithUUIDString: [[NSString alloc] initWithUTF8String: params.save_path.c_str()]];\n        auto storage = [_storages objectForKey:storageUUID];\n        if (storage != NULL) {\n            storageModel = storage;\n            params.save_path = storageModel.URL.path.UTF8String;\n            customPathSetted = true;\n        }\n    }\n\n    if (!customPathSetted) {\n        params.save_path = [_downloadPath UTF8String];\n    }\n'''
new_path = '''    // Set explicit in-app subfolder, custom external storage or default path.\n    // BTMobile 0.1.4 keeps direct paths only inside the app's default download root.\n    StorageModel* storageModel = NULL;\n    BOOL customPathSetted = false;\n    NSString *defaultStoragePrefix = [_downloadPath stringByAppendingString:@"/"];\n\n    if (explicitSavePath != NULL) {\n        NSString *candidate = explicitSavePath.standardizedURL.path;\n        if ([candidate isEqualToString:_downloadPath] || [candidate hasPrefix:defaultStoragePrefix]) {\n            params.save_path = candidate.UTF8String;\n            customPathSetted = true;\n        }\n    }\n\n    if (!customPathSetted && storage != NULL && [_storages objectForKey:storage] != NULL) {\n        storageModel = [_storages objectForKey:storage];\n        params.save_path = [storageModel.URL.path UTF8String];\n        customPathSetted = true;\n    } else if (!customPathSetted && params.save_path.length() != 0) {\n        NSString *persistedPath = [[NSString alloc] initWithUTF8String:params.save_path.c_str()];\n        auto storageUUID = [[NSUUID alloc] initWithUUIDString:persistedPath];\n        auto restoredStorage = storageUUID != nil ? [_storages objectForKey:storageUUID] : nil;\n        if (restoredStorage != NULL) {\n            storageModel = restoredStorage;\n            params.save_path = storageModel.URL.path.UTF8String;\n            customPathSetted = true;\n        } else if ([persistedPath isEqualToString:_downloadPath] || [persistedPath hasPrefix:defaultStoragePrefix]) {\n            // V0.1.4 direct internal folder path persisted in fast-resume data.\n            params.save_path = persistedPath.UTF8String;\n            customPathSetted = true;\n        }\n    }\n\n    if (!customPathSetted) {\n        params.save_path = [_downloadPath UTF8String];\n    }\n'''
if old_path not in s:
    raise SystemExit('PATCH FAILED [session save path selection]')
s = s.replace(old_path, new_path, 1)
session_mm.write_text(s, encoding='utf-8')

replace_once(
    'Submodules/LibTorrent-Swift/LibTorrent/Core/TorrentHandle/TorrentHandle.mm',
    '''            auto torrentFile = [[TorrentFile alloc] initUnsafeWithFileAtURL:[[NSURL alloc] initFileURLWithPath:torrentFilePath]];\n            _session.session->remove_torrent(torrentHandle);\n            auto newTorrentHandle = [_session addTorrent:torrentFile];\n''',
    '''            auto torrentFile = [[TorrentFile alloc] initUnsafeWithFileAtURL:[[NSURL alloc] initFileURLWithPath:torrentFilePath]];\n            NSURL *reloadSavePath = snapshot.downloadPath;\n            NSUUID *reloadStorageUUID = self.storageUUID;\n            _session.session->remove_torrent(torrentHandle);\n            auto newTorrentHandle = reloadStorageUUID != nil\n                ? [_session addTorrent:torrentFile to:reloadStorageUUID]\n                : [_session addTorrent:torrentFile savePath:reloadSavePath];\n''',
    'torrent reload preserves direct path'
)

replace_once(
    'iTorrent/Services/TorrentService/TorrentService.swift',
    '''    @discardableResult\n    func addTorrent(by file: Downloadable, at storage: UUID? = nil) -> Bool {\n        guard session.torrentsMap[file.infoHashes] == nil\n        else { return false }\n\n        session.addTorrent(file, to: storage ?? preferences.defaultStorage)\n        return true\n    }\n''',
    '''    @discardableResult\n    func addTorrent(by file: Downloadable, at storage: UUID? = nil) -> Bool {\n        guard session.torrentsMap[file.infoHashes] == nil\n        else { return false }\n\n        session.addTorrent(file, to: storage ?? preferences.defaultStorage)\n        return true\n    }\n\n    @discardableResult\n    func addTorrent(by file: Downloadable, atPath path: URL) -> Bool {\n        guard session.torrentsMap[file.infoHashes] == nil else { return false }\n\n        let root = Self.downloadPath.standardizedFileURL\n        let target = path.standardizedFileURL\n        let prefix = root.path.hasSuffix("/") ? root.path : root.path + "/"\n        guard target.path == root.path || target.path.hasPrefix(prefix) else { return false }\n\n        do {\n            try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)\n        } catch {\n            return false\n        }\n\n        session.addTorrent(file, savePath: target)\n        return true\n    }\n''',
    'torrent service direct path API'
)

replace_once(
    'iTorrent/Screens/TorrentAdd/TorrentAddViewModel.swift',
    '    private var completion: ((Bool) -> Void)?\n\n    let updatePublisher',
    '    private var completion: ((Bool) -> Void)?\n    private(set) var customDownloadPath: URL?\n\n    let updatePublisher',
    'torrent add custom path state'
)
replace_once(
    'iTorrent/Screens/TorrentAdd/TorrentAddViewModel.swift',
    '''    func download() {\n        TorrentService.shared.addTorrent(by: torrentFile, at: downloadStorage.value)\n        completion?(true)\n        dismiss()\n    }\n''',
    '''    func download() {\n        let added: Bool\n        if let customDownloadPath {\n            added = TorrentService.shared.addTorrent(by: torrentFile, atPath: customDownloadPath)\n        } else {\n            added = TorrentService.shared.addTorrent(by: torrentFile, at: downloadStorage.value)\n        }\n        completion?(added)\n        if added { dismiss() }\n    }\n\n    func setCustomDownloadPath(_ path: URL?) {\n        customDownloadPath = path\n        if path != nil { downloadStorage.value = nil }\n        updatePublisher.send()\n    }\n\n    var customDownloadPathTitle: String {\n        guard let customDownloadPath else { return "下载目录" }\n        if customDownloadPath.standardizedFileURL == TorrentService.downloadPath.standardizedFileURL {\n            return "BTMobile 根目录"\n        }\n        return customDownloadPath.lastPathComponent\n    }\n''',
    'torrent add custom path download'
)

replace_once(
    'iTorrent/Screens/TorrentAdd/TorrentAddViewController.swift',
    '    private let storageButton = UIBarButtonItem(title: %"addTorrent.storage.selected", image: .init(systemName: "externaldrive"))\n',
    '    private let storageButton = UIBarButtonItem(title: %"addTorrent.storage.selected", image: .init(systemName: "externaldrive"))\n    private let pathButton = UIBarButtonItem(title: "下载目录", image: .init(systemName: "folder"))\n',
    'torrent add path button'
)
replace_once(
    'iTorrent/Screens/TorrentAdd/TorrentAddViewController.swift',
    '''        if #available(iOS 26, visionOS 99999, *) {\n            toolbarItems = [\n                .init(customView: diskLabel),\n                .init(systemItem: .flexibleSpace),\n                storageButton,\n                priorityButton\n            ]\n        } else {\n            toolbarItems = [\n                .init(customView: diskLabel),\n                .init(systemItem: .flexibleSpace),\n                storageButton,\n                .fixedSpace(16),\n                priorityButton\n            ]\n        }\n''',
    '''        if #available(iOS 26, visionOS 99999, *) {\n            toolbarItems = [\n                .init(customView: diskLabel),\n                .init(systemItem: .flexibleSpace),\n                pathButton,\n                storageButton,\n                priorityButton\n            ]\n        } else {\n            toolbarItems = [\n                .init(customView: diskLabel),\n                .init(systemItem: .flexibleSpace),\n                pathButton,\n                .fixedSpace(12),\n                storageButton,\n                .fixedSpace(12),\n                priorityButton\n            ]\n        }\n\n        pathButton.isHidden = !viewModel.isRoot\n        updatePathButton()\n''',
    'torrent add toolbar path selector'
)
replace_once(
    'iTorrent/Screens/TorrentAdd/TorrentAddViewController.swift',
    '''            downloadButton.tapPublisher.sink { [unowned self] _ in\n                viewModel.download()\n            }\n            viewModel.diskTextPublisher.sink { [unowned self] text in\n''',
    '''            downloadButton.tapPublisher.sink { [unowned self] _ in\n                viewModel.download()\n            }\n            pathButton.tapPublisher.sink { [unowned self] _ in\n                presentDownloadFolderPicker()\n            }\n            viewModel.updatePublisher.sink { [weak self] _ in\n                self?.updatePathButton()\n            }\n            viewModel.diskTextPublisher.sink { [unowned self] text in\n''',
    'torrent add path binding'
)
replace_once(
    'iTorrent/Screens/TorrentAdd/TorrentAddViewController.swift',
    'private extension TorrentAddViewController {\n    static func makeDiskLabel()',
    '''private extension TorrentAddViewController {\n    func updatePathButton() {\n        pathButton.title = viewModel.customDownloadPathTitle\n    }\n\n    func presentDownloadFolderPicker() {\n        let picker = BTFileBrowserViewController(\n            currentURL: TorrentService.downloadPath,\n            rootURL: TorrentService.downloadPath,\n            selectionMode: true\n        ) { [weak self] url in\n            self?.viewModel.setCustomDownloadPath(url)\n            self?.updatePathButton()\n        }\n        present(UINavigationController(rootViewController: picker), animated: true)\n    }\n\n    static func makeDiskLabel()''',
    'torrent add path picker methods'
)
replace_once(
    'iTorrent/Screens/TorrentAdd/TorrentAddViewController.swift',
    '''                    viewModel.downloadStorage.value = storage.uuid\n                    updateMenu()\n''',
    '''                    viewModel.setCustomDownloadPath(nil)\n                    viewModel.downloadStorage.value = storage.uuid\n                    updateMenu()\n''',
    'storage selection clears custom path'
)

replace_once(
    'iTorrent/Screens/TorrentList/TorrentListViewController.swift',
    '''import Combine\nimport CombineCocoa\nimport LibTorrent\n''',
    '''import AVFoundation\nimport AVKit\nimport Combine\nimport CombineCocoa\nimport LibTorrent\nimport QuickLook\nimport ZipArchive\n''',
    'file manager imports'
)
replace_once(
    'iTorrent/Screens/TorrentList/TorrentListViewController.swift',
    '    private let preferencesButton = UIBarButtonItem(title: %"preferences", image: .init(systemName: "gearshape.fill"))\n',
    '    private let preferencesButton = UIBarButtonItem(title: %"preferences", image: .init(systemName: "gearshape.fill"))\n    private let filesButton = UIBarButtonItem(title: "文件", image: .init(systemName: "folder.fill"))\n',
    'main file manager button'
)
replace_once(
    'iTorrent/Screens/TorrentList/TorrentListViewController.swift',
    '            [addButton, .init(systemItem: .flexibleSpace), preferencesButton]\n',
    '            [addButton, .init(systemItem: .flexibleSpace), filesButton, .fixedSpace(16), preferencesButton]\n',
    'main toolbar file manager'
)
replace_once(
    'iTorrent/Screens/TorrentList/TorrentListViewController.swift',
    '''            preferencesButton.tapPublisher.uiSink { [unowned self] _ in\n                viewModel.preferencesAction()\n            }\n''',
    '''            filesButton.tapPublisher.uiSink { [unowned self] _ in\n                let browser = BTFileBrowserViewController(\n                    currentURL: TorrentService.downloadPath,\n                    rootURL: TorrentService.downloadPath\n                )\n                present(UINavigationController(rootViewController: browser), animated: true)\n            }\n\n            preferencesButton.tapPublisher.uiSink { [unowned self] _ in\n                viewModel.preferencesAction()\n            }\n''',
    'file manager button binding'
)

old_magnet = '''    func makeMagnetAlert() -> UIAlertController {\n        let alert = UIAlertController(title: %"list.add.magnet.title", message: %"list.add.magnet.message", preferredStyle: .alert)\n\n        alert.addTextField { textField in\n            textField.placeholder = %"list.add.magnet.placeholder"\n        }\n\n        alert.addAction(.init(title: %"common.cancel", style: .cancel))\n        alert.addAction(.init(title: %"common.ok", style: .default) { [unowned self] _ in\n            guard let text = alert.textFields?.first?.text,\n                  let url = URL(string: normalizedMagnetString(text)),\n                  let magnet = MagnetURI(with: url)\n            else {\n                let alert = UIAlertController(title: %"common.error", message: %"list.add.magnet.error", preferredStyle: .alert)\n                alert.addAction(.init(title: %"common.close", style: .cancel), isPrimary: true)\n                present(alert, animated: true)\n                return\n            }\n\n            guard !TorrentService.shared.checkTorrentExists(with: magnet.infoHashes) else {\n                let alert = UIAlertController(title: %"addTorrent.exists", message: %"addTorrent.\\(magnet.infoHashes.best.hex)_exists", preferredStyle: .alert)\n                alert.addAction(.init(title: %"common.close", style: .cancel), isPrimary: true)\n                present(alert, animated: true)\n                return\n            }\n\n            TorrentService.shared.addTorrent(by: magnet)\n        }, isPrimary: true)\n        return alert\n    }\n'''
new_magnet = '''    func validatedMagnet(from alert: UIAlertController) -> MagnetURI? {\n        guard let text = alert.textFields?.first?.text,\n              let url = URL(string: normalizedMagnetString(text)),\n              let magnet = MagnetURI(with: url)\n        else {\n            let errorAlert = UIAlertController(title: %"common.error", message: %"list.add.magnet.error", preferredStyle: .alert)\n            errorAlert.addAction(.init(title: %"common.close", style: .cancel), isPrimary: true)\n            present(errorAlert, animated: true)\n            return nil\n        }\n\n        guard !TorrentService.shared.checkTorrentExists(with: magnet.infoHashes) else {\n            let existsAlert = UIAlertController(title: %"addTorrent.exists", message: %"addTorrent.\\(magnet.infoHashes.best.hex)_exists", preferredStyle: .alert)\n            existsAlert.addAction(.init(title: %"common.close", style: .cancel), isPrimary: true)\n            present(existsAlert, animated: true)\n            return nil\n        }\n        return magnet\n    }\n\n    func makeMagnetAlert() -> UIAlertController {\n        let alert = UIAlertController(title: %"list.add.magnet.title", message: "可直接添加到默认目录，或为本任务选择 BTMobile 内的下载文件夹。", preferredStyle: .alert)\n\n        alert.addTextField { textField in\n            textField.placeholder = %"list.add.magnet.placeholder"\n        }\n\n        alert.addAction(.init(title: %"common.cancel", style: .cancel))\n        alert.addAction(.init(title: "默认目录", style: .default) { [unowned self] _ in\n            guard let magnet = validatedMagnet(from: alert) else { return }\n            TorrentService.shared.addTorrent(by: magnet)\n        })\n        alert.addAction(.init(title: "选择下载目录…", style: .default) { [unowned self] _ in\n            guard let magnet = validatedMagnet(from: alert) else { return }\n            let picker = BTFileBrowserViewController(\n                currentURL: TorrentService.downloadPath,\n                rootURL: TorrentService.downloadPath,\n                selectionMode: true\n            ) { url in\n                TorrentService.shared.addTorrent(by: magnet, atPath: url)\n            }\n            present(UINavigationController(rootViewController: picker), animated: true)\n        }, isPrimary: true)\n        return alert\n    }\n'''
replace_once('iTorrent/Screens/TorrentList/TorrentListViewController.swift', old_magnet, new_magnet, 'magnet per-task folder selection')

list_vc = ROOT / 'iTorrent/Screens/TorrentList/TorrentListViewController.swift'
s = list_vc.read_text(encoding='utf-8')
append_code = r'''

// MARK: - BTMobile 0.1.4 File Manager
final class BTFileBrowserViewController: UITableViewController, QLPreviewControllerDataSource {
    private let currentURL: URL
    private let rootURL: URL
    private let selectionMode: Bool
    private let selectionHandler: ((URL) -> Void)?
    private var items: [URL] = []
    private var previewURL: URL?

    private static let mediaExtensions: Set<String> = [
        "mp4", "m4v", "mov", "mkv", "avi", "webm", "ts", "m2ts", "mpg", "mpeg", "flv",
        "mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"
    ]

    init(currentURL: URL, rootURL: URL, selectionMode: Bool = false, selectionHandler: ((URL) -> Void)? = nil) {
        self.currentURL = currentURL.standardizedFileURL
        self.rootURL = rootURL.standardizedFileURL
        self.selectionMode = selectionMode
        self.selectionHandler = selectionHandler
        super.init(style: .insetGrouped)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = currentURL == rootURL ? "BTMobile 文件" : currentURL.lastPathComponent
        navigationItem.largeTitleDisplayMode = .never
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "file")

        let addFolder = UIBarButtonItem(title: "新建", image: UIImage(systemName: "folder.badge.plus"), target: self, action: #selector(newFolder))
        if selectionMode {
            let choose = UIBarButtonItem(title: "选择此文件夹", style: .done, target: self, action: #selector(selectCurrentFolder))
            navigationItem.rightBarButtonItems = [choose, addFolder]
            if navigationController?.viewControllers.first === self {
                navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
            }
        } else {
            navigationItem.rightBarButtonItem = addFolder
            if navigationController?.viewControllers.first === self {
                navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .close, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
            }
        }
        reloadDirectory()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reloadDirectory()
    }

    private func reloadDirectory() {
        do {
            items = try FileManager.default.contentsOfDirectory(
                at: currentURL,
                includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey],
                options: [.skipsHiddenFiles]
            ).sorted { lhs, rhs in
                let ld = (try? lhs.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
                let rd = (try? rhs.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
                if ld != rd { return ld }
                return lhs.lastPathComponent.localizedStandardCompare(rhs.lastPathComponent) == .orderedAscending
            }
            tableView.reloadData()
        } catch {
            items = []
            tableView.reloadData()
            showError(error.localizedDescription)
        }
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { items.count }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "file", for: indexPath)
        let url = items[indexPath.row]
        var content = cell.defaultContentConfiguration()
        let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey])
        let isDirectory = values?.isDirectory == true
        content.text = url.lastPathComponent
        content.image = isDirectory ? UIImage(systemName: "folder.fill") : UIImage.icon(forFileURL: url)
        if !isDirectory, let fileSize = values?.fileSize {
            content.secondaryText = ByteCountFormatter.string(fromByteCount: Int64(fileSize), countStyle: .file)
        } else if isDirectory {
            content.secondaryText = "文件夹"
        }
        cell.contentConfiguration = content
        cell.accessoryType = isDirectory ? .disclosureIndicator : .none
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let url = items[indexPath.row]
        if (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
            navigationController?.pushViewController(
                BTFileBrowserViewController(currentURL: url, rootURL: rootURL, selectionMode: selectionMode, selectionHandler: selectionHandler),
                animated: true
            )
            return
        }
        openFile(url)
    }

    override func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        let url = items[indexPath.row]
        let delete = UIContextualAction(style: .destructive, title: "删除") { [weak self] _, _, completion in
            self?.confirmDelete(url, completion: completion)
        }
        let rename = UIContextualAction(style: .normal, title: "重命名") { [weak self] _, _, completion in
            self?.promptRename(url)
            completion(true)
        }
        rename.image = UIImage(systemName: "pencil")
        return UISwipeActionsConfiguration(actions: [delete, rename])
    }

    @objc private func selectCurrentFolder() {
        selectionHandler?(currentURL)
        dismiss(animated: true)
    }

    @objc private func newFolder() {
        let alert = UIAlertController(title: "新建文件夹", message: nil, preferredStyle: .alert)
        alert.addTextField { $0.placeholder = "文件夹名称" }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "创建", style: .default) { [weak self] _ in
            guard let self, let raw = alert.textFields?.first?.text else { return }
            let name = sanitizeName(raw)
            guard !name.isEmpty else { return }
            do {
                try FileManager.default.createDirectory(at: currentURL.appendingPathComponent(name, isDirectory: true), withIntermediateDirectories: false)
                reloadDirectory()
            } catch { showError(error.localizedDescription) }
        })
        present(alert, animated: true)
    }

    private func promptRename(_ url: URL) {
        let alert = UIAlertController(title: "重命名", message: nil, preferredStyle: .alert)
        alert.addTextField { $0.text = url.lastPathComponent }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "确定", style: .default) { [weak self] _ in
            guard let self, let raw = alert.textFields?.first?.text else { return }
            let name = sanitizeName(raw)
            guard !name.isEmpty, name != url.lastPathComponent else { return }
            do {
                try FileManager.default.moveItem(at: url, to: url.deletingLastPathComponent().appendingPathComponent(name))
                reloadDirectory()
            } catch { showError(error.localizedDescription) }
        })
        present(alert, animated: true)
    }

    private func confirmDelete(_ url: URL, completion: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "确认删除？", message: url.lastPathComponent, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completion(false) })
        alert.addAction(UIAlertAction(title: "删除", style: .destructive) { [weak self] _ in
            do {
                try FileManager.default.removeItem(at: url)
                self?.reloadDirectory()
                completion(true)
            } catch {
                self?.showError(error.localizedDescription)
                completion(false)
            }
        })
        present(alert, animated: true)
    }

    private func sanitizeName(_ raw: String) -> String {
        let forbidden = CharacterSet(charactersIn: "/\\:?%*|\"<>").union(.controlCharacters).union(.newlines)
        return raw.components(separatedBy: forbidden).joined(separator: "_").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func openFile(_ url: URL) {
        let ext = url.pathExtension.lowercased()
        if ext == "zip" || ext == "cbz" {
            promptArchiveAction(url)
        } else if Self.mediaExtensions.contains(ext) {
            play(url)
        } else {
            previewURL = url
            let preview = QLPreviewController()
            preview.dataSource = self
            present(preview, animated: true)
        }
    }

    private func play(_ url: URL) {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, options: [])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {}
        let player = AVPlayer(url: url)
        let vc = AVPlayerViewController()
        vc.player = player
        vc.allowsPictureInPicturePlayback = true
        present(vc, animated: true) { player.play() }
    }

    private func promptArchiveAction(_ url: URL) {
        let alert = UIAlertController(title: "解压缩", message: url.lastPathComponent, preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "直接解压", style: .default) { [weak self] _ in
            self?.extractArchive(url, password: nil)
        })
        alert.addAction(UIAlertAction(title: "输入密码解压", style: .default) { [weak self] _ in
            self?.promptArchivePassword(url)
        })
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.popoverPresentationController?.sourceView = view
        alert.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(alert, animated: true)
    }

    private func promptArchivePassword(_ url: URL) {
        let alert = UIAlertController(title: "压缩包密码", message: url.lastPathComponent, preferredStyle: .alert)
        alert.addTextField {
            $0.placeholder = "请输入密码"
            $0.isSecureTextEntry = true
        }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "解压", style: .default) { [weak self] _ in
            let password = alert.textFields?.first?.text ?? ""
            self?.extractArchive(url, password: password)
        })
        present(alert, animated: true)
    }

    private func extractArchive(_ url: URL, password: String?) {
        var destination = url.deletingPathExtension()
        var suffix = 1
        while FileManager.default.fileExists(atPath: destination.path) {
            destination = url.deletingLastPathComponent().appendingPathComponent("\(url.deletingPathExtension().lastPathComponent)-解压\(suffix)", isDirectory: true)
            suffix += 1
        }
        do {
            try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        } catch {
            showError(error.localizedDescription)
            return
        }

        let progress = UIAlertController(title: "正在解压…", message: url.lastPathComponent, preferredStyle: .alert)
        present(progress, animated: true)

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var unzipError: NSError?
            let ok = SSZipArchive.unzipFile(
                atPath: url.path,
                toDestination: destination.path,
                overwrite: true,
                password: password,
                error: &unzipError
            )
            DispatchQueue.main.async {
                progress.dismiss(animated: true) {
                    guard let self else { return }
                    if ok {
                        self.reloadDirectory()
                        let done = UIAlertController(title: "解压完成", message: destination.lastPathComponent, preferredStyle: .alert)
                        done.addAction(UIAlertAction(title: "确定", style: .default))
                        self.present(done, animated: true)
                    } else {
                        try? FileManager.default.removeItem(at: destination)
                        if password == nil {
                            self.promptArchivePassword(url)
                        } else {
                            self.showError(unzipError?.localizedDescription ?? "密码错误或压缩包格式不受支持")
                        }
                    }
                }
            }
        }
    }

    private func showError(_ message: String) {
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "操作失败", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "确定", style: .default))
        present(alert, animated: true)
    }

    func numberOfPreviewItems(in controller: QLPreviewController) -> Int { previewURL == nil ? 0 : 1 }
    func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { previewURL! as NSURL }
}
'''
if 'final class BTFileBrowserViewController' in s:
    raise SystemExit('PATCH FAILED file browser already present')
s += append_code
list_vc.write_text(s, encoding='utf-8')
print('patched file manager UI')

replace_once(
    'iTorrent/Screens/TorrentFiles/Cells/TorrentFilesFileItem/TorrentFilesFileItemViewModel.swift',
    '''        selectAction = { [unowned self] in\n            if file.progress >= 1 {\n                previewAction?()\n            } else {\n                selected.send()\n            }\n        }\n''',
    '''        selectAction = { [unowned self] in\n            if file.progress >= 1 || file.isBTMobileStreamableMedia {\n                previewAction?()\n            } else {\n                selected.send()\n            }\n        }\n''',
    'partial media tap opens preview'
)
vm_path = ROOT / 'iTorrent/Screens/TorrentFiles/Cells/TorrentFilesFileItem/TorrentFilesFileItemViewModel.swift'
s = vm_path.read_text(encoding='utf-8')
s += r'''

extension FileEntry {
    var isBTMobileStreamableMedia: Bool {
        let ext = URL(fileURLWithPath: name).pathExtension.lowercased()
        return ["mp4", "m4v", "mov", "mkv", "avi", "webm", "ts", "m2ts", "mpg", "mpeg", "flv", "mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"].contains(ext)
    }
}
'''
vm_path.write_text(s, encoding='utf-8')
replace_once(
    'iTorrent/Screens/TorrentFiles/TorrentFilesViewModel.swift',
    '''    var filesForPreview: [FileEntry] {\n        filesForPreviewUnfiltered\n        .filter {\n            $0.downloaded >= $0.size\n        }\n    }\n''',
    '''    var filesForPreview: [FileEntry] {\n        filesForPreviewUnfiltered\n        .filter {\n            $0.downloaded >= $0.size || $0.isBTMobileStreamableMedia\n        }\n    }\n''',
    'preview list includes streamable media'
)
replace_once(
    'iTorrent/Screens/TorrentFiles/TorrentFilesViewController.swift',
    '''        let path = viewModel.filesForPreview[startIndex].path\n        let url = viewModel.downloadPath.appending(path: path)\n\n        Task {\n''',
    '''        let previewFile = viewModel.filesForPreview[startIndex]\n        let path = previewFile.path\n        let url = viewModel.downloadPath.appending(path: path)\n\n        if previewFile.downloaded < previewFile.size, previewFile.isBTMobileStreamableMedia {\n            viewModel.torrentHandle.setFilePriority(.topPriority, at: fileIndex)\n            viewModel.torrentHandle.setSequentialDownload(true)\n\n            if previewFile.downloaded == 0 {\n                let buffering = UIAlertController(\n                    title: "已开启边下边播",\n                    message: "正在优先下载视频开头数据。首次播放如果尚未生成文件，请等待几秒后再次点击。",\n                    preferredStyle: .alert\n                )\n                buffering.addAction(.init(title: "继续播放", style: .default) { [weak self] _ in\n                    guard let self else { return }\n                    self.vlcPlayerAction(url: url, index: fileIndex)\n                })\n                present(buffering, animated: true)\n            } else {\n                vlcPlayerAction(url: url, index: fileIndex)\n            }\n            return\n        }\n\n        Task {\n''',
    'edge playback sequential VLC'
)

pbx = ROOT / 'iTorrent.xcodeproj/project.pbxproj'
s = pbx.read_text(encoding='utf-8')
if 'B7140003B7140003B7140003 /* ZipArchive */' not in s:
    s = s.replace('/* Begin PBXBuildFile section */\n', '/* Begin PBXBuildFile section */\n\t\tB7140001B7140001B7140001 /* ZipArchive in Frameworks */ = {isa = PBXBuildFile; productRef = B7140003B7140003B7140003 /* ZipArchive */; };\n', 1)
    s = s.replace('\t\tD1A226972AEEEFCC00669D6D /* Frameworks */ = {\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n', '\t\tD1A226972AEEEFCC00669D6D /* Frameworks */ = {\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t\tB7140001B7140001B7140001 /* ZipArchive in Frameworks */,\n', 1)
    s = s.replace('\t\t\tpackageProductDependencies = (\n\t\t\t\tD1ACFDD92AF7D55F0098FF56 /* MvvmFoundation */,\n', '\t\t\tpackageProductDependencies = (\n\t\t\t\tB7140003B7140003B7140003 /* ZipArchive */,\n\t\t\t\tD1ACFDD92AF7D55F0098FF56 /* MvvmFoundation */,\n', 1)
    s = s.replace('\t\t\tpackageReferences = (\n', '\t\t\tpackageReferences = (\n\t\t\t\tB7140002B7140002B7140002 /* XCRemoteSwiftPackageReference "ZipArchive" */,\n', 1)
    s = s.replace('/* Begin XCRemoteSwiftPackageReference section */\n', '''/* Begin XCRemoteSwiftPackageReference section */\n\t\tB7140002B7140002B7140002 /* XCRemoteSwiftPackageReference "ZipArchive" */ = {\n\t\t\tisa = XCRemoteSwiftPackageReference;\n\t\t\trepositoryURL = "https://github.com/ZipArchive/ZipArchive.git";\n\t\t\trequirement = {\n\t\t\t\tkind = upToNextMajorVersion;\n\t\t\t\tminimumVersion = 2.6.0;\n\t\t\t};\n\t\t};\n''', 1)
    s = s.replace('/* Begin XCSwiftPackageProductDependency section */\n', '''/* Begin XCSwiftPackageProductDependency section */\n\t\tB7140003B7140003B7140003 /* ZipArchive */ = {\n\t\t\tisa = XCSwiftPackageProductDependency;\n\t\t\tpackage = B7140002B7140002B7140002 /* XCRemoteSwiftPackageReference "ZipArchive" */;\n\t\t\tproductName = ZipArchive;\n\t\t};\n''', 1)
pbx.write_text(s, encoding='utf-8')
print('patched ZipArchive package')

(ROOT / 'BTMOBILE_0.1.4.md').write_text('''# BTMobile 0.1.4 Test\n\nBase: BTMobile V0.1.3 stable BT baseline (XITRIX/iTorrent v2.2.0-1 derivative).\n\nFrozen from V0.1.3:\n- DHT bootstrap/discovery logic unchanged.\n- Trackerless magnet metadata normalization unchanged.\n- Peer detail/telemetry logic unchanged.\n\nV0.1.4 additions:\n- Native file manager for the app download/Documents root.\n- Create/delete/rename folders and files.\n- Per-task internal download folder selection for torrent add and magnet add.\n- Custom internal save path persistence through fast-resume/reload.\n- Edge playback: incomplete media gets top priority + sequential torrent mode and opens in existing VLC player.\n- ZIP/CBZ extraction via ZipArchive 2.6.0, including password and AES encrypted ZIP support.\n\nVersion: 0.1.4 / build 14\nMinimum iOS: 16.0\n''', encoding='utf-8')

print('BTMobile V0.1.4 patch applied successfully')
