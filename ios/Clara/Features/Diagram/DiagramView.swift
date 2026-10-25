import SwiftUI

/// A diagram (DiagramPage.tsx): Canvas and Code tabs, the states bar, the editor with its tool
/// palette and inspector, present mode, export, share, history and C4 drill-down.
struct DiagramView: View {
    let diagramId: String

    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(ToastCenter.self) private var toasts
    @Environment(DialogCenter.self) private var dialogs
    @Environment(\.horizontalSizeClass) private var hSize

    enum Tab: Hashable { case canvas, code }

    @State private var store: DiagramStore?
    @State private var tab: Tab = .canvas
    @State private var tool: CanvasTool = .select
    @State private var selection: Set<String> = []
    @State private var editRequest: String?
    @State private var presenting = false
    @State private var editingTags = false

    var body: some View {
        Group {
            if let store {
                if let e = store.loadError {
                    if e.status == 403 || e.status == 404 { NoAccessView(what: "diagram", notFound: e.status == 404) }
                    else {
                        PageScroll {
                            EmptyStateView(symbol: "exclamationmark.triangle", title: "This diagram didn’t load", message: e.message) {
                                Button("Try again") { Task { await store.load() } }.buttonStyle(.claraPrimary)
                            }
                        }
                    }
                } else if store.diagram != nil {
                    loaded(store)
                } else {
                    ZStack { Theme.canvas; Spinner() }
                }
            } else {
                Theme.canvas
            }
        }
        .claraTopBar(store?.diagram?.name ?? "Diagram") { if let store, store.diagram != nil { toolbar(store) } }
        .task {
            if store == nil {
                let s = DiagramStore(diagramId: diagramId, api: api, auth: auth)
                s.notify = { [toasts] message, isError, undo in
                    if isError { toasts.error(message) } else { toasts.show(message, actionLabel: undo == nil ? nil : "Undo", action: undo) }
                }
                store = s
                await s.load()
            }
        }
        .onDisappear { store?.disconnect() }
    }

