import SwiftUI

/// Properties of the selected element (Inspector in DiagramPage.tsx): label, colour, layer,
/// drill-down link, visibility in the current state, duplicate and delete.
struct DiagramInspector: View {
    @Bindable var store: DiagramStore
    @Binding var selection: Set<String>
    var onEditLabel: (DiagramElement) -> Void
    var onDrillDown: (String) -> Void
    var onClose: () -> Void

    @Environment(DialogCenter.self) private var dialogs
    @Environment(ToastCenter.self) private var toasts
    @Environment(AppModel.self) private var model
    @State private var pickingLink = false
    @State private var linkNames: [String: String] = [:]
    @Environment(APIClient.self) private var api

    private var resolved: [Resolved] { store.display.filter { selection.contains($0.id) } }
    private var selected: Resolved? { resolved.count == 1 ? resolved.first : nil }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Text(selected.map { kindName($0.element) } ?? "\(resolved.count) selected").font(ClaraFont.display(17, weight: .semibold)).foregroundStyle(Theme.ink)
                    Spacer()
                    Button(action: onClose) { Image(systemName: "xmark").foregroundStyle(Theme.ink2) }.accessibilityLabel("Close inspector")
                }

                if let r = selected {
                    let el = r.element
                    if store.activeState != nil, r.hidden {
                        section("In “\(store.activeState!.name)”") {
                            Text("Hidden in this state.").font(ClaraFont.body(14)).foregroundStyle(Theme.muted)
                            Button { store.unhide(el.id) } label: { Label("Show in this state", systemImage: "eye") }.buttonStyle(.clara(.secondary, small: true))
                        }
                    }

                    section("Label") {
                        Button { onEditLabel(el) } label: {
                            HStack {
                                Text(el.text.isEmpty ? "Add a label" : el.text).foregroundStyle(el.text.isEmpty ? Theme.muted : Theme.ink).lineLimit(3).multilineTextAlignment(.leading)
                                Spacer()
                                Image(systemName: "pencil").foregroundStyle(Theme.muted)
                            }
                            .font(ClaraFont.body(15))
                            .padding(12)
                            .background(Theme.surface3, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
                        }
                        .buttonStyle(PressScale())
                    }

                    if el.isShape {
                        section("Colour") {
                            HStack(spacing: 8) {
                                ForEach(shapeSwatches, id: \.name) { s in
                                    let on = (el.style.str("stroke") ?? "").lowercased() == s.stroke
                                    Button {
                                        store.update(el.id, style: ["fill": .string(s.fill), "stroke": .string(s.stroke)])
                                        UISelectionFeedbackGenerator().selectionChanged()
                                    } label: {
                                        Circle().fill(DiagramPalette.dark.shape(fill: s.fill, stroke: s.stroke).stroke)
                                            .frame(width: 30, height: 30)
                                            .overlay(Circle().strokeBorder(Theme.surface, lineWidth: on ? 3 : 0))
                                            .overlay(Circle().strokeBorder(Theme.ink, lineWidth: on ? 2 : 0).padding(-2))
                                    }
                                    .buttonStyle(PressScale())
                                    .accessibilityLabel(s.name)
                                    .accessibilityAddTraits(on ? .isSelected : [])
                                }
                            }
                        }
                    }

                    if el.type == .text {
                        section("Size") {
                            ClaraStepper(value: el.style.num("fontSize", 14), range: 10...48, step: 2, format: { "\(Int($0)) pt" }) {
                                store.update(el.id, style: ["fontSize": .number($0)])
                            }
                        }
                    }

                    if el.isShape {
                        section("Drill-down") {
                            if let link = el.linkedDiagramId {
                                Button { onDrillDown(link) } label: { Label("Open “\(linkNames[link] ?? "linked diagram")”", systemImage: "arrow.down.right.square") }
                                    .buttonStyle(.clara(.secondary, small: true))
                                HStack {
                                    Button("Change") { pickingLink = true }.buttonStyle(.clara(.ghost, small: true))
                                    Button("Remove link") { store.setLink(el.id, nil) }.buttonStyle(.clara(.danger, small: true))
                                }
                            } else {
                                Text("Link this shape to a diagram with its detail. Double-tap the shape to open it.").font(ClaraFont.body(13.5)).foregroundStyle(Theme.muted)
                                HStack {
                                    Button { Task { await createChild(el) } } label: { Label("New child diagram", systemImage: "plus") }.buttonStyle(.clara(.secondary, small: true))
                                    Button("Link existing") { pickingLink = true }.buttonStyle(.clara(.ghost, small: true))
                                }
                            }
                        }
                        .task(id: el.linkedDiagramId) {
                            if let link = el.linkedDiagramId, linkNames[link] == nil, let d = try? await api.diagram(link) { linkNames[link] = d.name }
                        }
                    }

                    if el.type != .connector {
                        section("Arrange") {
                            HStack {
                                Button { store.setZ(el.id, front: true) } label: { Label("Bring to front", systemImage: "square.3.layers.3d.top.filled") }.buttonStyle(.clara(.ghost, small: true))
                                Button { store.setZ(el.id, front: false) } label: { Label("Send to back", systemImage: "square.3.layers.3d.bottom.filled") }.buttonStyle(.clara(.ghost, small: true))
                            }
                        }
                    }
                }

                HStack {
                    Button { selection = store.duplicate(selection) } label: { Label("Duplicate", systemImage: "plus.square.on.square") }.buttonStyle(.clara(.secondary, small: true))
                    Button {
                        store.delete(selection)
                        selection = []
                    } label: { Label(store.activeState != nil ? "Hide in state" : "Delete", systemImage: store.activeState != nil ? "eye.slash" : "trash") }
                        .buttonStyle(.clara(.danger, small: true))
                }
            }
            .padding(16)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Theme.surface)
        .claraSheet(isPresented: $pickingLink) {
            if let d = store.diagram, let el = selected?.element {
                DiagramPickerSheet(workspaceId: d.workspace_id, title: "Link to a diagram", excludeIds: [d.id], confirmLabel: "Link") { id in
                    store.setLink(el.id, id)
                    toasts.success("Linked")
                }
            }
        }
    }

    private func kindName(_ el: DiagramElement) -> String {
        switch el.type { case .rect: "Box"; case .ellipse: "Ellipse"; case .text: "Text"; case .connector: "Connector"; case .group: "Group" }
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).eyebrowStyle()
            content()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
    }

    private func createChild(_ el: DiagramElement) async {
        guard let name = await dialogs.prompt(title: "Create a child diagram", label: "Name", initial: el.text.isEmpty ? "Untitled diagram" : el.text, confirmLabel: "Create and link") else { return }
        do {
            let child = try await store.createChild(for: el.id, name: name)
            linkNames[child.id] = child.name
            toasts.show("Linked to new diagram “\(child.name)”", tone: .success, actionLabel: "Open") { onDrillDown(child.id) }
        } catch { toasts.error(error) }
    }
}

