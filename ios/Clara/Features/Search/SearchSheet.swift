import SwiftUI

/// Search everything and run commands (CommandPalette.tsx).
struct SearchSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.claraDismiss) private var dismiss

    @State private var query = ""
    @State private var results: [SearchResult] = []
    @State private var searching = false
    @FocusState private var focused: Bool

    private struct Command: Identifiable {
        let id: String
        let label: String
        let symbol: String
        let run: () -> Void
    }

    private var commands: [Command] {
        let all = [
            Command(id: "doc", label: "New document", symbol: "doc.text") { Task { await create(.document) } },
            Command(id: "diagram", label: "New diagram", symbol: "point.3.connected.trianglepath.dotted") { Task { await create(.diagram) } },
            Command(id: "home", label: "Go to home", symbol: "house") { close { model.go(.home) } },
            Command(id: "settings", label: "Settings", symbol: "gearshape") { close { model.go(.settings) } },
            Command(id: "tokens", label: "Access tokens for AI assistants", symbol: "key") { close { model.go(.tokens) } },
            Command(id: "shortcuts", label: "Keyboard shortcuts", symbol: "keyboard") { close { model.go(.shortcuts) } },
            Command(id: "signout", label: "Sign out", symbol: "rectangle.portrait.and.arrow.right") { close { auth.signOut() } },
        ]
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? Array(all.prefix(5)) : all.filter { $0.label.lowercased().contains(q) }
    }

    private var workspaceHits: [Workspace] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return [] }
        return (model.workspaces ?? []).filter { $0.name.lowercased().contains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                TextField("", text: $query, prompt: Text("Search documents, diagrams, #tags, or run a command").foregroundStyle(Theme.muted))
                    .font(ClaraFont.body(17)).foregroundStyle(Theme.ink)
                    .focused($focused)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .submitLabel(.go)
                    .onSubmit { openFirst() }
                if searching { Spinner(size: 16) }
                Button("Close") { dismiss() }.buttonStyle(.clara(.ghost, small: true))
            }
            .padding(.horizontal, 18).frame(height: 60)
            .background(Theme.surface2)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    if !results.isEmpty {
                        group("Documents and diagrams")
                        ForEach(Array(results.enumerated()), id: \.element.id) { i, r in
                            row(symbol: r.kind.symbol, label: r.name.isEmpty ? "Untitled" : r.name, hint: r.workspace_name, tags: r.tags) {
                                close { model.open(r.kind == .document ? .document(r.id) : .diagram(r.id)) }
                            }
                            .fadeUp(i)
                        }
                    }
                    if !workspaceHits.isEmpty {
                        group("Workspaces")
                        ForEach(workspaceHits) { w in row(symbol: "square.stack.3d.up", label: w.name) { close { model.go(.workspace(w.id, folder: nil)) } } }
                    }
                    if !commands.isEmpty {
                        group("Commands")
                        ForEach(commands) { c in row(symbol: c.symbol, label: c.label, action: c.run) }
                    }
                    if !query.isEmpty, results.isEmpty, workspaceHits.isEmpty, commands.isEmpty, !searching {
                        Text("Nothing matches “\(query)”.").font(ClaraFont.body(15)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity).padding(.vertical, 28)
                    }
                }
                .padding(8)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Theme.surface)
        .onAppear { focused = true }
        .task(id: query) {
            // Debounced like the web palette.
            try? await Task.sleep(for: .milliseconds(query.isEmpty ? 0 : 180))
            guard !Task.isCancelled else { return }
            searching = true
            let found = (try? await api.search(query, limit: 20)) ?? []
            if !Task.isCancelled { withAnimation(Theme.med) { results = found } }
            searching = false
        }
    }

    private func group(_ title: String) -> some View {
        Text(title).eyebrowStyle().padding(.horizontal, 10).padding(.top, 14).padding(.bottom, 4)
    }

    private func row(symbol: String, label: String, hint: String? = nil, tags: [String] = [], action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol).frame(width: 22).foregroundStyle(Theme.ink2)
                Text(label).foregroundStyle(Theme.ink).lineLimit(1)
                ForEach(tags.prefix(2), id: \.self) { TagChip(text: $0) }
                Spacer()
                if let hint { Text(hint).font(ClaraFont.body(13)).foregroundStyle(Theme.muted).lineLimit(1) }
            }
            .font(ClaraFont.body(15.5))
            .padding(.horizontal, 10).frame(minHeight: 46)
            .contentShape(Rectangle())
        }
        .buttonStyle(RowPress())
    }

    private func openFirst() {
        if let r = results.first { close { model.open(r.kind == .document ? .document(r.id) : .diagram(r.id)) } }
        else { commands.first?.run() }
    }

    private func close(_ then: @escaping () -> Void) {
        dismiss()
        then()
    }

    private func create(_ kind: ItemKind) async {
        guard let ws = model.currentWorkspaceId else { toasts.error("Create a workspace first"); return }
        do {
            let route: Route = kind == .document ? .document(try await api.createDocument(ws, title: "Untitled", folder: nil).id) : .diagram(try await api.createDiagram(ws, name: "Untitled diagram", folder: nil).id)
            close { model.open(route) }
        } catch { toasts.error(error) }
    }
}
