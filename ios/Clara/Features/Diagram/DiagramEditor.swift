import SwiftUI

enum CanvasTool: String, CaseIterable, Identifiable {
    case select, rect, ellipse, text, connector
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .select: "cursorarrow"
        case .rect: "rectangle"
        case .ellipse: "circle"
        case .text: "textformat"
        case .connector: "arrow.up.right"
        }
    }
    var label: String {
        switch self {
        case .select: "Select (V)"
        case .rect: "Rectangle (R)"
        case .ellipse: "Ellipse (O)"
        case .text: "Text (T)"
        case .connector: "Connector (C): tap two shapes"
        }
    }
    var key: Character {
        switch self { case .select: "v"; case .rect: "r"; case .ellipse: "o"; case .text: "t"; case .connector: "c" }
    }
}

/// The editable canvas (DiagramCanvas.tsx), touch-first: drag a shape to move it, drag empty
/// space to pan, pinch to zoom, drag the corner handle to resize, double-tap to edit a label.
struct DiagramEditor: View {
    @Bindable var store: DiagramStore
    @Binding var tool: CanvasTool
    @Binding var selection: Set<String>
    let editable: Bool
    /// Set by the inspector to start editing an element's label on the canvas.
    @Binding var editRequest: String?
    var onDrillDown: (String) -> Void

    @State private var offset: CGPoint = .zero
    @State private var scale: CGFloat = 1
    @State private var fitted = false
    @State private var drag: DragKind?
    @State private var liveBoxes: [String: CGRect] = [:]
    @State private var drawRect: CGRect?
    @State private var connectorFrom: String?
    @State private var editing: EditingText?
    @State private var lastTap: (id: String?, at: Date) = (nil, .distantPast)
    @State private var pinchStart: (offset: CGPoint, scale: CGFloat)?
    @State private var lastBroadcast = Date.distantPast
    @State private var size: CGSize = .zero
    @FocusState private var canvasFocused: Bool

    private enum DragKind {
        case pan(start: CGPoint)
        case move(ids: [String], start: [String: CGRect])
        case resize(id: String, start: CGRect)
        case draw(start: CGPoint)
    }

    struct EditingText: Equatable {
        var id: String?
        var point: CGPoint
        var rect: CGRect
        var text: String
        var kind: DiagramElement.Kind
    }

    private var display: [Resolved] { store.display }
    private var visible: [DiagramElement] { display.filter { !$0.hidden || (editable && store.activeState != nil) }.map(\.element) }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Canvas { ctx, s in
                    DiagramRenderer.drawGrid(&ctx, size: s, offset: offset, scale: scale, palette: .dark)
                    ctx.translateBy(x: offset.x, y: offset.y)
                    ctx.scaleBy(x: scale, y: scale)
                    let scene = DiagramScene(elements: display, palette: .dark, ghostHidden: editable && store.activeState != nil, selection: selection,
                                             connectorSource: connectorFrom, editingId: editing?.id, liveBoxes: liveBoxes)
                    DiagramRenderer.draw(scene, in: &ctx)
                    drawOverlays(&ctx)
                }
                .contentShape(Rectangle())
                .gesture(dragGesture)
                .simultaneousGesture(pinchGesture(geo.size))
                .focusable()
                .focused($canvasFocused)
                .focusEffectDisabled()
                .onKeyPress(phases: .down, action: keyPress)
                .accessibilityElement()
                .accessibilityLabel(editable ? "Diagram canvas. Tools: select, rectangle, ellipse, text, connector." : "Diagram (view only)")

                if let editing { inlineEditor(editing) }

                if visible.isEmpty && editing == nil {
                    VStack(spacing: 8) {
                        Image(systemName: "point.3.connected.trianglepath.dotted").font(.system(size: 26)).foregroundStyle(Theme.muted)
                        Text(editable ? "Pick a shape tool and tap to place it, or write it as code in the Code tab." : "This diagram is empty.")
                            .font(ClaraFont.body(15)).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: 320).frame(maxWidth: .infinity, maxHeight: .infinity).allowsHitTesting(false)
                }

                if let hint {
                    Text(hint).font(ClaraFont.body(13.5)).foregroundStyle(Theme.ink)
                        .padding(.horizontal, 12).padding(.vertical, 6).background(Theme.surface3, in: Capsule())
                        .frame(maxWidth: .infinity).padding(.top, 12)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .allowsHitTesting(false)
                }

