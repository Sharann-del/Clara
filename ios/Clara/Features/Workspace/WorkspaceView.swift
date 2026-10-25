import SwiftUI

/// A workspace's documents and diagrams (WorkspacePage.tsx). `folderId`: nil = all items,
/// "root" = top level only, otherwise one folder (its subfolders lead the list).
struct WorkspaceView: View {
    let workspaceId: String
    let folderId: String?

    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(ToastCenter.self) private var toasts
    @Environment(DialogCenter.self) private var dialogs

    enum Kind: Hashable { case all, document, diagram }
    enum Sort: Hashable { case updated, name }

    @State private var workspace: Workspace?
    @State private var documents: [DocumentSummary]?
    @State private var diagrams: [DiagramSummary]?
    @State private var query = ""
    @State private var kind: Kind = .all
    @State private var sort: Sort = .updated
    @State private var activeTags: [String] = []
    @State private var loadError: String?
    @State private var tagging: ListItem?
    @State private var moving: ListItem?

    private var folders: [Folder] { model.foldersByWorkspace[workspaceId] ?? [] }
    private var role: Role { workspace?.role ?? .viewer }
    private var canEdit: Bool { role >= .editor }
    /// nil = every folder; .some(nil) = top level; .some(id) = that folder.
    private var folderFilter: String?? { folderId == nil ? nil : (folderId == "root" ? .some(nil) : .some(folderId)) }
    private var currentFolder: Folder? { folders.first { $0.id == folderId } }
    private var filtering: Bool { !query.isEmpty || !activeTags.isEmpty || kind != .all }

    var body: some View {
        PageScroll {
            PageHeader(title: heading, subtitle: workspace.map { "\($0.name) · you’re \(role >= .admin ? "an" : "a") \(role.rawValue)" }) {
                if canEdit {
                    Button { Task { await create(.diagram) } } label: { Label("New diagram", systemImage: "point.3.connected.trianglepath.dotted") }.buttonStyle(.claraSecondary)
                    Button { Task { await create(.document) } } label: { Label("New document", systemImage: "plus") }.buttonStyle(.claraPrimary)
                }
            }
            .padding(.bottom, 8)

            filters
            if !allTags.isEmpty { tagFilter }

            if let loadError {
                EmptyStateView(symbol: "exclamationmark.triangle", title: "This workspace didn’t load", message: loadError) {
                    Button("Try again") { Task { await load() } }.buttonStyle(.claraPrimary)
                }
            } else if let items {
                if items.isEmpty {
                    if filtering {
                        EmptyStateView(symbol: "magnifyingglass", title: "Nothing matches these filters", message: "Try another name, or remove a tag.") {
                            Button("Clear filters") { withAnimation(Theme.med) { query = ""; kind = .all; activeTags = [] } }.buttonStyle(.claraSecondary)
                        }
                    } else {
                        EmptyStateView(symbol: folderId != nil ? "folder" : "square.stack.3d.up", title: folderId != nil ? "This folder is empty" : "Nothing here yet",
                                       message: canEdit ? "Start with a document for the reasoning or a diagram for the picture. Both can live side by side." : "Nobody has added anything yet.") {
                            if canEdit {
                                Button { Task { await create(.document) } } label: { Label("New document", systemImage: "doc.text") }.buttonStyle(.claraPrimary)
                                Button { Task { await create(.diagram) } } label: { Label("New diagram", systemImage: "point.3.connected.trianglepath.dotted") }.buttonStyle(.claraSecondary)
                            }
                        }
                    }
                } else {
                    ItemListView(items: items, onTagTap: toggleTag, onOpenFolder: { model.open(.workspace(workspaceId, folder: $0)) }, menu: { AnyView(rowMenu($0)) })
                        .animation(Theme.easeOut, value: items)
                }
            } else {
                SkeletonRows(rows: 5, height: 52)
            }
        }
        .claraTopBar(workspace?.name ?? "Workspace") { workspaceMenu }
        .task { await load() }
        .claraSheet(item: $tagging) { item in
            TagEditorSheet(name: item.name, tags: item.tags, suggestions: allTags.map(\.0)) { tags in Task { await saveTags(item, tags) } }
        }
        .claraSheet(item: $moving) { item in
            MoveSheet(title: "Move “\(item.name)”", folders: folders, current: currentLocation(of: item), exclude: item.kind == .folder ? item.itemId : nil) { target in
                Task { await move(item, to: target) }
            }
        }
    }