    @ViewBuilder private func loaded(_ store: DiagramStore) -> some View {
        let editable = store.canEdit
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Segmented(options: [(Tab.canvas, "Canvas"), (.code, "Code")], selection: $tab)
                if store.breadcrumb.count > 1 { breadcrumb(store) }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .background(Theme.surface)

            StatesBar(store: store, editable: editable) { presenting = true }

            switch tab {
            case .canvas:
                canvas(store, editable: editable)
                    .transition(.opacity)
            case .code:
                DiagramCodeTab(store: store, editable: editable) { withAnimation(Theme.med) { tab = .canvas } }
                    .transition(.opacity)
            }
        }
        .animation(Theme.med, value: tab)
        .fullScreenCover(isPresented: $presenting) {
            PresentModeView(base: store.elements, states: store.states, startIndex: store.activeStateId.flatMap { id in store.states.firstIndex { $0.id == id }.map { $0 + 1 } } ?? 0)
        }
        .claraSheet(isPresented: $editingTags) {
            TagEditorSheet(name: store.diagram?.name ?? "", tags: store.diagram?.tags ?? []) { tags in
                Task { do { try await store.setTags(tags) } catch { toasts.error(error) } }
            }
        }
        .onChange(of: store.activeStateId) { _, _ in selection = [] }
    }

    @ViewBuilder private func canvas(_ store: DiagramStore, editable: Bool) -> some View {
        let regular = hSize == .regular
        let showInspector = editable && !selection.isEmpty
        HStack(spacing: 0) {
            if editable && regular {
                ToolPalette(tool: $tool, vertical: true, hasSelection: !selection.isEmpty, onDuplicate: { selection = store.duplicate(selection) }, onDelete: deleteSelection)
                    .frame(width: 56)
            }
            ZStack(alignment: .bottom) {
                DiagramEditor(store: store, tool: $tool, selection: $selection, editable: editable, editRequest: $editRequest) { drill($0) }
                if editable && !regular {
                    ToolPalette(tool: $tool, vertical: false, hasSelection: !selection.isEmpty, onDuplicate: { selection = store.duplicate(selection) }, onDelete: deleteSelection)
                        .padding(.bottom, showInspector ? 8 : 64)
                        .animation(Theme.spring, value: showInspector)
                }
            }
            if showInspector && regular {
                inspector(store)
                    .frame(width: 290)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(Theme.spring, value: showInspector)
        .claraSheet(isPresented: Binding(get: { showInspector && !regular }, set: { if !$0 { selection = [] } }), modal: false, compactHeight: 340) {
            inspector(store)
        }
    }

    private func inspector(_ store: DiagramStore) -> some View {
        DiagramInspector(store: store, selection: $selection, onEditLabel: { editRequest = $0.id }, onDrillDown: drill, onClose: { selection = [] })
    }

    private func breadcrumb(_ store: DiagramStore) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Array(store.breadcrumb.enumerated()), id: \.element.id) { i, c in
                    if i > 0 { Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.muted) }
                    if c.id == diagramId {
                        Text(c.name).font(ClaraFont.body(14, weight: .semibold)).foregroundStyle(Theme.ink)
                    } else {
                        Button(c.name) { replaceWith(c.id) }.font(ClaraFont.body(14)).foregroundStyle(Theme.cobalt)
                    }
                }
            }
        }
        .accessibilityLabel("Diagram level")
    }

    private func drill(_ id: String) {
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        model.open(.diagram(id))
    }

    /// Jumping up the drill-down chain pops back to that level when it's on the stack.
    private func replaceWith(_ id: String) {
        if let i = model.path.lastIndex(of: .diagram(id)) { model.path.removeSubrange((i + 1)...) } else { model.open(.diagram(id)) }
    }

    private func deleteSelection() {
        guard let store, !selection.isEmpty else { return }
        store.delete(selection)
        selection = []
    }

    @ViewBuilder private func toolbar(_ store: DiagramStore) -> some View {
        PresenceStack(users: (store.rt?.presence ?? []).filter { $0.email != auth.email })
        if let rt = store.rt, rt.status == .reconnecting || rt.status == .offline {
            Image(systemName: "wifi.slash").foregroundStyle(Theme.muted).accessibilityLabel("Live updates paused; edits are sent when the connection is back")
        }
        let fav = model.isFavorite(.diagram, diagramId)
        Button { Task { do { try await model.toggleFavorite(.diagram, diagramId, name: store.diagram?.name ?? "") } catch { toasts.error(error) } } } label: {
            Image(systemName: fav ? "star.fill" : "star").foregroundStyle(fav ? Theme.cobalt : Theme.ink2).symbolEffect(.bounce, value: fav).frame(width: 36, height: 40)
        }
        .buttonStyle(PressScale())
        .accessibilityLabel(fav ? "Remove from favorites" : "Add to favorites")
        ClaraMenu("Export") {
            ClaraMenuEntry.header("Export")
            for f in DiagramExport.Format.allCases {
                ClaraMenuEntry.action(f.label) { export(store, f) }
            }
        } label: {
            Image(systemName: "square.and.arrow.down").font(.system(size: 16)).foregroundStyle(Theme.ink2).frame(width: 36, height: 40)
        }
        MoreMenu(label: "Diagram actions") {
            ClaraMenuEntry.action("Share", "square.and.arrow.up") { model.open(.share(.diagram, diagramId, store.diagram?.name ?? "")) }
            ClaraMenuEntry.action("Present", "play", disabled: store.states.isEmpty) { presenting = true }
            ClaraMenuEntry.action("Version history", "clock.arrow.circlepath") { model.open(.history(.diagram, diagramId)) }
            if store.canEdit {
                ClaraMenuEntry.action("Rename", "pencil") { Task { await rename(store) } }
                ClaraMenuEntry.action("Edit tags", "tag") { editingTags = true }
            }
            if let site = ClaraConfig.shared.siteUrl {
                ClaraMenuEntry.action("Copy link", "link") {
                    UIPasteboard.general.string = "\(site)/diagrams/\(diagramId)"
                    toasts.success("Link copied. People need access to open it.")
                }
            }
            if store.canDelete {
                ClaraMenuEntry.divider
                ClaraMenuEntry.action("Delete diagram", "trash", destructive: true) { Task { await deleteDiagram(store) } }
            }
        }
    }

    private func export(_ store: DiagramStore, _ format: DiagramExport.Format) {
        let name = "\(store.diagram?.name ?? "diagram")\(store.activeState.map { " - \($0.name)" } ?? "")"
        do { SystemShare.present([try DiagramExport.file(store.display, name: name, format: format)]) }
        catch { toasts.error("Export failed: \(errorMessage(error))") }
    }

    private func rename(_ store: DiagramStore) async {
        guard let current = store.diagram?.name, let name = await dialogs.prompt(title: "Rename diagram", label: "Name", initial: current, confirmLabel: "Rename"), name != current else { return }
        do { try await store.rename(name) } catch { toasts.error(error) }
    }

    private func deleteDiagram(_ store: DiagramStore) async {
        guard let d = store.diagram, await dialogs.confirm(title: "Delete “\(d.name)”?", message: "This deletes the diagram, its states and version history for everyone. Shapes elsewhere that link to it lose their link.", confirmLabel: "Delete diagram", danger: true) else { return }
        do {
            try await api.deleteDiagram(d.id)
            toasts.success("Deleted “\(d.name)”")
            if !model.path.isEmpty { model.path.removeLast() }
            await model.refreshFavorites()
        } catch { toasts.error(error) }
    }
}
