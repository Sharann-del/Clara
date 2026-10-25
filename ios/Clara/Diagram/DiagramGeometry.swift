import SwiftUI

// Ports of packages/shared/src/render.ts geometry and text.ts label wrapping, so a connector
// resolves to the same two outline points, and labels wrap identically, on every client.

extension DiagramElement {
    /// Bounding box of a non-connector element (`elementBox`).
    var box: CGRect {
        if type == .text {
            let fs = style.num("fontSize", 14)
            return CGRect(x: geometry.num("x"), y: geometry.num("y") - fs, width: max(8, Double(text.count) * fs * 0.6), height: fs * 1.3)
        }
        return CGRect(x: geometry.num("x"), y: geometry.num("y"), width: geometry.num("width", 120), height: geometry.num("height", 60))
    }

    var fromId: String? { geometry.str("fromId") }
    var toId: String? { geometry.str("toId") }
}

struct Segment: Equatable {
    var from: CGPoint
    var to: CGPoint
    var mid: CGPoint { CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2) }
}

enum Geometry {
    /// Where the ray from the box centre towards `target` leaves the shape outline.
    static func clip(_ el: DiagramElement, _ box: CGRect, toward target: CGPoint) -> CGPoint {
        let c = CGPoint(x: box.midX, y: box.midY)
        let dx = target.x - c.x, dy = target.y - c.y
        if dx == 0 && dy == 0 { return c }
        let rx = box.width / 2, ry = box.height / 2
        let t: CGFloat = el.type == .ellipse
            ? 1 / sqrt(pow(dx / rx, 2) + pow(dy / ry, 2))
            : min(dx == 0 ? .infinity : rx / abs(dx), dy == 0 ? .infinity : ry / abs(dy))
        let k = min(1, t)
        return CGPoint(x: c.x + dx * k, y: c.y + dy * k)
    }

    /// Line to draw for a connector: between the two shapes' outlines when attached, else its stored coordinates.
    static func segment(_ el: DiagramElement, byId: [String: DiagramElement], boxOf: (DiagramElement) -> CGRect = { $0.box }) -> Segment? {
        if let f = el.fromId, let t = el.toId, let from = byId[f], let to = byId[t], from.type != .connector, to.type != .connector {
            let a = boxOf(from), b = boxOf(to)
            return Segment(from: clip(from, a, toward: CGPoint(x: b.midX, y: b.midY)), to: clip(to, b, toward: CGPoint(x: a.midX, y: a.midY)))
        }
        let g = el.geometry
        guard let x1 = g["x1"]?.double, let y1 = g["y1"]?.double, let x2 = g["x2"]?.double, let y2 = g["y2"]?.double else { return nil }
        return Segment(from: CGPoint(x: x1, y: y1), to: CGPoint(x: x2, y: y2))
    }