    // MARK: Derived

    private var heading: String {
        guard let folderId else { return "All items" }
        return folderId == "root" ? "Top level" : currentFolder?.name ?? "Folder"
    }

    private var allTags: [(String, Int)] {
        var counts: [String: Int] = [:]
        for t in (documents ?? []).flatMap(\.tags) + (diagrams ?? []).flatMap(\.tags) { counts[t, default: 0] += 1 }
        return counts.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }.map { ($0.key, $0.value) }
    }

    private var items: [ListItem]? {
        guard let documents, let diagrams else { return nil }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let inFolder: (String?) -> Bool = { f in folderFilter == nil || f == folderFilter! }
        var list: [ListItem] = []
        if kind != .diagram { list += documents.filter { inFolder($0.folder_id) }.map { ListItem(kind: .document, itemId: $0.id, name: $0.title, tags: $0.tags, updatedAt: $0.updated_at) } }
        if kind != .document { list += diagrams.filter { inFolder($0.folder_id) }.map { ListItem(kind: .diagram, itemId: $0.id, name: $0.name, tags: $0.tags, updatedAt: $0.updated_at) } }
        if !activeTags.isEmpty { list = list.filter { i in activeTags.allSatisfy(i.tags.contains) } }
        if !q.isEmpty {
            let tq = q.hasPrefix("#") ? String(q.dropFirst()) : q
            list = list.filter { $0.name.lowercased().contains(q) || $0.tags.contains { $0.contains(tq) } }
        }
        list.sort { sort == .name ? $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending : ($0.updatedAt ?? "") > ($1.updatedAt ?? "") }
        var sub: [ListItem] = []
        if let ff = folderFilter, !filtering {
            sub = folders.filter { $0.parent_folder_id == ff }.sorted { $0.name < $1.name }.map { ListItem(kind: .folder, itemId: $0.id, name: $0.name) }
        }
        return sub + list
    }

    // MARK: Pieces

    private var filters: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                searchField
                Segmented(options: [(Kind.all, "All"), (.document, "Docs"), (.diagram, "Diagrams")], selection: $kind)
                sortMenu
            }
            VStack(alignment: .leading, spacing: 8) {
                searchField
                HStack { Segmented(options: [(Kind.all, "All"), (.document, "Docs"), (.diagram, "Diagrams")], selection: $kind); Spacer(); sortMenu }
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
            TextField("", text: $query, prompt: Text("Filter by name or #tag").foregroundStyle(Theme.muted))
                .font(ClaraFont.body(15)).foregroundStyle(Theme.ink)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.muted) } }
        }
        .padding(.horizontal, 12).frame(height: 40)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
    }

    private var sortMenu: some View {
        ClaraSelect(label: "Sort", selection: $sort, options: [(Sort.updated, "Recently updated"), (.name, "Name")], height: 40)
    }

    private var tagFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Image(systemName: "tag").font(.system(size: 13)).foregroundStyle(Theme.muted)
                ForEach(allTags, id: \.0) { t, n in
                    Button { toggleTag(t) } label: { TagChip(text: t, tone: activeTags.contains(t) ? .accent : .neutral, count: n) }.buttonStyle(PressScale())
                }
                if !activeTags.isEmpty {
                    Button("Clear") { withAnimation(Theme.med) { activeTags = [] } }.buttonStyle(.clara(.ghost, small: true))
                }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private var workspaceMenu: some View {
        MoreMenu(label: "Workspace actions") {
            if canEdit { ClaraMenuEntry.action("New folder", "folder.badge.plus") { Task { await newFolder(parent: folderFilter ?? nil) } } }
            ClaraMenuEntry.action("Members", "person.2") { model.open(.members(workspaceId)) }
            if canEdit {
                let n = model.pendingCounts[workspaceId] ?? 0
                ClaraMenuEntry.action("Pending changes\(n > 0 ? " (\(n))" : "")", "arrow.triangle.pull") { model.open(.pending(workspaceId)) }
            }
            if role >= .admin {
                ClaraMenuEntry.divider
                ClaraMenuEntry.action("Rename workspace", "pencil") { Task { await renameWorkspace() } }
            }
            if role == .owner {
                ClaraMenuEntry.action("Delete workspace", "trash", destructive: true) { Task { await deleteWorkspace() } }
            }
        }
    }

    private func rowMenu(_ it: ListItem) -> some View {
        MoreMenu(label: "Actions for \(it.name)") {
            if it.kind == .folder {
                ClaraMenuEntry.action("Open", "folder") { model.open(.workspace(workspaceId, folder: it.itemId)) }
                if canEdit {
                    ClaraMenuEntry.action("New subfolder", "folder.badge.plus") { Task { await newFolder(parent: it.itemId) } }
                    ClaraMenuEntry.action("Rename", "pencil") { Task { await renameItem(it) } }
                    ClaraMenuEntry.action("Move to…", "arrow.right.doc.on.clipboard") { moving = it }
                    ClaraMenuEntry.divider
                    ClaraMenuEntry.action("Delete folder", "trash", destructive: true) { Task { await deleteItem(it) } }
                }
            } else {
                ClaraMenuEntry.action("Open", "arrow.up.right") { model.open(it.kind == .document ? .document(it.itemId) : .diagram(it.itemId)) }
                let fav = model.isFavorite(it.kind, it.itemId)
                ClaraMenuEntry.action(fav ? "Remove from favorites" : "Add to favorites", fav ? "star.slash" : "star") {
                    Task { do { try await model.toggleFavorite(it.kind, it.itemId, name: it.name) } catch { toasts.error(error) } }
                }
                if canEdit {
                    ClaraMenuEntry.action("Rename", "pencil") { Task { await renameItem(it) } }
                    ClaraMenuEntry.action("Edit tags", "tag") { tagging = it }
                    ClaraMenuEntry.action("Move to…", "arrow.right.doc.on.clipboard") { moving = it }
                    ClaraMenuEntry.action("Share", "square.and.arrow.up") { model.open(.share(it.kind, it.itemId, it.name)) }
                    ClaraMenuEntry.divider
                    ClaraMenuEntry.action("Delete \(it.kind.rawValue)", "trash", destructive: true) { Task { await deleteItem(it) } }
                }
            }
        }
    }

    // MARK: Actions

    private func load() async {
        loadError = nil
        do {
            async let w = api.workspace(workspaceId)
            async let d = api.documents(workspaceId)
            async let g = api.diagrams(workspaceId)
            let (ws, docs, dgs) = try await (w, d, g)
            withAnimation(Theme.easeOut) {
                workspace = ws
                documents = docs
                diagrams = dgs
            }
            await model.refreshFolders(workspaceId)
            await model.refreshPending(workspaceId)
        } catch { loadError = errorMessage(error) }
    }

    private func toggleTag(_ t: String) {
        withAnimation(Theme.med) {
            if activeTags.contains(t) { activeTags.removeAll { $0 == t } } else { activeTags.append(t) }
        }
    }

    private func create(_ k: ItemKind) async {
        let target = folderFilter ?? nil
        do {
            if k == .document { model.open(.document(try await api.createDocument(workspaceId, title: "Untitled", folder: target).id)) }
            else { model.open(.diagram(try await api.createDiagram(workspaceId, name: "Untitled diagram", folder: target).id)) }
        } catch { toasts.error(error) }
    }

    private func newFolder(parent: String?) async {
        let parentName = folders.first { $0.id == parent }?.name
        guard let name = await dialogs.prompt(title: parentName.map { "New folder in “\($0)”" } ?? "New folder", label: "Folder name", placeholder: "e.g. Payments", confirmLabel: "Create folder") else { return }
        do {
            _ = try await api.createFolder(workspaceId, name: name, parent: parent)
            await model.refreshFolders(workspaceId)
            toasts.success("Created “\(name)”")
        } catch { toasts.error(error) }
    }

    private func renameItem(_ it: ListItem) async {
        guard let name = await dialogs.prompt(title: "Rename", label: "Name", initial: it.name), name != it.name else { return }
        do {
            switch it.kind {
            case .folder: try await api.renameFolder(it.itemId, name); await model.refreshFolders(workspaceId)
            case .document: _ = try await api.updateDocument(it.itemId, DocumentPatch(title: name))
            case .diagram: try await api.updateDiagram(it.itemId, name: name)
            }
            await load()
        } catch { toasts.error(error) }
    }

    private func saveTags(_ it: ListItem, _ tags: [String]) async {
        do {
            if it.kind == .document { _ = try await api.updateDocument(it.itemId, DocumentPatch(tags: tags)) } else { try await api.updateDiagram(it.itemId, tags: tags) }
            await load()
        } catch { toasts.error(error) }
    }

    private func currentLocation(of it: ListItem) -> String? {
        switch it.kind {
        case .folder: return folders.first { $0.id == it.itemId }?.parent_folder_id
        case .document: return documents?.first { $0.id == it.itemId }?.folder_id
        case .diagram: return diagrams?.first { $0.id == it.itemId }?.folder_id
        }
    }

    private func move(_ it: ListItem, to target: String?) async {
        do {
            switch it.kind {
            case .folder: try await api.moveFolder(it.itemId, parent: target); await model.refreshFolders(workspaceId)
            case .document: try await api.moveDocument(it.itemId, folder: target)
            case .diagram: try await api.moveDiagram(it.itemId, folder: target)
            }
            toasts.success("Moved “\(it.name)” to \(folders.first { $0.id == target }?.name ?? "the top level")")
            await load()
        } catch { toasts.error(error) }
    }

    private func deleteItem(_ it: ListItem) async {
        let message = it.kind == .folder
            ? "Documents and diagrams inside move to the top level. Subfolders are deleted."
            : "This deletes the \(it.kind.rawValue) and its version history for everyone. It can’t be undone."
        guard await dialogs.confirm(title: "Delete “\(it.name)”?", message: message, confirmLabel: "Delete \(it.kind.rawValue)", danger: true) else { return }
        do {
            switch it.kind {
            case .folder: try await api.deleteFolder(it.itemId); await model.refreshFolders(workspaceId)
            case .document: try await api.deleteDocument(it.itemId)
            case .diagram: try await api.deleteDiagram(it.itemId)
            }
            toasts.success("Deleted “\(it.name)”")
            await load()
            await model.refreshFavorites()
        } catch { toasts.error(error) }
    }

    private func renameWorkspace() async {
        guard let ws = workspace, let name = await dialogs.prompt(title: "Rename workspace", label: "Name", initial: ws.name) else { return }
        do { workspace = try await api.renameWorkspace(ws.id, name); await model.refreshWorkspaces() } catch { toasts.error(error) }
    }

    private func deleteWorkspace() async {
        guard let ws = workspace,
              await dialogs.confirm(title: "Delete “\(ws.name)”?", message: "Every document, diagram and folder in it is deleted for all members. This can’t be undone.", confirmLabel: "Delete workspace", danger: true)
        else { return }
        do {
            try await api.deleteWorkspace(ws.id)
            await model.refreshWorkspaces()
            toasts.success("Deleted “\(ws.name)”")
            model.go(.home)
        } catch { toasts.error(error) }
    }
}