/// Base + named states, add/rename/reorder/delete, and Present (StatesBar.tsx).
struct StatesBar: View {
    @Bindable var store: DiagramStore
    var editable: Bool
    var onPresent: () -> Void
    @Environment(DialogCenter.self) private var dialogs
    @Namespace private var ns

    var body: some View {
        HStack(spacing: 8) {
            Text("States").font(ClaraFont.body(13.5)).foregroundStyle(Theme.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    chip("Base", id: nil)
                    ForEach(store.states) { s in
                        chip(s.name, id: s.id)
                    }
                    if editable {
                        ClaraMenu("Add a state") {
                            ClaraMenuEntry.action("New state", "plus") { Task { await add(copy: false) } }
                            if let a = store.activeState {
                                ClaraMenuEntry.action("Duplicate “\(a.name)”", "plus.square.on.square") { Task { await add(copy: true) } }
                            }
                        } label: {
                            Image(systemName: "plus").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink2).frame(width: 30, height: 30).background(Theme.surface2, in: Circle())
                        }
                    }
                }
                .padding(.vertical, 2)
            }
            if editable, let s = store.activeState {
                MoreMenu(label: "State actions") { stateMenu(s) }
            }
            Button(action: onPresent) { Label("Present", systemImage: "play.fill") }
                .buttonStyle(.clara(.secondary, small: true))
                .disabled(store.states.isEmpty)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(Theme.surface)
    }

    private func chip(_ name: String, id: String?) -> some View {
        let on = store.activeStateId == id
        return Button {
            withAnimation(Theme.spring) { store.activeStateId = id }
            UISelectionFeedbackGenerator().selectionChanged()
        } label: {
            Text(name).font(ClaraFont.body(14, weight: on ? .semibold : .regular))
                .foregroundStyle(on ? Theme.accentFg : Theme.ink2)
                .padding(.horizontal, 13).frame(height: 30)
                .background {
                    if on { Capsule().fill(Theme.cobalt).matchedGeometryEffect(id: "state", in: ns) } else { Capsule().fill(Theme.surface2) }
                }
        }
        .buttonStyle(PressScale())
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    @MenuBuilder private func stateMenu(_ s: DiagramState) -> [ClaraMenuEntry] {
        ClaraMenuEntry.action("Rename", "pencil") { Task { if let n = await dialogs.prompt(title: "Rename state", label: "Name", initial: s.name) { await store.renameState(s.id, n) } } }
        ClaraMenuEntry.action("Move earlier", "arrow.left", disabled: store.states.first?.id == s.id) { Task { await store.moveState(s.id, by: -1) } }
        ClaraMenuEntry.action("Move later", "arrow.right", disabled: store.states.last?.id == s.id) { Task { await store.moveState(s.id, by: 1) } }
        ClaraMenuEntry.divider
        ClaraMenuEntry.action("Delete state", "trash", destructive: true) {
            Task {
                if await dialogs.confirm(title: "Delete “\(s.name)”?", message: "The base diagram is unchanged. Elements that only exist in this state are kept hidden.", confirmLabel: "Delete state", danger: true) {
                    await store.deleteState(s.id)
                }
            }
        }
    }

    private func add(copy: Bool) async {
        let suggested = "State \(store.states.count + 1)"
        guard let name = await dialogs.prompt(title: copy ? "Duplicate state" : "New state", label: "Name", placeholder: "e.g. Target architecture", initial: suggested, confirmLabel: "Add state") else { return }
        await store.addState(name, copyActive: copy)
    }
}
