import SwiftUI

/// Signed-in app (AppShell.tsx): the sidebar sits beside the content on wide screens and slides
/// in as a drawer on iPhone. All Clara chrome: no system split view, bars or sheets.
struct MainShell: View {
    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(ToastCenter.self) private var toasts
    @State private var drawerDrag: CGFloat = 0

    var body: some View {
        @Bindable var model = model
        GeometryReader { geo in
            let wide = geo.size.width >= 900
            let drawerWidth = min(320, geo.size.width * 0.86)
            HStack(spacing: 0) {
                if wide { Sidebar().frame(width: 290) }
                NavigationStack(path: $model.path) {
                    SectionView(section: model.section ?? .home)
                        .navigationDestination(for: Route.self) { RouteView(route: $0).environment(\.isPushed, true) }
                }
                .id(model.section)
            }
            .environment(\.shellIsWide, wide)
            .environment(\.siteOpen) { r in
                switch r {
                case .signIn, .signUp: break
                default: model.open(.site(r))
                }
            }
            .overlay(alignment: .leading) {
                if !wide && model.drawerOpen {
                    Theme.scrim.ignoresSafeArea().onTapGesture { model.toggleDrawer() }.transition(.opacity)
                }
            }
            .overlay(alignment: .leading) {
                if !wide && model.drawerOpen {
                    Sidebar()
                        .frame(width: drawerWidth)
                        .offset(x: min(0, drawerDrag))
                        .gesture(DragGesture().onChanged { drawerDrag = $0.translation.width }.onEnded { v in
                            if v.translation.width < -80 { model.toggleDrawer() }
                            withAnimation(Theme.spring) { drawerDrag = 0 }
                        })
                        .transition(.move(edge: .leading))
                }
            }
            .animation(Theme.spring, value: model.drawerOpen)
        }
        .claraSheet(isPresented: $model.searchOpen) { SearchSheet() }
        .task { await bootstrap() }
        .background(
            // ⌘K opens search, ? opens shortcuts (hardware keyboards on iPad).
            Group {
                Button("") { model.searchOpen = true }.keyboardShortcut("k", modifiers: .command)
                Button("") { model.go(.shortcuts) }.keyboardShortcut("/", modifiers: .shift)
            }
            .opacity(0)
        )
    }

    /// Workspaces, favourites, and first-run setup (HomePage's onboarding) for brand-new accounts.
    private func bootstrap() async {
        await model.refreshWorkspaces()
        await model.refreshFavorites()
        if let list = model.workspaces, list.isEmpty {
            do {
                let r = try await api.onboard()
                await model.refreshWorkspaces()
                if r.created, let ws = r.workspaceId { model.go(.workspace(ws, folder: nil)) }
            } catch let e as APIError where e.isMissingRoute {
                // Older API without /onboarding: the user creates their first workspace from Home.
            } catch {
                toasts.error(error)
            }
        }
        for ws in model.workspaces ?? [] { await model.refreshPending(ws.id) }
    }
}

struct SectionView: View {
    let section: AppSection
    var body: some View {
        switch section {
        case .home: HomeView()
        case .workspace(let id, let folder): WorkspaceView(workspaceId: id, folderId: folder)
        case .pending(let id): PendingChangesView(workspaceId: id)
        case .members(let id): MembersView(workspaceId: id)
        case .settings: SettingsView()
        case .tokens: TokensView()
        case .shortcuts: ShortcutsView()
        case .site(let r): SitePage(route: r)
        }
    }
}

struct RouteView: View {
    let route: Route
    var body: some View {
        switch route {
        case .document(let id): DocumentView(documentId: id)
        case .diagram(let id): DiagramView(diagramId: id)
        case .share(let kind, let id, let name): ShareView(kind: kind, id: id, name: name)
        case .history(let kind, let id): VersionHistoryView(kind: kind, id: id)
        case .workspace(let id, let folder): WorkspaceView(workspaceId: id, folderId: folder)
        case .members(let id): MembersView(workspaceId: id)
        case .pending(let id): PendingChangesView(workspaceId: id)
        case .site(let r): SitePage(route: r)
        }
    }
}

// MARK: - Sidebar

struct Sidebar: View {
    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(DialogCenter.self) private var dialogs
    @Environment(ToastCenter.self) private var toasts