// MARK: - Sheets

/// Add and remove tags, with suggestions (TagEditor.tsx).
struct TagEditorSheet: View {
    let name: String
    @State var tags: [String]
    var suggestions: [String] = []
    let onSave: ([String]) -> Void
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: "Tags for “\(name)”", confirm: "Save") { add(); onSave(tags) }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    FlowLayout(spacing: 6) {
                        ForEach(tags, id: \.self) { t in
                            Button { withAnimation(Theme.med) { tags.removeAll { $0 == t } } } label: {
                                HStack(spacing: 4) { Text(t); Image(systemName: "xmark").font(.system(size: 9, weight: .bold)) }
                            }
                            .buttonStyle(TagButtonStyle(tone: .accent))
                            .transition(.scale.combined(with: .opacity))
                        }
                        if tags.isEmpty { Text("No tags yet").font(ClaraFont.body(14)).foregroundStyle(Theme.muted) }
                    }
                    ClaraTextField(label: "Add a tag", placeholder: "e.g. payments", text: $draft, onSubmit: add)
                    let rest = suggestions.filter { !tags.contains($0) && (draft.isEmpty || $0.contains(draft.lowercased())) }
                    if !rest.isEmpty {
                        Text("Suggestions").eyebrowStyle()
                        FlowLayout(spacing: 6) {
                            ForEach(rest.prefix(20), id: \.self) { s in
                                Button { withAnimation(Theme.med) { tags.append(s) } } label: { Text(s) }.buttonStyle(TagButtonStyle(tone: .neutral))
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
    }

    private func add() {
        let t = draft.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: "#", with: "").replacingOccurrences(of: " ", with: "-")
        guard !t.isEmpty, !tags.contains(t) else { draft = ""; return }
        withAnimation(Theme.med) { tags.append(String(t.prefix(40))) }
        draft = ""
    }
}