    /// Union bounding box of everything drawable.
    static func bounds(_ elements: [DiagramElement]) -> CGRect? {
        let byId = Dictionary(elements.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var r: CGRect?
        for el in elements {
            let b: CGRect
            if el.type == .connector {
                guard let s = segment(el, byId: byId) else { continue }
                b = CGRect(x: min(s.from.x, s.to.x), y: min(s.from.y, s.to.y), width: abs(s.to.x - s.from.x), height: abs(s.to.y - s.from.y))
            } else {
                b = el.box
            }
            r = r.map { $0.union(b) } ?? b
        }
        return r
    }

    /// Topmost element under a point, for taps: shapes and text first (highest zIndex), then connectors.
    static func hit(_ point: CGPoint, in elements: [DiagramElement], tolerance: CGFloat = 8) -> DiagramElement? {
        let byId = Dictionary(elements.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for el in elements.filter({ $0.type != .connector }).sorted(by: { $0.zIndex > $1.zIndex }) where el.box.insetBy(dx: -4, dy: -4).contains(point) {
            // Groups are hit only near their border, so shapes inside them stay selectable.
            if el.type == .group && el.box.insetBy(dx: 14, dy: 14).contains(point) { continue }
            return el
        }
        for el in elements where el.type == .connector {
            if let s = segment(el, byId: byId), distance(point, s) <= tolerance { return el }
        }
        return nil
    }

    static func distance(_ p: CGPoint, _ s: Segment) -> CGFloat {
        let dx = s.to.x - s.from.x, dy = s.to.y - s.from.y
        let len2 = dx * dx + dy * dy
        guard len2 > 0 else { return hypot(p.x - s.from.x, p.y - s.from.y) }
        let t = max(0, min(1, ((p.x - s.from.x) * dx + (p.y - s.from.y) * dy) / len2))
        return hypot(p.x - (s.from.x + t * dx), p.y - (s.from.y + t * dy))
    }
}

// MARK: - Label wrapping (text.ts)

struct WrappedLabel {
    var lines: [String]
    var fontSize: CGFloat
    var lineHeight: CGFloat
    func lineY(_ cy: CGFloat, _ i: Int) -> CGFloat { cy + (CGFloat(i) - CGFloat(lines.count - 1) / 2) * lineHeight }
}

enum LabelWrap {
    static func wrap(_ text: String, width: CGFloat, height: CGFloat, ellipse: Bool) -> WrappedLabel {
        let box = ellipse ? CGSize(width: width * 0.7 - 8, height: height * 0.7 - 4) : CGSize(width: width - 16, height: height - 10)
        var fallback: WrappedLabel?
        for size in stride(from: 13, through: 9, by: -1) {
            let fs = CGFloat(size)
            let maxChars = max(1, Int(box.width / (fs * 0.56)))
            let lines = wrapAt(text.trimmingCharacters(in: .whitespacesAndNewlines), maxChars)
            let lh = fs * 1.25
            if CGFloat(lines.count) * lh <= box.height || lines.count == 1 { return WrappedLabel(lines: lines, fontSize: fs, lineHeight: lh) }
            fallback = WrappedLabel(lines: lines, fontSize: fs, lineHeight: lh)
        }
        var f = fallback!
        let maxLines = max(1, Int(box.height / f.lineHeight))
        let maxChars = max(1, Int(box.width / (f.fontSize * 0.56)))
        f.lines = Array(f.lines.prefix(maxLines))
        let last = f.lines[maxLines - 1]
        f.lines[maxLines - 1] = String(last.prefix(max(0, maxChars - 1))).trimmingCharacters(in: .whitespaces) + "…"
        return f
    }

    private static func wrapAt(_ text: String, _ maxChars: Int) -> [String] {
        var lines: [String] = []
        for paragraph in text.components(separatedBy: "\n") {
            var line = ""
            for w in paragraph.split(whereSeparator: \.isWhitespace) {
                var word = String(w)
                while word.count > maxChars {
                    if !line.isEmpty { lines.append(line); line = "" }
                    lines.append(String(word.prefix(maxChars)))
                    word = String(word.dropFirst(maxChars))
                }
                if line.isEmpty { line = word }
                else if line.count + 1 + word.count <= maxChars { line += " " + word }
                else { lines.append(line); line = word }
            }
            lines.append(line)
        }
        return lines
    }
}

// MARK: - Palette (DARK_PALETTE / shapeColors in render.ts)

struct DiagramPalette {
    var canvas: Color, dot: Color, ink: Color, muted: Color, connector: Color, group: Color, accent: Color, halo: Color
    var dark: Bool

    static let dark = DiagramPalette(canvas: Color(hex: 0x0D0D0F), dot: Color(hex: 0x26262B), ink: Color(hex: 0xEDEDEF), muted: Color(hex: 0x85858E),
                                     connector: Color(hex: 0x8A8A94), group: Color(hex: 0x55555E), accent: Color(hex: 0x8E98FF), halo: Color(hex: 0x0D0D0F), dark: true)
    static let light = DiagramPalette(canvas: .white, dot: Color(hex: 0xC7CEDB), ink: Color(hex: 0x0F172A), muted: Color(hex: 0x64748B),
                                      connector: Color(hex: 0x475569), group: Color(hex: 0x94A3B8), accent: Color(hex: 0x2563EB), halo: .white, dark: false)

    private static let darkFills: [String: UInt32] = [
        "#ffffff": 0x1C1C20, "#fff": 0x1C1C20, "#eff6ff": 0x1A2040, "#f0fdf4": 0x12291F, "#fef2f2": 0x331A1C, "#faf5ff": 0x261D3D, "#f8fafc": 0x202024,
    ]
    private static let darkStrokes: [String: UInt32] = [
        "#2563eb": 0x8E98FF, "#2b50e8": 0x8E98FF, "#16a34a": 0x4CC79D, "#dc2626": 0xF2786D, "#7c3aed": 0xB197FC, "#475569": 0x8A8A94, "#1f2937": 0x6B6B75, "#0f172a": 0x9A9AA4,
    ]

    private static func isLight(_ css: String) -> Bool {
        var h = css.trimmingCharacters(in: .whitespaces).lowercased()
        guard h.hasPrefix("#") else { return true }
        h.removeFirst()
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count >= 6, let v = UInt32(h.prefix(6), radix: 16) else { return true }
        let r = Double((v >> 16) & 0xFF), g = Double((v >> 8) & 0xFF), b = Double(v & 0xFF)
        return 0.299 * r + 0.587 * g + 0.114 * b > 150
    }

    /// Fill, stroke and label colour for a shape.
    func shape(fill: String?, stroke: String?) -> (fill: Color, stroke: Color, text: Color) {
        let f = (fill ?? "#ffffff").lowercased(), s = (stroke ?? "#1f2937").lowercased()
        guard dark else { return (Color(css: f) ?? .white, Color(css: s) ?? Color(hex: 0x1F2937), DiagramPalette.light.ink) }
        let strokeColor = DiagramPalette.darkStrokes[s].map { Color(hex: $0) } ?? Color(css: s) ?? connector
        if let df = DiagramPalette.darkFills[f] { return (Color(hex: df), strokeColor, ink) }
        return (Color(css: f) ?? Color(hex: 0x1C1C20), strokeColor, DiagramPalette.isLight(f) ? DiagramPalette.light.ink : ink)
    }

    /// Colour for free text or a connector stroke.
    func ink(_ value: String?, fallback: Color? = nil) -> Color {
        guard let v = value?.lowercased() else { return fallback ?? ink }
        guard dark else { return Color(css: v) ?? fallback ?? ink }
        if v == "#0f172a" || v == "#1f2937" { return ink }
        return DiagramPalette.darkStrokes[v].map { Color(hex: $0) } ?? Color(css: v) ?? fallback ?? ink
    }
}

/// The swatches the inspector offers (light-sheet values, as stored; drawn through the palette).
let shapeSwatches: [(name: String, fill: String, stroke: String)] = [
    ("Blue", "#eff6ff", "#2563eb"), ("Green", "#f0fdf4", "#16a34a"), ("Red", "#fef2f2", "#dc2626"),
    ("Purple", "#faf5ff", "#7c3aed"), ("Grey", "#f8fafc", "#475569"), ("Plain", "#ffffff", "#0f172a"),
]
