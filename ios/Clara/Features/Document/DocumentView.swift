import SwiftUI

/// A markdown document (DocumentPage.tsx): read view, or for editors a markdown editor with
/// formatting bar, preview, autosave, live presence and live typing from others.
struct DocumentView: View {
    let documentId: String

    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(ToastCenter.self) private var toasts
    @Environment(DialogCenter.self) private var dialogs

    enum Mode: Hashable { case read, edit, preview }
    enum SaveState { case idle, pending, saving, saved, error }

    @State private var doc: DocumentFull?
    @State private var workspace: Workspace?
    @State private var title = ""
    @State private var content = ""
    @State private var tags: [String] = []
    @State private var mode: Mode = .read
    @State private var saveState: SaveState = .idle
    @State private var loadError: APIError?
    @State private var pending = DocumentPatch()
    @State private var saveTask: Task<Void, Never>?
    @State private var rt: RealtimeConnection?
    @State private var editingTags = false
    @State private var insertingDiagram = false

    private var role: Role? { doc?.role ?? workspace?.role }
    private var canEdit: Bool { (role ?? .viewer) >= .editor }
    private var canDelete: Bool { (workspace?.role ?? .viewer) >= .editor }
    private var hasPending: Bool { pending.title != nil || pending.contentMd != nil || pending.tags != nil }

    var body: some View {
        Group {
            if let loadError {
                if loadError.status == 403 || loadError.status == 404 {
                    NoAccessView(what: "document", notFound: loadError.status == 404)
                } else {
                    PageScroll {
                        EmptyStateView(symbol: "exclamationmark.triangle", title: "This document didn’t load", message: loadError.message) {
                            Button("Try again") { Task { await load() } }.buttonStyle(.claraPrimary)
                        }
                    }
                }
            } else if doc != nil {
                content(for: mode)
            } else {
                PageScroll {
                    RoundedRectangle(cornerRadius: Theme.rSm).fill(Theme.surface2).frame(width: 320, height: 40)
                    SkeletonRows(rows: 6, height: 22)
                }
            }
        }
        .claraTopBar(title.isEmpty ? "Untitled" : title) { toolbar }
        .task { await load() }
        .onDisappear {
            Task { await flush() }
            rt?.close()
        }
        .claraSheet(isPresented: $editingTags) {
            TagEditorSheet(name: title, tags: tags) { next in
                tags = next
                schedule { $0.tags = next }
            }
        }
        .claraSheet(isPresented: $insertingDiagram) {
            if let doc {
                DiagramPickerSheet(workspaceId: doc.workspace_id, title: "Insert a diagram", allowCreate: true) { id in
                    content += (content.hasSuffix("\n") || content.isEmpty ? "" : "\n\n") + SharedJS.shared.embedBlock(id: id) + "\n"
                    contentChanged()
                }
            }
        }
    }

    // MARK: Layout

