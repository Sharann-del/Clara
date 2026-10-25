import SwiftUI

/// Read-only pan/zoom view of a diagram (DiagramViewer.tsx). Fits on appear and when the
/// content changes (until the user moves it), double-tap refits, tapping a linked shape drills down.
/// `inline` (inside a scrolling document): one-finger drags scroll the page, so only pinch zooms.
struct DiagramViewer: View {
    var elements: [Resolved]
    var highlights: [String: Color] = [:]
    var inline = false
    var showControls = true
    var maxFitScale: CGFloat = 1.6
    var emptyText = "Nothing to show yet"
    var onDrillDown: ((String) -> Void)?

    @State private var offset: CGPoint = .zero
    @State private var scale: CGFloat = 1
    @State private var userMoved = false
    @State private var gestureStart: (offset: CGPoint, scale: CGFloat)?
    @State private var size: CGSize = .zero

    private var shown: [DiagramElement] { elements.filter { !$0.hidden }.map(\.element) }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottomTrailing) {
                Canvas { ctx, s in
                    DiagramRenderer.drawGrid(&ctx, size: s, offset: offset, scale: scale, palette: .dark)
                    ctx.translateBy(x: offset.x, y: offset.y)
                    ctx.scaleBy(x: scale, y: scale)
                    DiagramRenderer.draw(DiagramScene(elements: elements, palette: .dark, highlights: highlights), in: &ctx)
                }
                .contentShape(Rectangle())
                .gesture(inline ? nil : pan)
                .simultaneousGesture(zoom(in: geo.size))
                .onTapGesture(count: 2) { withAnimation(Theme.easeOut) { userMoved = false; fit(geo.size) } }
                .onTapGesture { p in
                    let world = CGPoint(x: (p.x - offset.x) / scale, y: (p.y - offset.y) / scale)
                    if let hit = Geometry.hit(world, in: shown), let link = hit.linkedDiagramId { onDrillDown?(link) }
                }
                .accessibilityElement()
                .accessibilityLabel(accessibilitySummary)

                if shown.isEmpty {
                    Text(emptyText).font(ClaraFont.body(15)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                if showControls && !shown.isEmpty {
                    ZoomControls(scale: scale,
                                 zoomOut: { zoom(by: 1 / 1.25, in: geo.size) },
                                 zoomIn: { zoom(by: 1.25, in: geo.size) },
                                 fit: { withAnimation(Theme.easeOut) { userMoved = false; fit(geo.size) } })
                        .padding(10)
                }
            }
            .onAppear { size = geo.size; fit(geo.size) }
            .onChange(of: geo.size) { _, s in size = s; if !userMoved { fit(s) } }
            .onChange(of: elements) { _, _ in if !userMoved { withAnimation(Theme.easeOut) { fit(geo.size) } } }
        }
        .background(Theme.canvas)
        .clipped()
    }

    private var accessibilitySummary: String {
        let shapes = shown.filter(\.isShape).map(\.text).filter { !$0.isEmpty }
        return shapes.isEmpty ? "Diagram" : "Diagram with \(shapes.count) shapes: \(shapes.prefix(12).joined(separator: ", "))"
    }

    private var pan: some Gesture {
        DragGesture(minimumDistance: 4)
            .onChanged { v in
                if gestureStart == nil { gestureStart = (offset, scale) }
                userMoved = true
                offset = CGPoint(x: gestureStart!.offset.x + v.translation.width, y: gestureStart!.offset.y + v.translation.height)
            }
            .onEnded { _ in gestureStart = nil }
    }

    private func zoom(in size: CGSize) -> some Gesture {
        MagnifyGesture()
            .onChanged { v in
                if gestureStart == nil { gestureStart = (offset, scale) }
                userMoved = true
                let start = gestureStart!
                let k = min(4, max(0.15, start.scale * v.magnification))
                // Keep the pinch point fixed.
                let anchor = CGPoint(x: v.startAnchor.x * size.width, y: v.startAnchor.y * size.height)
                offset = CGPoint(x: anchor.x - (anchor.x - start.offset.x) * k / start.scale, y: anchor.y - (anchor.y - start.offset.y) * k / start.scale)
                scale = k
            }
            .onEnded { _ in gestureStart = nil }
    }

    private func zoom(by factor: CGFloat, in size: CGSize) {
        userMoved = true
        let k = min(4, max(0.15, scale * factor))
        let c = CGPoint(x: size.width / 2, y: size.height / 2)
        withAnimation(Theme.med) {
            offset = CGPoint(x: c.x - (c.x - offset.x) * k / scale, y: c.y - (c.y - offset.y) * k / scale)
            scale = k
        }
    }

    private func fit(_ size: CGSize) {
        guard size.width > 0, let b = Geometry.bounds(shown) else { return }
        let pad: CGFloat = 24
        let k = min((size.width - pad * 2) / max(b.width, 1), (size.height - pad * 2) / max(b.height, 1), maxFitScale) * 0.96
        scale = max(0.15, k)
        offset = CGPoint(x: (size.width - b.width * scale) / 2 - b.minX * scale, y: (size.height - b.height * scale) / 2 - b.minY * scale)
    }
}

/// − 100% + ⤢ pill (`.viewer-controls`, `.canvas-zoom`).
struct ZoomControls: View {
    let scale: CGFloat
    let zoomOut: () -> Void
    let zoomIn: () -> Void
    let fit: () -> Void
    var body: some View {
        HStack(spacing: 0) {
            control("minus.magnifyingglass", "Zoom out", zoomOut)
            Text("\(Int((scale * 100).rounded()))%").font(ClaraFont.body(12.5)).monospacedDigit().foregroundStyle(Theme.muted).frame(minWidth: 46)
            control("plus.magnifyingglass", "Zoom in", zoomIn)
            control("arrow.up.left.and.arrow.down.right", "Zoom to fit", fit)
        }
        .padding(3)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
    }
    private func control(_ symbol: String, _ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: 14)).foregroundStyle(Theme.ink2).frame(width: 34, height: 34) }
            .buttonStyle(PressScale()).accessibilityLabel(label)
    }
}
