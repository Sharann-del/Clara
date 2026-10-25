import SwiftUI

/// Everything about one open diagram (DiagramPage.tsx): data, live collaboration, and the edit
/// operations. Edits go over the WebSocket (persisted by the server, echoed to everyone). While a
/// state is selected, edits become overrides on that state instead of changing the base diagram.
@Observable
final class DiagramStore {
    let diagramId: String
    private let api: APIClient
    private let auth: AuthStore

    var diagram: DiagramFull?
    var workspace: Workspace?
    var elements: [DiagramElement] = []
    var states: [DiagramState] = []
    var activeStateId: String?
    var code = ""
    var codeFormat = "clara"
    var breadcrumb: [IdName] = []
    var loadError: APIError?
    /// Shapes other people are dragging right now.
    var remoteMoves: [String: CGPoint] = [:]
    var remoteCursors: [String: (point: CGPoint, email: String?)] = [:]
    var rt: RealtimeConnection?
    var notify: (String, Bool, (() -> Void)?) -> Void = { _, _, _ in }

    init(diagramId: String, api: APIClient, auth: AuthStore) {
        self.diagramId = diagramId
        self.api = api
        self.auth = auth
    }

    var role: Role? { diagram?.role ?? workspace?.role }
    var canEdit: Bool { (role ?? .viewer) >= .editor }
    var canDelete: Bool { (workspace?.role ?? .viewer) >= .editor }
    var activeState: DiagramState? { states.first { $0.id == activeStateId } }

    /// Base elements with the selected state's overrides (and others' live drags) applied.
    var display: [Resolved] {
        var r = States.resolve(elements, activeState)
        if !remoteMoves.isEmpty {
            for i in r.indices {
                if let p = remoteMoves[r[i].id] {
                    r[i].element.geometry["x"] = .number(p.x)
                    r[i].element.geometry["y"] = .number(p.y)
                }
            }
        }
        return r
    }

    // MARK: Loading

    func load() async {
        loadError = nil
        do {
            let d = try await api.diagram(diagramId)
            diagram = d
            elements = d.elements
            states = (try? await api.states(diagramId)) ?? []
            if let src = try? await api.source(diagramId) {
                code = src.text
                codeFormat = src.format == "mermaid" ? "mermaid" : "clara"
            }
            if code.isEmpty, !elements.isEmpty { code = SharedJS.shared.toMermaid(elements); codeFormat = "mermaid" }
            workspace = try? await api.workspace(d.workspace_id)
            await loadBreadcrumb(d)
            connect()
        } catch let e as APIError { loadError = e } catch { loadError = APIError(status: 0, message: errorMessage(error)) }
    }

    /// Parent chain for C4 drill-down: root … this diagram.
    private func loadBreadcrumb(_ d: DiagramFull) async {
        var chain = [IdName(id: d.id, name: d.name)]
        var parent = d.parent_diagram_id
        var guardCount = 0
        while let p = parent, guardCount < 8, let pd = try? await api.diagram(p) {
            chain.insert(IdName(id: pd.id, name: pd.name), at: 0)
            parent = pd.parent_diagram_id
            guardCount += 1
        }
        breadcrumb = chain
    }

    func refreshStates() async {
        if let s = try? await api.states(diagramId) {
            states = s
            if let a = activeStateId, !s.contains(where: { $0.id == a }) { activeStateId = nil }
        }
    }

    // MARK: Realtime

    private func connect() {
        guard rt == nil else { return }
        let conn = RealtimeConnection(.diagram, diagramId, auth: auth)
        conn.onReconnect = { [weak self] in Task { await self?.reload() } }
        conn.start { [weak self] msg in self?.handle(msg) }
        rt = conn
    }

    func disconnect() { rt?.close(); rt = nil }

    private func reload() async {
        if let d = try? await api.diagram(diagramId) { diagram = d; elements = d.elements }
        await refreshStates()
    }