    @ViewBuilder private func content(for mode: Mode) -> some View {
        switch mode {
        case .edit:
            VStack(spacing: 0) {
                titleField.padding(.horizontal, 20).padding(.top, 8)
                tagRow.padding(.horizontal, 20).padding(.bottom, 8)
                MarkdownEditor(text: $content, onChange: contentChanged, onInsertDiagram: { insertingDiagram = true })
            }
            .background(Theme.paper)
        case .read, .preview:
            PageScroll {
                if mode == .read || !canEdit { Text(title.isEmpty ? "Untitled" : title).pageTitleStyle().font(ClaraFont.display(32, weight: .bold)) } else { titleField }
                tagRow
                if content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    EmptyStateView(symbol: "doc.text", title: "This document is empty", message: canEdit ? "Tap Edit to start writing." : "Nothing has been written here yet.", compact: true)
                } else {
                    MarkdownView(markdown: content)
                }
            }
        }
    }

    private var titleField: some View {
        TextField("", text: $title, prompt: Text("Untitled").foregroundStyle(Theme.muted), axis: .vertical)
            .font(ClaraFont.display(30, weight: .bold)).tracking(-0.8)
            .foregroundStyle(Theme.ink)
            .onChange(of: title) { old, new in
                guard doc != nil, old != new, !new.trimmingCharacters(in: .whitespaces).isEmpty, new != doc?.title || pending.title != nil else { return }
                schedule { $0.title = new }
            }
    }

    private var tagRow: some View {
        FlowLayout(spacing: 6) {
            if !canEdit { TagChip(text: "View only", tone: .neutral) }
            ForEach(tags, id: \.self) { TagChip(text: $0) }
            if canEdit {
                Button { editingTags = true } label: { Label(tags.isEmpty ? "Add tags" : "Edit tags", systemImage: "tag") }.buttonStyle(.clara(.ghost, small: true))
            }
            if let doc, mode == .read { Text("Edited \(timeAgo(doc.updated_at))").font(ClaraFont.body(14)).foregroundStyle(Theme.muted).padding(.top, 6) }
        }
    }

    @ViewBuilder private var toolbar: some View {
        if let doc {
            PresenceStack(users: (rt?.presence ?? []).filter { $0.email != auth.email })
            if let rt, rt.status == .reconnecting || rt.status == .offline {
                Image(systemName: "wifi.slash").foregroundStyle(Theme.muted).accessibilityLabel(rt.status == .offline ? "Offline" : "Reconnecting")
            }
            if mode != .read { SaveStatusView(state: saveState) }
            if canEdit {
                Button {
                    withAnimation(Theme.med) { mode = mode == .read ? .edit : .read }
                    if mode == .read { Task { await flush() } }
                } label: {
                    Label(mode == .read ? "Edit" : "Done", systemImage: mode == .read ? "pencil" : "checkmark")
                }
                .buttonStyle(.clara(mode == .read ? .secondary : .primary, small: true))
            }
            let fav = model.isFavorite(.document, doc.id)
            Button { Task { do { try await model.toggleFavorite(.document, doc.id, name: title) } catch { toasts.error(error) } } } label: {
                Image(systemName: fav ? "star.fill" : "star").foregroundStyle(fav ? Theme.cobalt : Theme.ink2).symbolEffect(.bounce, value: fav).frame(width: 36, height: 40)
            }
            .buttonStyle(PressScale())
            .accessibilityLabel(fav ? "Remove from favorites" : "Add to favorites")
            MoreMenu(label: "Document actions") {
                if canEdit {
                    ClaraMenuEntry.action("Read", "eye", checked: mode == .read) { withAnimation(Theme.med) { mode = .read }; Task { await flush() } }
                    ClaraMenuEntry.action("Edit markdown", "pencil", checked: mode == .edit) { withAnimation(Theme.med) { mode = .edit } }
                    ClaraMenuEntry.action("Preview", "doc.richtext", checked: mode == .preview) { withAnimation(Theme.med) { mode = .preview } }
                    ClaraMenuEntry.divider
                }
                ClaraMenuEntry.action("Share", "square.and.arrow.up") { model.open(.share(.document, doc.id, title)) }
                ClaraMenuEntry.action("Version history", "clock.arrow.circlepath") { model.open(.history(.document, doc.id)) }
                if canEdit { ClaraMenuEntry.action("Edit tags", "tag") { editingTags = true } }
                ClaraMenuEntry.action("Export as markdown", "arrow.down.doc") { exportMarkdown() }
                if let site = ClaraConfig.shared.siteUrl {
                    ClaraMenuEntry.action("Copy link", "link") {
                        UIPasteboard.general.string = "\(site)/documents/\(doc.id)"
                        toasts.success("Link copied. People need access to open it.")
                    }
                }
                if canDelete {
                    ClaraMenuEntry.divider
                    ClaraMenuEntry.action("Delete document", "trash", destructive: true) { Task { await deleteDoc() } }
                }
            }
        }
    }

    // MARK: Data

    private func load() async {
        loadError = nil
        do {
            let d = try await api.document(documentId)
            doc = d
            title = d.title
            content = d.content_md
            tags = d.tags
            workspace = try? await api.workspace(d.workspace_id)
            connect()
        } catch let e as APIError { loadError = e } catch { loadError = APIError(status: 0, message: errorMessage(error)) }
    }

    private func connect() {
        guard rt == nil else { return }
        let conn = RealtimeConnection(.document, documentId, auth: auth)
        conn.onReconnect = {
            guard !hasPending else { return }
            Task { if let d = try? await api.document(documentId) { title = d.title; content = d.content_md; tags = d.tags } }
        }
        conn.start { msg in
            if msg["type"] as? String == "document.updated", pending.contentMd == nil, let md = msg["contentMd"] as? String {
                withAnimation(Theme.fast) { content = md }
            }
        }
        rt = conn
    }

    private func contentChanged() {
        schedule { $0.contentMd = content }
        rt?.send("document.update", ["contentMd": content])
    }

    /// Debounced save, 600 ms after the last change (as on the web).
    private func schedule(_ apply: (inout DocumentPatch) -> Void) {
        apply(&pending)
        saveState = .pending
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await flush()
        }
    }

    private func flush() async {
        guard hasPending else { return }
        let patch = pending
        pending = DocumentPatch()
        saveState = .saving
        do {
            let saved = try await api.updateDocument(documentId, patch)
            doc?.updated_at = saved.updated_at
            doc?.title = saved.title
            saveState = hasPending ? .pending : .saved
        } catch {
            // Put the unsaved fields back so the retry sends them.
            pending = DocumentPatch(title: pending.title ?? patch.title, contentMd: pending.contentMd ?? patch.contentMd, tags: pending.tags ?? patch.tags)
            saveState = .error
            toasts.show("Couldn’t save: \(errorMessage(error))", tone: .error, actionLabel: "Retry") { Task { await flush() } }
        }
    }

    private func exportMarkdown() {
        let name = (title.isEmpty ? "Untitled" : title).replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).md")
        try? content.write(to: url, atomically: true, encoding: .utf8)
        SystemShare.present([url])
    }

    private func deleteDoc() async {
        guard let doc, await dialogs.confirm(title: "Delete “\(title.isEmpty ? "Untitled" : title)”?", message: "This deletes the document and its version history for everyone. It can’t be undone.", confirmLabel: "Delete document", danger: true) else { return }
        do {
            pending = DocumentPatch()
            try await api.deleteDocument(doc.id)
            toasts.success("Deleted “\(title.isEmpty ? "Untitled" : title)”")
            if !model.path.isEmpty { model.path.removeLast() }
            await model.refreshFavorites()
        } catch { toasts.error(error) }
    }
}