    private var workspace: Workspace? { model.currentWorkspace }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Button { withAnimation(Theme.easeOut) { model.showLanding = true } } label: { ClaraLogo(size: 24) }
                    .buttonStyle(PressScale())
                    .accessibilityLabel("Clara home page")
                    .padding(.horizontal, 6).padding(.top, 8).padding(.bottom, 10)
                workspaceSwitcher
                Button { model.searchOpen = true } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                        Text("Search").frame(maxWidth: .infinity, alignment: .leading)
                        Text("⌘K").font(ClaraFont.mono(11)).padding(.horizontal, 5).padding(.vertical, 1).background(Theme.surface3, in: RoundedRectangle(cornerRadius: 4))
                    }
                    .font(ClaraFont.body(15))
                    .foregroundStyle(Theme.muted)
                    .padding(.horizontal, 10).frame(height: 40)
                    .background(Theme.paper, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
                }
                .buttonStyle(PressScale())
                .padding(.vertical, 4)

                NavRow(symbol: "house", title: "Home", active: model.section == .home) { model.go(.home) }
                NavRow(symbol: "chevron.left.forwardslash.chevron.right", title: "Playground", active: model.section == .site(.playground)) { model.go(.site(.playground)) }
                NavRow(symbol: "book", title: "Docs", active: { if case .site(.docs) = model.section { return true }; return false }()) { model.go(.site(.docs(SiteContent.shared.docs.first?.slug ?? "getting-started"))) }
                if let ws = workspace {
                    NavRow(symbol: "square.stack.3d.up", title: "All items", active: isAllItems(ws.id)) { model.go(.workspace(ws.id, folder: nil)) }
                    if (ws.role ?? .viewer) >= .editor {
                        NavRow(symbol: "arrow.triangle.pull", title: "Pending changes", active: model.section == .pending(ws.id), badge: model.pendingCounts[ws.id] ?? 0) { model.go(.pending(ws.id)) }
                    }
                    NavRow(symbol: "person.2", title: "Members", active: model.section == .members(ws.id)) { model.go(.members(ws.id)) }
                    FolderSection(workspace: ws).padding(.top, 14)
                }
            }
            .padding(.horizontal, 12)
        }
        .scrollBounceBehavior(.basedOnSize)
        .safeAreaInset(edge: .bottom) { footer }
        .background(Theme.surface)
        .task(id: workspace?.id) {
            if let id = workspace?.id { await model.refreshFolders(id) }
        }
    }

    private func isAllItems(_ id: String) -> Bool {
        if case .workspace(let w, let f) = model.section { return w == id && f == nil }
        return false
    }

    private var workspaceSwitcher: some View {
        ClaraMenu("Workspace: \(workspace?.name ?? "none selected"). Switch workspace") {
            for w in model.workspaces ?? [] {
                ClaraMenuEntry.action(w.name, "square.stack.3d.up", checked: w.id == workspace?.id) { model.go(.workspace(w.id, folder: nil)) }
            }
            ClaraMenuEntry.divider
            ClaraMenuEntry.action("New workspace…", "plus") { Task { await newWorkspace() } }
        } label: {
            HStack(spacing: 10) {
                Avatar(text: workspace?.name ?? "C", round: false, size: 24)
                Text(workspace?.name ?? "All workspaces").font(ClaraFont.body(15, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                Spacer()
                Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 10).frame(height: 44)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
        }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 2) {
            NavRow(symbol: "gearshape", title: "Settings", active: model.section == .settings) { model.go(.settings) }
            ClaraMenu("Account") {
                ClaraMenuEntry.action("Profile and settings", "gearshape") { model.go(.settings) }
                ClaraMenuEntry.action("Access tokens", "key") { model.go(.tokens) }
                ClaraMenuEntry.action("Keyboard shortcuts", "keyboard") { model.go(.shortcuts) }
                ClaraMenuEntry.action("Documentation", "book") { model.go(.site(.docs(SiteContent.shared.docs.first?.slug ?? "getting-started"))) }
                ClaraMenuEntry.action("Pricing", "tag") { model.go(.site(.pricing)) }
                ClaraMenuEntry.action("About Clara", "info.circle") { model.go(.site(.about)) }
                ClaraMenuEntry.action("Privacy", "hand.raised") { model.go(.site(.privacy)) }
                ClaraMenuEntry.action("Terms", "doc.plaintext") { model.go(.site(.terms)) }
                ClaraMenuEntry.divider
                ClaraMenuEntry.action("Sign out", "rectangle.portrait.and.arrow.right", destructive: true) { auth.signOut() }
            } label: {
                HStack(spacing: 10) {
                    Avatar(text: auth.email ?? "?", size: 26)
                    Text(auth.email ?? "").font(ClaraFont.body(14, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1).truncationMode(.middle)
                    Spacer()
                }
                .padding(.horizontal, 8).frame(height: 44)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Theme.surface)
    }

    private func newWorkspace() async {
        guard let name = await dialogs.prompt(title: "New workspace", label: "Name", placeholder: "e.g. Platform team", confirmLabel: "Create workspace") else { return }
        do {
            let ws = try await api.createWorkspace(name)
            await model.refreshWorkspaces()
            model.go(.workspace(ws.id, folder: nil))
        } catch { toasts.error(error) }
    }
}

struct NavRow: View {
    let symbol: String
    let title: String
    var active = false
    var badge = 0
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol).font(.system(size: 15)).frame(width: 20)
                Text(title).font(ClaraFont.body(15, weight: active ? .medium : .regular))
                Spacer()
                if badge > 0 { PendingBadge(count: badge) }
            }
            .foregroundStyle(active ? Theme.ink : Theme.ink2)
            .padding(.horizontal, 10).frame(height: 40)
            .background(active ? Theme.surface3 : .clear, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScale())
        .animation(Theme.fast, value: active)
    }
}

