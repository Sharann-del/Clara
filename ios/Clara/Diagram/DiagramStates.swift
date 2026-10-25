import SwiftUI

/// An element with a state's overrides applied. Hidden elements are kept so the editor can ghost them.
struct Resolved: Identifiable, Hashable {
    var element: DiagramElement
    var hidden: Bool
    var id: String { element.id }
}

/// Port of packages/frontend/src/lib/states.ts.
enum States {
    /// Applies one state's overrides (or none, for Base). Elements flagged `style.baseHidden` exist
    /// only in states that un-hide them; a connector can't outlive an endpoint that is hidden.
    static func resolve(_ base: [DiagramElement], _ state: DiagramState?) -> [Resolved] {
        let ov = state?.element_overrides ?? [:]
        var out = base.map { el -> Resolved in
            let o = ov[el.id]
            guard o != nil || el.baseHidden else { return Resolved(element: el, hidden: false) }
            var e = el
            if let g = o?.geometry { e.geometry.merge(g) { _, new in new } }
            if let s = o?.style { e.style.merge(s) { _, new in new } }
            return Resolved(element: e, hidden: o?.hidden ?? el.baseHidden)
        }
        let hiddenIds = Set(out.filter(\.hidden).map(\.id))
        for i in out.indices where out[i].element.type == .connector {
            if let f = out[i].element.fromId, hiddenIds.contains(f) { out[i].hidden = true }
            if let t = out[i].element.toId, hiddenIds.contains(t) { out[i].hidden = true }
        }
        return out
    }

    /// Only the keys of `patch` whose values differ from `base`.
    private static func diffKeys(_ base: JSONObject, _ patch: JSONObject) -> JSONObject? {
        let out = patch.filter { base[$0.key] != $0.value }
        return out.isEmpty ? nil : out
    }

    /// Merges an edit made while a state is selected into that element's override; nil = clear it.
    static func mergeOverride(base: DiagramElement, existing: ElementOverride?, geometry: JSONObject? = nil, style: JSONObject? = nil, hidden: Bool? = nil) -> ElementOverride? {
        var next = existing ?? ElementOverride()
        if let geometry { next.geometry = diffKeys(base.geometry, (existing?.geometry ?? [:]).merging(geometry) { _, n in n }) }
        if let style { next.style = diffKeys(base.style, (existing?.style ?? [:]).merging(style) { _, n in n }) }
        if let hidden { next.hidden = hidden == base.baseHidden ? nil : hidden }
        return next.isEmpty ? nil : next
    }
}

// MARK: - Present mode interpolation

struct RenderFrame: Identifiable {
    var element: DiagramElement
    var rect: CGRect
    var opacity: Double
    var fill: String?
    var stroke: String?
    var id: String { element.id }

    init(_ r: Resolved) {
        element = r.element
        rect = r.element.box
        if r.element.type == .text { rect.origin.y += r.element.style.num("fontSize", 14) } // keep the baseline origin
        opacity = r.hidden ? 0 : 1
        fill = r.element.style.str("fill")
        stroke = r.element.style.str("stroke")
    }

    /// The frame as a drawable element (geometry rewritten to the interpolated rect).
    var drawable: DiagramElement {
        var e = element
        e.geometry["x"] = .number(rect.origin.x)
        e.geometry["y"] = .number(rect.origin.y)
        if e.type != .text {
            e.geometry["width"] = .number(rect.width)
            e.geometry["height"] = .number(rect.height)
        }
        if let fill { e.style["fill"] = .string(fill) }
        if let stroke { e.style["stroke"] = .string(stroke) }
        return e
    }

    static func easeInOut(_ t: Double) -> Double { t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2 }

    /// Blends two resolved states (matched by element id) at progress t ∈ [0, 1].
    static func interpolate(_ from: [RenderFrame], _ to: [RenderFrame], _ t: Double) -> [RenderFrame] {
        let fromById = Dictionary(from.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return to.map { b in
            let a = fromById[b.id] ?? b
            var out = b
            let l = { (x: CGFloat, y: CGFloat) in x + (y - x) * t }
            out.rect = CGRect(x: l(a.rect.minX, b.rect.minX), y: l(a.rect.minY, b.rect.minY), width: l(a.rect.width, b.rect.width), height: l(a.rect.height, b.rect.height))
            out.opacity = a.opacity + (b.opacity - a.opacity) * t
            out.fill = lerpColor(a.fill, b.fill, t)
            out.stroke = lerpColor(a.stroke, b.stroke, t)
            return out
        }
    }

    private static func lerpColor(_ a: String?, _ b: String?, _ t: Double) -> String? {
        func rgb(_ c: String?) -> [Double]? {
            guard let c, c.count == 7, c.hasPrefix("#"), let v = UInt32(c.dropFirst(), radix: 16) else { return nil }
            return [Double((v >> 16) & 0xFF), Double((v >> 8) & 0xFF), Double(v & 0xFF)]
        }
        guard let ca = rgb(a), let cb = rgb(b) else { return t < 0.5 ? a : b }
        let c = zip(ca, cb).map { Int(($0 + ($1 - $0) * t).rounded()) }
        return String(format: "#%02x%02x%02x", c[0], c[1], c[2])
    }
}