struct SaveStatusView: View {
    let state: DocumentView.SaveState
    var body: some View {
        Group {
            switch state {
            case .idle: EmptyView()
            case .pending, .saving: Text("Saving…").foregroundStyle(Theme.muted)
            case .saved: Label("Saved", systemImage: "checkmark").foregroundStyle(Theme.muted)
            case .error: Text("Not saved").foregroundStyle(Theme.red)
            }
        }
        .font(ClaraFont.body(13))
        .labelStyle(.titleOnly)
        .transition(.opacity)
        .animation(Theme.med, value: state)
    }
}

/// Avatars of other people here (Presence.tsx).
struct PresenceStack: View {
    let users: [PresenceUser]
    var body: some View {
        if !users.isEmpty {
            HStack(spacing: 3) {
                ForEach(users.prefix(4)) { u in
                    Avatar(text: u.email ?? u.userId, size: 26, color: Color(hex: u.color)).transition(.scale.combined(with: .opacity))
                }
                if users.count > 4 { Text("+\(users.count - 4)").font(ClaraFont.body(12, weight: .bold)).foregroundStyle(Theme.ink2) }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Also here: \(users.map { $0.email ?? "someone" }.joined(separator: ", "))")
            .animation(Theme.spring, value: users)
        }
    }
}

struct NoAccessView: View {
    let what: String
    var notFound = false
    @Environment(AppModel.self) private var model
    var body: some View {
        PageScroll {
            VStack(spacing: 14) {
                Text(notFound ? "404" : "403").font(ClaraFont.mono(14)).foregroundStyle(Theme.red).padding(.horizontal, 10).padding(.vertical, 4).background(Theme.redSoft, in: RoundedRectangle(cornerRadius: Theme.rSm))
                Text(notFound ? "This \(what) doesn’t exist" : "You don’t have access to this \(what)").font(ClaraFont.display(26, weight: .bold)).multilineTextAlignment(.center).foregroundStyle(Theme.ink)
                Text(notFound ? "It may have been deleted, or the link is wrong." : "Ask someone in its workspace to share it with you.").font(ClaraFont.body(16)).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                Button("Go home") { model.go(.home) }.buttonStyle(.claraPrimary).padding(.top, 8)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 60)
        }
    }
}

extension URL: @retroactive Identifiable { public var id: String { absoluteString } }

