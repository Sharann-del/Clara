import SwiftUI

/// What to draw and how. Shared by the viewer, the editor, present mode and image export.
struct DiagramScene {
    var elements: [Resolved]
    var palette: DiagramPalette = .dark
    /// Editor: hidden-in-this-state elements drawn faintly instead of skipped.
    var ghostHidden = false
    var selection: Set<String> = []
    var connectorSource: String?
    /// Outline colour per element id (e.g. what a proposal adds).
    var highlights: [String: Color] = [:]
    /// Element ids whose text is being edited (label not drawn).
    var editingId: String?
    /// Opacity per element (present-mode fades); defaults to 1.
    var opacity: [String: Double] = [:]
    /// Live geometry for shapes mid-drag/resize.
    var liveBoxes: [String: CGRect] = [:]

    func box(_ el: DiagramElement) -> CGRect { liveBoxes[el.id] ?? el.box }
}

enum DiagramRenderer {
    /// Draws the scene into `ctx`, already transformed into diagram coordinates.
    static func draw(_ scene: DiagramScene, in ctx: inout GraphicsContext) {
        let pal = scene.palette
        let visible = scene.elements.filter { scene.ghostHidden || !$0.hidden }
        let byId = Dictionary(visible.map { ($0.id, $0.element) }, uniquingKeysWith: { a, _ in a })
        let ordered = visible.filter { $0.element.type != .connector }.sorted { $0.element.zIndex < $1.element.zIndex }

        for r in ordered {
            let el = r.element
            var c = ctx
            c.opacity = (r.hidden ? 0.25 : 1) * (scene.opacity[el.id] ?? 1)
            let selected = scene.selection.contains(el.id)
            let b = scene.box(el)

            if let h = scene.highlights[el.id] {
                let hp = Path(roundedRect: b.insetBy(dx: -5, dy: -5), cornerRadius: 9)
                c.stroke(hp, with: .color(h), style: StrokeStyle(lineWidth: 2, dash: [5, 4]))
            }

            switch el.type {
            case .text:
                guard scene.editingId != el.id else { continue }
                let fs = el.style.num("fontSize", 14)
                var text = Text(el.text).font(.system(size: fs)).foregroundColor(pal.ink(el.style.str("color")))
                if selected { text = text.underline() }
                c.draw(text, at: CGPoint(x: b.minX, y: b.maxY), anchor: .bottomLeading)
            case .group:
                let p = Path(roundedRect: b, cornerRadius: 8)
                c.stroke(p, with: .color(selected ? pal.accent : pal.group), style: StrokeStyle(lineWidth: selected ? 2 : 1, dash: [6, 4]))
                if scene.editingId != el.id {
                    c.draw(Text(el.text).font(.system(size: 12)).foregroundColor(pal.muted), at: CGPoint(x: b.minX + 8, y: b.minY + 6), anchor: .topLeading)
                }
            case .rect, .ellipse:
                let colors = pal.shape(fill: el.style.str("fill"), stroke: el.style.str("stroke"))
                let p = el.type == .ellipse ? Path(ellipseIn: b) : Path(roundedRect: b, cornerRadius: 6)
                c.fill(p, with: .color(colors.fill))
                let dashed = scene.connectorSource == el.id
                c.stroke(p, with: .color(selected || dashed ? pal.accent : colors.stroke), style: StrokeStyle(lineWidth: selected || dashed ? 2.5 : 1.5, dash: dashed ? [5, 3] : []))
                if scene.editingId != el.id, !el.text.isEmpty {
                    let wrap = LabelWrap.wrap(el.text, width: b.width, height: b.height, ellipse: el.type == .ellipse)
                    for (i, line) in wrap.lines.enumerated() {
                        c.draw(Text(line).font(.system(size: wrap.fontSize)).foregroundColor(colors.text), at: CGPoint(x: b.midX, y: wrap.lineY(b.midY, i)), anchor: .center)
                    }
                }
                if el.linkedDiagramId != nil {
                    // Drill-down marker: "opens a child diagram" corner badge.
                    var badge = Path()
                    badge.move(to: CGPoint(x: b.maxX - 18, y: b.minY + 6)); badge.addLine(to: CGPoint(x: b.maxX - 6, y: b.minY + 6)); badge.addLine(to: CGPoint(x: b.maxX - 6, y: b.minY + 18))
                    badge.move(to: CGPoint(x: b.maxX - 6, y: b.minY + 6)); badge.addLine(to: CGPoint(x: b.maxX - 13, y: b.minY + 13))
                    c.stroke(badge, with: .color(colors.stroke), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                }
            case .connector:
                break
            }
        }

        for r in visible where r.element.type == .connector {
            let el = r.element
            guard let s = Geometry.segment(el, byId: byId, boxOf: scene.box) else { continue }
            var c = ctx
            c.opacity = (r.hidden ? 0.25 : 1) * (scene.opacity[el.id] ?? 1)
            let selected = scene.selection.contains(el.id)
            let color = selected ? pal.accent : (scene.highlights[el.id] ?? pal.ink(el.style.str("stroke"), fallback: pal.connector))
            var line = Path()
            line.move(to: s.from)
            line.addLine(to: s.to)
            c.stroke(line, with: .color(color), lineWidth: selected ? 2.5 : 1.5)
            c.fill(arrowHead(s), with: .color(color))
            if !el.text.isEmpty, scene.editingId != el.id {
                let label = c.resolve(Text(el.text).font(.system(size: 11)).foregroundColor(pal.connector))
                let size = label.measure(in: CGSize(width: 220, height: 40))
                let at = CGPoint(x: s.mid.x, y: s.mid.y - 4 - size.height / 2)
                c.fill(Path(roundedRect: CGRect(x: at.x - size.width / 2 - 3, y: at.y - size.height / 2 - 1, width: size.width + 6, height: size.height + 2), cornerRadius: 3), with: .color(pal.halo))
                c.draw(label, at: at, anchor: .center)
            }
        }
    }

    /// Arrowhead at the end of a segment, sized like the SVG marker.
    private static func arrowHead(_ s: Segment) -> Path {
        let angle = atan2(s.to.y - s.from.y, s.to.x - s.from.x)
        let len: CGFloat = 10, half: CGFloat = 5
        let back = CGPoint(x: s.to.x - len * cos(angle), y: s.to.y - len * sin(angle))
        var p = Path()
        p.move(to: s.to)
        p.addLine(to: CGPoint(x: back.x + half * sin(angle), y: back.y - half * cos(angle)))
        p.addLine(to: CGPoint(x: back.x - half * sin(angle), y: back.y + half * cos(angle)))
        p.closeSubpath()
        return p
    }

    /// Dot grid behind the diagram (`.canvas-viewport`).
    static func drawGrid(_ ctx: inout GraphicsContext, size: CGSize, offset: CGPoint, scale: CGFloat, palette: DiagramPalette) {
        ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(palette.canvas))
        let step = 20 * scale
        guard step > 6 else { return }
        let r: CGFloat = 1
        var dots = Path()
        var x = offset.x.truncatingRemainder(dividingBy: step)
        if x < 0 { x += step }
        while x < size.width {
            var y = offset.y.truncatingRemainder(dividingBy: step)
            if y < 0 { y += step }
            while y < size.height {
                dots.addEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
                y += step
            }
            x += step
        }
        ctx.fill(dots, with: .color(palette.dot))
    }
}

/// A static, fitted render of a diagram (thumbnails, image export, version previews).
struct DiagramImage: View {
    var elements: [Resolved]
    var palette: DiagramPalette = .dark
    var padding: CGFloat = 24
    var highlights: [String: Color] = [:]

    var body: some View {
        Canvas { ctx, size in
            DiagramRenderer.drawGrid(&ctx, size: size, offset: .zero, scale: 1, palette: palette)
            let shown = elements.filter { !$0.hidden }.map(\.element)
            guard let b = Geometry.bounds(shown), b.width > 0 || b.height > 0 else { return }
            let k = min((size.width - padding * 2) / max(b.width, 1), (size.height - padding * 2) / max(b.height, 1), 1.4)
            ctx.translateBy(x: (size.width - b.width * k) / 2 - b.minX * k, y: (size.height - b.height * k) / 2 - b.minY * k)
            ctx.scaleBy(x: k, y: k)
            DiagramRenderer.draw(DiagramScene(elements: elements, palette: palette, highlights: highlights), in: &ctx)
        }
    }
}
