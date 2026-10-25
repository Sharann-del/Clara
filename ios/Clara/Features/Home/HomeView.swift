import SwiftUI

/// Welcome, quick actions, favourites, recent and shared items, workspaces (HomePage.tsx).
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(ToastCenter.self) private var toasts
    @Environment(DialogCenter.self) private var dialogs

    @State private var recent: [SearchResult]?
    @State private var shared: [SharedItem] = []

    var body: some View {
        PageScroll {
            PageHeader(title: greeting, subtitle: "Search with ⌘K or the button, and jump to anything.") {
                Button { model.searchOpen = true } label: { Label("Search", systemImage: "magnifyingglass") }.buttonStyle(.claraSecondary)
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 10)], spacing: 10) {
                QuickAction(symbol: "doc.text", title: "New document", subtitle: "Markdown, with diagrams inline") { Task { await quickCreate(.document) } }
                QuickAction(symbol: "point.3.connected.trianglepath.dotted", title: "New diagram", subtitle: "Draw it or write it as code") { Task { await quickCreate(.diagram) } }
                QuickAction(symbol: "magnifyingglass", title: "Find anything", subtitle: "Every workspace, by title or #tag") { model.searchOpen = true }
            }
            .disabled(model.workspaces?.isEmpty ?? true)
            .padding(.top, 8)

            SectionHeader(title: "Favorites")
            if model.favorites.isEmpty {
                EmptyStateView(symbol: "star", title: "No favorites yet", message: "Star a document or diagram to keep it here.", compact: true)
            } else {
                ItemListView(items: model.favorites.map { ListItem(kind: $0.kind, itemId: $0.id, name: $0.name) }, showStar: false)
            }

            SectionHeader(title: "Recently updated")
            if let recent {
                if recent.isEmpty {
                    EmptyStateView(symbol: "clock", title: "Nothing here yet", message: "Documents and diagrams you and your team edit show up here.", compact: true)
                } else {
                    ItemListView(items: recent.map { ListItem(kind: $0.kind, itemId: $0.id, name: $0.name, tags: $0.tags, updatedAt: $0.updated_at, context: $0.workspace_name) })
                }
            } else {
                SkeletonRows(rows: 4)
            }

            if !shared.isEmpty {
                SectionHeader(title: "Shared with you")
                ItemListView(items: shared.map { ListItem(kind: $0.kind, itemId: $0.id, name: $0.name, tags: $0.tags, updatedAt: $0.updated_at, context: "\($0.workspace_name) · \($0.role)") })
            }

            SectionHeader(title: "Workspaces") {
                Button { Task { await newWorkspace() } } label: { Label("New workspace", systemImage: "plus") }.buttonStyle(.clara(.secondary, small: true))
            }
            if let list = model.workspaces {
                if list.isEmpty {
                    EmptyStateView(symbol: "square.stack.3d.up", title: "You’re not in any workspace", message: "Workspaces hold your documents and diagrams. Create one, or ask a teammate to invite you to theirs.") {
                        Button { Task { await newWorkspace() } } label: { Label("Create a workspace", systemImage: "plus") }.buttonStyle(.claraPrimary)
                    }
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 10)], spacing: 10) {
                        ForEach(list) { w in
                            Button { model.go(.workspace(w.id, folder: nil)) } label: {
                                HStack(spacing: 12) {
                                    Avatar(text: w.name, round: false, size: 28)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(w.name).font(ClaraFont.body(15.5, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
                                        if let r = w.role { Text(r.title).font(ClaraFont.body(13)).foregroundStyle(Theme.muted) }
                                    }
                                    Spacer()
                                    if let n = model.pendingCounts[w.id], n > 0 { PendingBadge(count: n) }
                                }
                                .padding(18)
                                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
                            }
                            .buttonStyle(LiftPress())
                        }
                    }
                }
            } else {
                SkeletonRows(rows: 2, height: 64)
            }
        }
        .claraTopBar("Home")
        .task { await load() }
    }

    private var greeting: String {
        let first = auth.email?.split(separator: "@").first.map(String.init)
        return first.map { "Welcome back, \($0)" } ?? "Welcome back"
    }

    private func load() async {
        async let r: [SearchResult]? = try? api.search("", limit: 12)
        async let s: [SharedItem]? = try? api.sharedWithMe()
        await model.refreshFavorites()
        recent = await r ?? []
        shared = await s ?? []
    }

    private func quickCreate(_ kind: ItemKind) async {
        guard let ws = model.workspaces?.first?.id else { return }
        do {
            if kind == .document { model.open(.document(try await api.createDocument(ws, title: "Untitled", folder: nil).id)) }
            else { model.open(.diagram(try await api.createDiagram(ws, name: "Untitled diagram", folder: nil).id)) }
        } catch { toasts.error(error) }
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

/// Card with an icon tile (`.quick-action`).
struct QuickAction: View {
    let symbol: String
    let title: String
    let subtitle: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: symbol).font(.system(size: 18, weight: .medium)).foregroundStyle(Theme.ink)
                    .frame(width: 42, height: 42).background(Theme.surface3, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(ClaraFont.body(16, weight: .semibold)).foregroundStyle(Theme.ink)
                    Text(subtitle).font(ClaraFont.body(13.5)).foregroundStyle(Theme.muted).lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            .padding(18)
            .frame(maxWidth: .infinity)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
        }
        .buttonStyle(LiftPress())
    }
}

/// Cards lift slightly when touched (`.ws-card:hover`).
struct LiftPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brightness(configuration.isPressed ? 0.03 : 0)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(Theme.fast, value: configuration.isPressed)
    }
}