    private func handle(_ msg: [String: Any]) {
        switch msg["type"] as? String {
        case "cursor":
            if let id = msg["userId"] as? String, let x = msg["x"] as? Double, let y = msg["y"] as? Double {
                remoteCursors[id] = (CGPoint(x: x, y: y), msg["email"] as? String)
            }
        case "presence.left":
            if let id = msg["userId"] as? String { remoteCursors[id] = nil }
        case "element.moving":
            guard (msg["stateId"] as? String) == activeStateId, let id = msg["id"] as? String, let x = msg["x"] as? Double, let y = msg["y"] as? Double else { return }
            remoteMoves[id] = CGPoint(x: x, y: y)
        case "element.created", "element.updated":
            guard let raw = msg["element"], let data = try? JSONSerialization.data(withJSONObject: raw), let el = try? JSON.decoder.decode(DiagramElement.self, from: data) else { return }
            if let i = elements.firstIndex(where: { $0.id == el.id }) { elements[i] = el } else { elements.append(el) }
            remoteMoves[el.id] = nil
        case "element.deleted":
            if let id = msg["id"] as? String { elements.removeAll { $0.id == id } }
        case "diagram.refreshed":
            Task { await reload() }
        case "states.refreshed":
            Task { await refreshStates() }
        case "state.override":
            guard let sid = msg["stateId"] as? String, let eid = msg["elementId"] as? String else { return }
            remoteMoves[eid] = nil
            var ov: ElementOverride?
            if let raw = msg["override"], !(raw is NSNull), let data = try? JSONSerialization.data(withJSONObject: raw) { ov = try? JSON.decoder.decode(ElementOverride.self, from: data) }
            applyOverrideLocally(sid, eid, ov)
        case "error":
            notify(msg["message"] as? String ?? "Live update was refused", true, nil)
        default: break
        }
    }

    // MARK: Element edits

    private func applyOverrideLocally(_ stateId: String, _ elementId: String, _ ov: ElementOverride?) {
        guard let i = states.firstIndex(where: { $0.id == stateId }) else { return }
        states[i].element_overrides[elementId] = ov
    }

    private func saveOverride(_ state: DiagramState, _ elementId: String, _ ov: ElementOverride?) {
        applyOverrideLocally(state.id, elementId, ov)
        rt?.send("state.override", ["stateId": state.id, "elementId": elementId, "override": ov.map { RealtimeConnection.plain($0) } ?? NSNull()])
    }

    private func overrideEdit(_ id: String, geometry: JSONObject? = nil, style: JSONObject? = nil, hidden: Bool? = nil) {
        guard let base = elements.first(where: { $0.id == id }), let state = activeState else { return }
        saveOverride(state, id, States.mergeOverride(base: base, existing: state.element_overrides[id], geometry: geometry, style: style, hidden: hidden))
    }

    /// Inside a state a new element is base-hidden and made visible only there (planCreate).
    func create(_ el: DiagramElement) {
        var element = el
        if activeState != nil { element.style["baseHidden"] = true }
        elements.append(element)
        rt?.send("element.create", ["element": RealtimeConnection.plain(element)])
        if let state = activeState { saveOverride(state, element.id, ElementOverride(hidden: false)) }
    }

    func update(_ id: String, geometry: JSONObject? = nil, style: JSONObject? = nil) {
        if activeState != nil { return overrideEdit(id, geometry: geometry, style: style) }
        guard let i = elements.firstIndex(where: { $0.id == id }) else { return }
        var payload: [String: Any] = ["id": id]
        if let geometry {
            elements[i].geometry.merge(geometry) { _, n in n }
            payload["geometry"] = RealtimeConnection.plain(elements[i].geometry)
        }
        if let style {
            elements[i].style.merge(style) { _, n in n }
            payload["style"] = RealtimeConnection.plain(elements[i].style)
        }
        rt?.send("element.update", payload)
    }

    func setZ(_ id: String, front: Bool) {
        guard let i = elements.firstIndex(where: { $0.id == id }) else { return }
        let zs = elements.map(\.zIndex)
        elements[i].zIndex = front ? (zs.max() ?? 0) + 1 : (zs.min() ?? 0) - 1
        rt?.send("element.update", ["id": id, "zIndex": elements[i].zIndex])
    }

    /// Drill-down links live on the base element, whichever state is showing.
    func setLink(_ id: String, _ linked: String?) {
        guard let i = elements.firstIndex(where: { $0.id == id }) else { return }
        elements[i].linkedDiagramId = linked
        rt?.send("element.update", ["id": id, "linkedDiagramId": linked ?? NSNull()])
    }

    func delete(_ ids: Set<String>) {
        if let state = activeState {
            for id in ids { overrideEdit(id, hidden: true) }
            notify("Hidden in “\(state.name)”. It still exists in the base diagram.", false, nil)
            return
        }
        // Connectors attached to deleted shapes go too.
        let doomed = ids.union(elements.filter { $0.type == .connector && (ids.contains($0.fromId ?? "") || ids.contains($0.toId ?? "")) }.map(\.id))
        let removed = elements.filter { doomed.contains($0.id) }
        elements.removeAll { doomed.contains($0.id) }
        for id in doomed { rt?.send("element.delete", ["id": id]) }
        guard !removed.isEmpty else { return }
        notify("Deleted \(removed.count) element\(removed.count == 1 ? "" : "s")", false) { [weak self] in
            for el in removed {
                self?.elements.append(el)
                self?.rt?.send("element.create", ["element": RealtimeConnection.plain(el)])
            }
        }
    }