                ZoomControls(scale: scale, zoomOut: { zoomBy(1 / 1.25) }, zoomIn: { zoomBy(1.25) }, fit: { withAnimation(Theme.easeOut) { fit(size) } })
                    .padding(12).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            }
            .onAppear { size = geo.size; if !fitted { fit(geo.size); fitted = true } }
            .onChange(of: geo.size) { _, s in size = s }
            .onChange(of: tool) { _, t in if t != .connector { connectorFrom = nil } }
            .onChange(of: editRequest) { _, id in
                guard let id else { return }
                editRequest = nil
                if let el = visible.first(where: { $0.id == id }) { startEditing(el) }
            }
        }
        .background(Theme.canvas)
        .clipped()
        .animation(Theme.med, value: hint)
    }

    private var hint: String? {
        switch tool {
        case .connector: connectorFrom == nil ? "Tap the shape the arrow starts from" : "Now tap the shape it points to"
        case .text: "Tap where the text goes"
        case .rect, .ellipse: "Tap to place, or drag to draw"
        case .select: nil
        }
    }

    // MARK: Coordinates

    private func world(_ p: CGPoint) -> CGPoint { CGPoint(x: (p.x - offset.x) / scale, y: (p.y - offset.y) / scale) }
    private func screen(_ r: CGRect) -> CGRect { CGRect(x: r.minX * scale + offset.x, y: r.minY * scale + offset.y, width: r.width * scale, height: r.height * scale) }
    private func box(_ el: DiagramElement) -> CGRect { liveBoxes[el.id] ?? el.box }

    private func fit(_ s: CGSize) {
        guard s.width > 0 else { return }
        guard let b = Geometry.bounds(visible) else { scale = 1; offset = CGPoint(x: s.width / 2 - 200, y: s.height / 2 - 120); return }
        let k = min((s.width - 80) / max(b.width, 1), (s.height - 120) / max(b.height, 1), 1.4)
        scale = max(0.2, k)
        offset = CGPoint(x: (s.width - b.width * scale) / 2 - b.minX * scale, y: (s.height - b.height * scale) / 2 - b.minY * scale)
    }

    private func zoomBy(_ f: CGFloat) {
        let k = min(4, max(0.15, scale * f))
        let c = CGPoint(x: size.width / 2, y: size.height / 2)
        withAnimation(Theme.med) {
            offset = CGPoint(x: c.x - (c.x - offset.x) * k / scale, y: c.y - (c.y - offset.y) * k / scale)
            scale = k
        }
    }

    // MARK: Overlays

    private func drawOverlays(_ ctx: inout GraphicsContext) {
        let pal = DiagramPalette.dark
        if let r = drawRect {
            let p = tool == .ellipse ? Path(ellipseIn: r) : Path(roundedRect: r, cornerRadius: 6)
            ctx.stroke(p, with: .color(pal.accent), style: StrokeStyle(lineWidth: 1.5 / scale, dash: [5 / scale, 4 / scale]))
        }
        if editable, selection.count == 1, let id = selection.first, let el = visible.first(where: { $0.id == id }), el.isShape || el.type == .group {
            let b = box(el)
            let h = 14 / scale
            ctx.fill(Path(roundedRect: CGRect(x: b.maxX - h / 2, y: b.maxY - h / 2, width: h, height: h), cornerRadius: 3 / scale), with: .color(pal.accent))
            ctx.stroke(Path(roundedRect: CGRect(x: b.maxX - h / 2, y: b.maxY - h / 2, width: h, height: h), cornerRadius: 3 / scale), with: .color(pal.canvas), lineWidth: 1.5 / scale)
        }
        // Other people's pointers.
        for (uid, c) in store.remoteCursors {
            let color = Color(hex: PresenceUser.color(for: uid))
            var arrow = Path()
            let k = 1 / scale
            arrow.move(to: c.point)
            arrow.addLine(to: CGPoint(x: c.point.x + 13 * k, y: c.point.y + 6.5 * k))
            arrow.addLine(to: CGPoint(x: c.point.x + 7.5 * k, y: c.point.y + 8.1 * k))
            arrow.addLine(to: CGPoint(x: c.point.x + 5 * k, y: c.point.y + 14 * k))
            arrow.closeSubpath()
            ctx.fill(arrow, with: .color(color))
            ctx.draw(Text(c.email ?? "").font(.system(size: 11 * k, weight: .semibold)).foregroundColor(color), at: CGPoint(x: c.point.x + 12 * k, y: c.point.y + 22 * k), anchor: .leading)
        }
    }

    // MARK: Gestures

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { v in
                if editing != nil { return }
                let moved = hypot(v.translation.width, v.translation.height) > 5
                if drag == nil {
                    guard moved else { return }
                    drag = classify(v.startLocation)
                }
                apply(v)
            }
            .onEnded { v in
                defer { drag = nil; drawRect = nil }
                if drag == nil || hypot(v.translation.width, v.translation.height) <= 5 {
                    liveBoxes = [:]
                    tap(at: v.location)
                    return
                }
                commit(v)
            }
    }

    private func classify(_ start: CGPoint) -> DragKind {
        let w = world(start)
        if editable, selection.count == 1, let id = selection.first, let el = visible.first(where: { $0.id == id }), el.isShape || el.type == .group {
            let b = screen(el.box)
            if hypot(start.x - b.maxX, start.y - b.maxY) < 24 { return .resize(id: id, start: el.box) }
        }
        if editable, tool == .select, let hit = Geometry.hit(w, in: visible), hit.type != .connector {
            let ids = selection.contains(hit.id) ? Array(selection) : [hit.id]
            if !selection.contains(hit.id) { selection = [hit.id] }
            let starts = Dictionary(uniqueKeysWithValues: visible.filter { ids.contains($0.id) && $0.type != .connector }.map { ($0.id, $0.box) })
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            return .move(ids: Array(starts.keys), start: starts)
        }
        if editable, tool == .rect || tool == .ellipse { return .draw(start: w) }
        return .pan(start: offset)
    }

    private func apply(_ v: DragGesture.Value) {
        switch drag {
        case .pan(let start):
            offset = CGPoint(x: start.x + v.translation.width, y: start.y + v.translation.height)
        case .move(let ids, let start):
            let dx = v.translation.width / scale, dy = v.translation.height / scale
            for id in ids { if let b = start[id] { liveBoxes[id] = b.offsetBy(dx: dx, dy: dy) } }
            if Date().timeIntervalSince(lastBroadcast) > 0.05 {
                lastBroadcast = Date()
                for id in ids { if let b = liveBoxes[id], let el = visible.first(where: { $0.id == id }) { store.moving(id, to: origin(el, b)) } }
                store.cursor(world(v.location))
            }
        case .resize(let id, let start):
            let w = max(40, start.width + v.translation.width / scale), h = max(28, start.height + v.translation.height / scale)
            liveBoxes[id] = CGRect(x: start.minX, y: start.minY, width: w, height: h)
        case .draw(let start):
            let p = world(v.location)
            drawRect = CGRect(x: min(start.x, p.x), y: min(start.y, p.y), width: abs(p.x - start.x), height: abs(p.y - start.y))
        case nil: break
        }
    }

    /// Stored x/y for a box: text keeps its baseline in `y`.
    private func origin(_ el: DiagramElement, _ b: CGRect) -> CGPoint {
        el.type == .text ? CGPoint(x: b.minX, y: b.minY + el.style.num("fontSize", 14)) : b.origin
    }

    private func commit(_ v: DragGesture.Value) {
        switch drag {
        case .move(let ids, _):
            for id in ids {
                guard let b = liveBoxes[id], let el = visible.first(where: { $0.id == id }) else { continue }
                let o = origin(el, b)
                store.update(id, geometry: ["x": .number(o.x.rounded()), "y": .number(o.y.rounded())])
            }
            liveBoxes = [:]
        case .resize(let id, _):
            if let b = liveBoxes[id] { store.update(id, geometry: ["width": .number(b.width.rounded()), "height": .number(b.height.rounded())]) }
            liveBoxes = [:]
        case .draw:
            if let r = drawRect, r.width > 12, r.height > 12 { place(tool == .ellipse ? .ellipse : .rect, rect: r) }
        default: break
        }
    }

    private func pinchGesture(_ s: CGSize) -> some Gesture {
        MagnifyGesture()
            .onChanged { v in
                if pinchStart == nil { pinchStart = (offset, scale) }
                guard let st = pinchStart else { return }
                let k = min(4, max(0.15, st.scale * v.magnification))
                let a = CGPoint(x: v.startAnchor.x * s.width, y: v.startAnchor.y * s.height)
                offset = CGPoint(x: a.x - (a.x - st.offset.x) * k / st.scale, y: a.y - (a.y - st.offset.y) * k / st.scale)
                scale = k
            }
            .onEnded { _ in pinchStart = nil }
    }

    // MARK: Taps

    private func tap(at p: CGPoint) {
        canvasFocused = true
        let w = world(p)
        let hit = Geometry.hit(w, in: visible)
        switch tool {
        case .text where editable:
            editing = EditingText(id: nil, point: w, rect: CGRect(x: w.x, y: w.y - 14, width: 160, height: 26), text: "", kind: .text)
        case .rect where editable, .ellipse where editable:
            place(tool == .ellipse ? .ellipse : .rect, rect: CGRect(x: w.x - 70, y: w.y - 30, width: 140, height: 60))
        case .connector where editable:
            guard let hit, hit.isShape || hit.type == .text else { connectorFrom = nil; return }
            if let from = connectorFrom, from != hit.id {
                store.create(DiagramElement(type: .connector, geometry: ["fromId": .string(from), "toId": .string(hit.id), "text": ""], style: ["stroke": "#475569"], zIndex: 0))
                connectorFrom = nil
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            } else {
                connectorFrom = hit.id
                UISelectionFeedbackGenerator().selectionChanged()
            }
        default:
            let isDouble = Date().timeIntervalSince(lastTap.at) < 0.35 && lastTap.id == hit?.id && hit != nil
            lastTap = (hit?.id, Date())
            if isDouble, let hit {
                if let link = hit.linkedDiagramId, !editable || !selection.contains(hit.id) || hit.text.isEmpty {
                    onDrillDown(link)
                } else if editable {
                    startEditing(hit)
                } else if let link = hit.linkedDiagramId {
                    onDrillDown(link)
                }
                return
            }
            withAnimation(Theme.fast) { selection = hit.map { [$0.id] } ?? [] }
            if hit != nil { UISelectionFeedbackGenerator().selectionChanged() }
        }
    }

    private func place(_ kind: DiagramElement.Kind, rect: CGRect) {
        let el = DiagramElement(type: kind, geometry: ["x": .number(rect.minX.rounded()), "y": .number(rect.minY.rounded()), "width": .number(rect.width.rounded()), "height": .number(rect.height.rounded()), "text": ""],
                                style: kind == .rect ? ["fill": "#eff6ff", "stroke": "#2563eb"] : ["fill": "#f0fdf4", "stroke": "#16a34a"], zIndex: 1)
        store.create(el)
        selection = [el.id]
        tool = .select
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        startEditing(el)
    }

    func startEditing(_ el: DiagramElement) {
        guard editable else { return }
        let byId = Dictionary(visible.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let rect: CGRect
        if el.type == .connector, let s = Geometry.segment(el, byId: byId) {
            rect = CGRect(x: s.mid.x - 70, y: s.mid.y - 14, width: 140, height: 28)
        } else if el.type == .group {
            rect = CGRect(x: el.box.minX + 4, y: el.box.minY + 2, width: max(140, el.box.width * 0.6), height: 26)
        } else {
            rect = el.box
        }
        editing = EditingText(id: el.id, point: rect.origin, rect: rect, text: el.text, kind: el.type)
    }

    // MARK: Inline text editor

    private func inlineEditor(_ e: EditingText) -> some View {
        let r = screen(e.rect)
        return InlineLabelEditor(text: e.text, multiline: e.kind == .rect || e.kind == .ellipse) { value in
            commitText(e, value)
        } onCancel: {
            editing = nil
        }
        .frame(width: max(140, r.width), height: max(34, r.height))
        .position(x: r.midX, y: r.midY)
    }

    private func commitText(_ e: EditingText, _ value: String) {
        editing = nil
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if let id = e.id {
            guard let el = store.elements.first(where: { $0.id == id }) ?? visible.first(where: { $0.id == id }) else { return }
            var g = el.geometry
            g["text"] = .string(text)
            store.update(id, geometry: g)
        } else if !text.isEmpty {
            let el = DiagramElement(type: .text, geometry: ["x": .number(e.point.x.rounded()), "y": .number(e.point.y.rounded()), "text": .string(text)], style: ["fontSize": 14, "color": "#0f172a"], zIndex: 2)
            store.create(el)
            selection = [el.id]
            tool = .select
        }
    }

    // MARK: Keyboard (iPad)

    private func keyPress(_ press: KeyPress) -> KeyPress.Result {
        guard editing == nil else { return .ignored }
        if press.modifiers.contains(.command) {
            switch press.characters {
            case "a": selection = Set(visible.map(\.id)); return .handled
            case "d" where editable && !selection.isEmpty: selection = store.duplicate(selection); return .handled
            default: return .ignored
            }
        }
        switch press.key {
        case .delete, .deleteForward:
            guard editable, !selection.isEmpty else { return .ignored }
            store.delete(selection); selection = []; return .handled
        case .escape:
            selection = []; connectorFrom = nil; tool = .select; return .handled
        case .return:
            if let id = selection.first, let el = visible.first(where: { $0.id == id }) { startEditing(el); return .handled }
            return .ignored
        case .leftArrow, .rightArrow, .upArrow, .downArrow:
            guard editable, !selection.isEmpty else { return .ignored }
            let step: Double = press.modifiers.contains(.shift) ? 10 : 1
            let dx: Double = press.key == .leftArrow ? -step : press.key == .rightArrow ? step : 0
            let dy: Double = press.key == .upArrow ? -step : press.key == .downArrow ? step : 0
            for id in selection {
                guard let el = visible.first(where: { $0.id == id }), el.type != .connector else { continue }
                store.update(id, geometry: ["x": .number(el.geometry.num("x") + dx), "y": .number(el.geometry.num("y") + dy)])
            }
            return .handled
        default:
            break
        }
        switch press.characters {
        case "+", "=": zoomBy(1.25); return .handled
        case "-": zoomBy(1 / 1.25); return .handled
        case "0": withAnimation(Theme.easeOut) { fit(size) }; return .handled
        default:
            if editable, let t = CanvasTool.allCases.first(where: { String($0.key) == press.characters.lowercased() }) { tool = t; return .handled }
            return .ignored
        }
    }
}