/// FOLDERS + the tree (FolderTree.tsx), with create / rename / delete in context menus.
struct FolderSection: View {
    let workspace: Workspace
    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(DialogCenter.self) private var dialogs
    @Environment(ToastCenter.self) private var toasts

    private var folders: [Folder] { model.foldersByWorkspace[workspace.id] ?? [] }
    private var canEdit: Bool { (workspace.role ?? .viewer) >= .editor }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Folders").eyebrowStyle()
                Spacer()
                if canEdit {
                    Button { Task { await create(parent: nil) } } label: { Image(systemName: "plus").font(.system(size: 13, weight: .semibold)) }
                        .foregroundStyle(Theme.muted).accessibilityLabel("New folder")
                }
            }
            .padding(.horizontal, 10).padding(.bottom, 4)
            folderRow(name: "Top level", symbol: "square.stack.3d.up", id: "root", depth: 0)
            ForEach(children(of: nil)) { f in FolderNode(folder: f, depth: 0, section: self) }
            if folders.isEmpty {
                Text("Group documents and diagrams into folders.").font(ClaraFont.body(13.5)).foregroundStyle(Theme.muted).padding(.horizontal, 10).padding(.top, 6)
            }
        }
    }

    func children(of parent: String?) -> [Folder] {
        folders.filter { $0.parent_folder_id == parent }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    func isActive(_ id: String) -> Bool {
        if case .workspace(let w, let f) = model.section { return w == workspace.id && f == id }
        return false
    }

    func folderRow(name: String, symbol: String, id: String, depth: Int) -> some View {
        Button { model.go(.workspace(workspace.id, folder: id)) } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol).font(.system(size: 14)).frame(width: 18)
                Text(name).font(ClaraFont.body(14.5)).lineLimit(1)
                Spacer()
            }
            .foregroundStyle(isActive(id) ? Theme.ink : Theme.ink2)
            .padding(.leading, 10 + CGFloat(depth) * 14).padding(.trailing, 8).frame(height: 34)
            .background(isActive(id) ? Theme.surface3 : .clear, in: RoundedRectangle(cornerRadius: Theme.rSm, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScale())
    }

    func create(parent: String?) async {
        guard let name = await dialogs.prompt(title: parent == nil ? "New folder" : "New subfolder", label: "Folder name", placeholder: "e.g. Payments", confirmLabel: "Create folder") else { return }
        do {
            _ = try await api.createFolder(workspace.id, name: name, parent: parent)
            await model.refreshFolders(workspace.id)
        } catch { toasts.error(error) }
    }

    func rename(_ f: Folder) async {
        guard let name = await dialogs.prompt(title: "Rename folder", label: "Name", initial: f.name) else { return }
        do { try await api.renameFolder(f.id, name); await model.refreshFolders(workspace.id) } catch { toasts.error(error) }
    }

    func delete(_ f: Folder) async {
        guard await dialogs.confirm(title: "Delete “\(f.name)”?", message: "Documents and diagrams inside move to the top level. Subfolders are deleted.", confirmLabel: "Delete folder", danger: true) else { return }
        do {
            try await api.deleteFolder(f.id)
            await model.refreshFolders(workspace.id)
            if isActive(f.id) { model.go(.workspace(workspace.id, folder: nil)) }
        } catch { toasts.error(error) }
    }
}

private struct FolderNode: View {
    let folder: Folder
    let depth: Int
    let section: FolderSection
    @State private var open = true

    var body: some View {
        let kids = section.children(of: folder.id)
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 0) {
                section.folderRow(name: folder.name, symbol: open && !kids.isEmpty ? "folder.fill" : "folder", id: folder.id, depth: depth)
                if !kids.isEmpty {
                    Button { withAnimation(Theme.med) { open.toggle() } } label: {
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).rotationEffect(.degrees(open ? 90 : 0)).frame(width: 28, height: 34)
                    }
                    .foregroundStyle(Theme.muted)
                    .accessibilityLabel(open ? "Collapse" : "Expand")
                }
                if (section.workspace.role ?? .viewer) >= .editor {
                    ClaraMenu("Actions for \(folder.name)") {
                        ClaraMenuEntry.action("New subfolder", "folder.badge.plus") { Task { await section.create(parent: folder.id) } }
                        ClaraMenuEntry.action("Rename", "pencil") { Task { await section.rename(folder) } }
                        ClaraMenuEntry.divider
                        ClaraMenuEntry.action("Delete folder", "trash", destructive: true) { Task { await section.delete(folder) } }
                    } label: {
                        Image(systemName: "ellipsis").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted).frame(width: 30, height: 34)
                    }
                }
            }
            if open {
                ForEach(kids) { k in FolderNode(folder: k, depth: depth + 1, section: section) }
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}