    func unhide(_ id: String) { overrideEdit(id, hidden: false) }

    /// Copies offset by 24pt; connectors between copied shapes are re-attached to the copies.
    func duplicate(_ ids: Set<String>) -> Set<String> {
        var map: [String: String] = [:]
        var copies: [DiagramElement] = []
        for el in display.map(\.element) where ids.contains(el.id) && el.type != .connector {
            var c = el
            c.id = UUID().uuidString.lowercased()
            c.geometry["x"] = .number(el.geometry.num("x") + 24)
            c.geometry["y"] = .number(el.geometry.num("y") + 24)
            c.linkedDiagramId = nil
            c.style["baseHidden"] = nil
            map[el.id] = c.id
            copies.append(c)
        }
        for el in elements where el.type == .connector {
            if let f = el.fromId, let t = el.toId, let nf = map[f], let nt = map[t] {
                var c = el
                c.id = UUID().uuidString.lowercased()
                c.geometry["fromId"] = .string(nf)
                c.geometry["toId"] = .string(nt)
                copies.append(c)
            }
        }
        copies.forEach(create)
        return Set(copies.map(\.id))
    }

    func moving(_ id: String, to p: CGPoint) {
        rt?.send("element.moving", ["id": id, "x": p.x, "y": p.y, "stateId": activeStateId ?? NSNull()])
    }

    func cursor(_ p: CGPoint) { rt?.send("cursor", ["x": p.x, "y": p.y]) }

    // MARK: States

    func addState(_ name: String, copyActive: Bool) async {
        do {
            let s = try await api.createState(diagramId, name: name, copyFrom: copyActive ? activeStateId : nil)
            states.append(s)
            activeStateId = s.id
            rt?.send("states.refresh")
        } catch { notify(errorMessage(error), true, nil) }
    }

    func renameState(_ id: String, _ name: String) async {
        if let i = states.firstIndex(where: { $0.id == id }) { states[i].name = name }
        do { try await api.renameState(id, name) } catch { notify(errorMessage(error), true, nil) }
        rt?.send("states.refresh")
    }

    func moveState(_ id: String, by dir: Int) async {
        guard let i = states.firstIndex(where: { $0.id == id }), states.indices.contains(i + dir) else { return }
        states.swapAt(i, i + dir)
        if let s = try? await api.reorderStates(diagramId, states.map(\.id)) { states = s }
        rt?.send("states.refresh")
    }

    func deleteState(_ id: String) async {
        do { try await api.deleteState(id) } catch { notify(errorMessage(error), true, nil) }
        states.removeAll { $0.id == id }
        if activeStateId == id { activeStateId = nil }
        rt?.send("states.refresh")
    }

    // MARK: Code

    var compiled: SharedJS.Compiled { SharedJS.shared.compile(code, format: codeFormat) }

    func applyCode() async throws {
        let c = compiled
        let saved = try await api.saveElements(diagramId, c.elements)
        elements = saved
        try await api.setSource(diagramId, text: code, format: codeFormat)
        rt?.send("diagram.refresh")
    }

    func loadFromCanvas() {
        code = SharedJS.shared.toMermaid(elements)
        codeFormat = "mermaid"
    }

    // MARK: Diagram

    func createChild(for elementId: String, name: String) async throws -> DiagramSummary {
        guard let d = diagram else { throw APIError(status: 0, message: "Diagram not loaded") }
        let child = try await api.createDiagram(d.workspace_id, name: name, folder: d.folder_id, parent: d.id)
        setLink(elementId, child.id)
        return child
    }

    func rename(_ name: String) async throws {
        try await api.updateDiagram(diagramId, name: name)
        diagram?.name = name
        if let i = breadcrumb.firstIndex(where: { $0.id == diagramId }) { breadcrumb[i] = IdName(id: diagramId, name: name) }
    }

    func setTags(_ tags: [String]) async throws {
        try await api.updateDiagram(diagramId, tags: tags)
        diagram?.tags = tags
    }

    func restoreAfterHistory() async {
        await reload()
        rt?.send("diagram.refresh")
    }
}