/// Floating text field for a shape's label (`.canvas-text-input`).
private struct InlineLabelEditor: View {
    @State var text: String
    var multiline: Bool
    let onCommit: (String) -> Void
    let onCancel: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        TextField("", text: $text, prompt: Text("Label").foregroundStyle(Theme.muted), axis: multiline ? .vertical : .horizontal)
            .font(.system(size: 14))
            .multilineTextAlignment(multiline ? .center : .leading)
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.surface3, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Theme.cobalt, lineWidth: 2))
            .focused($focused)
            .submitLabel(.done)
            .onSubmit { onCommit(text) }
            .onAppear { focused = true }
            .onChange(of: focused) { _, f in if !f { onCommit(text) } }
            .onKeyPress(.escape) { onCancel(); return .handled }
            .transition(.scale(scale: 0.95).combined(with: .opacity))
    }
}

/// Tool palette: vertical rail on iPad, a floating bar on iPhone (`.canvas-toolbar`).
struct ToolPalette: View {
    @Binding var tool: CanvasTool
    var vertical: Bool
    var hasSelection: Bool
    var onDuplicate: () -> Void
    var onDelete: () -> Void

    var body: some View {
        let layout = vertical ? AnyLayout(VStackLayout(spacing: 6)) : AnyLayout(HStackLayout(spacing: 4))
        layout {
            ForEach(CanvasTool.allCases) { t in
                IconButton(symbol: t.symbol, label: t.label, active: tool == t) {
                    withAnimation(Theme.fast) { tool = t }
                    UISelectionFeedbackGenerator().selectionChanged()
                }
            }
            if vertical { Spacer() } else { Rectangle().fill(Theme.surface4).frame(width: 1, height: 22).padding(.horizontal, 2) }
            IconButton(symbol: "plus.square.on.square", label: "Duplicate", tint: hasSelection ? Theme.ink2 : Theme.lineStrong, action: onDuplicate).disabled(!hasSelection)
            IconButton(symbol: "trash", label: "Delete", tint: hasSelection ? Theme.ink2 : Theme.lineStrong, action: onDelete).disabled(!hasSelection)
        }
        .padding(vertical ? 6 : 5)
        .background(vertical ? Theme.surface : Theme.surface2, in: RoundedRectangle(cornerRadius: vertical ? 0 : Theme.rLg, style: .continuous))
    }
}