struct TagButtonStyle: ButtonStyle {
    var tone: TagTone
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(ClaraFont.body(13.5, weight: .medium))
            .padding(.horizontal, 10).padding(.vertical, 5)
            .foregroundStyle(tone == .accent ? Theme.cobaltInk : Theme.ink2)
            .background(tone == .accent ? Theme.cobaltSoft : Theme.surface3, in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .animation(Theme.fast, value: configuration.isPressed)
    }
}

/// Pick a destination folder (MoveDialog.tsx).
struct MoveSheet: View {
    let title: String
    let folders: [Folder]
    let current: String?
    var exclude: String?
    let onMove: (String?) -> Void
    @State private var target: String??

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: title, confirm: "Move", confirmDisabled: target == nil || target! == current) { if let t = target { onMove(t) } }
            ScrollView {
                VStack(spacing: 2) {
                    row(name: "Top level", id: nil, depth: 0)
                    ForEach(flattened(parent: nil, depth: 0), id: \.0.id) { f, depth in row(name: f.name, id: f.id, depth: depth) }
                }
                .padding(12)
            }
        }
    }

    /// Folders depth-first, skipping the folder being moved and everything under it.
    private func flattened(parent: String?, depth: Int) -> [(Folder, Int)] {
        folders.filter { $0.parent_folder_id == parent && $0.id != exclude }.sorted { $0.name < $1.name }.flatMap { [($0, depth + 1)] + flattened(parent: $0.id, depth: depth + 1) }
    }

    private func row(name: String, id: String?, depth: Int) -> some View {
        let selected = target.map { $0 == id } ?? false
        return Button { withAnimation(Theme.fast) { target = .some(id) } } label: {
            HStack(spacing: 10) {
                Image(systemName: id == nil ? "square.stack.3d.up" : "folder").foregroundStyle(Theme.ink2)
                Text(name).foregroundStyle(Theme.ink)
                if id == current { Text("current").font(ClaraFont.body(12)).foregroundStyle(Theme.muted) }
                Spacer()
                if selected { Image(systemName: "checkmark").foregroundStyle(Theme.cobalt) }
            }
            .font(ClaraFont.body(15.5))
            .padding(.leading, 12 + CGFloat(depth) * 18).padding(.trailing, 12).frame(height: 46)
            .background(selected ? Theme.surface3 : Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
        }
        .buttonStyle(PressScale())
    }
}

/// Wrapping row layout for tags.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += size.width + spacing
            rowH = max(rowH, size.height)
        }
        return CGSize(width: width, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowH = max(rowH, size.height)
        }
    }
}
