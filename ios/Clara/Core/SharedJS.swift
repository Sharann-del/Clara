import Foundation
import JavaScriptCore

/// Runs the bundled @clara/shared code (Resources/clara-shared.js, built by
/// ios/scripts/build-shared-js.sh) in JavaScriptCore, so DSL/Mermaid parsing, Dagre layout,
/// diffing and markdown tokenizing behave exactly as on the web and the API.
final class SharedJS {
    static let shared = SharedJS()
    private let context: JSContext
    private let clara: JSValue

    private init() {
        context = JSContext()!
        context.exceptionHandler = { _, exc in print("[clara-shared] \(exc?.toString() ?? "?")") }
        // JavaScriptCore has no Web Crypto; the layout code only needs randomUUID.
        let uuid: @convention(block) () -> String = { UUID().uuidString.lowercased() }
        let crypto = JSValue(newObjectIn: context)!
        crypto.setObject(uuid, forKeyedSubscript: "randomUUID" as NSString)
        context.setObject(crypto, forKeyedSubscript: "crypto" as NSString)
        let url = Bundle.main.url(forResource: "clara-shared", withExtension: "js")!
        context.evaluateScript(try! String(contentsOf: url, encoding: .utf8))
        clara = context.objectForKeyedSubscript("Clara")
    }

    fileprivate func invoke(_ fn: String, _ args: [Any]) -> String { call(fn, args) }

    private func call(_ fn: String, _ args: [Any]) -> String {
        clara.invokeMethod(fn, withArguments: args)?.toString() ?? ""
    }

    struct Issue: Decodable, Hashable { let line: Int; let message: String }
    struct Compiled: Decodable {
        let elements: [DiagramElement]
        let nodeCount: Int
        let edgeCount: Int
        let issues: [Issue]

        /// "3 nodes · 2 edges", or the first parse problem (describeCompile on the web).
        var summary: String {
            let base = "\(nodeCount) node\(nodeCount == 1 ? "" : "s") · \(edgeCount) edge\(edgeCount == 1 ? "" : "s")"
            guard let first = issues.first else { return base }
            return "Line \(first.line): \(first.message)\(issues.count > 1 ? " (+\(issues.count - 1) more)" : "")"
        }
    }

    /// Clara DSL or Mermaid text → laid-out canvas elements.
    func compile(_ code: String, format: String) -> Compiled {
        (try? JSON.decode(Compiled.self, from: call("compile", [code, format]))) ?? Compiled(elements: [], nodeCount: 0, edgeCount: 0, issues: [])
    }

    func toMermaid(_ elements: [DiagramElement]) -> String { call("toMermaid", [JSON.string(elements)]) }

    /// Standalone SVG on the light sheet, identical to the web export.
    func svg(_ elements: [DiagramElement]) -> String { call("renderSvg", [JSON.string(elements)]) }

    struct Changed: Decodable, Hashable { let id: String; let before: DiagramElement; let after: DiagramElement; let fields: [String] }
    struct ElementDiff: Decodable { let added: [DiagramElement]; let removed: [DiagramElement]; let changed: [Changed]; let unchangedCount: Int }

    func diff(current: [DiagramElement], proposed: [DiagramElement]) -> ElementDiff {
        (try? JSON.decode(ElementDiff.self, from: call("diffElements", [JSON.string(current), JSON.string(proposed)])))
            ?? ElementDiff(added: [], removed: [], changed: [], unchangedCount: 0)
    }

    func describe(_ el: DiagramElement) -> String { call("describeElement", [JSON.string(el)]) }

    func markdown(_ md: String) -> [MDBlock] { (try? JSON.decode([MDBlock].self, from: call("markdown", [md]))) ?? [] }

    func embedBlock(id: String, height: Int? = nil) -> String { call("embedBlock", [id, height ?? 0]) }
}

// MARK: - Markdown AST (see ios/scripts/shared-bridge.ts)

struct MDRun: Decodable, Hashable {
    let t: String
    var v: String?
    var b: Int?
    var i: Int?
    var s: Int?
    var code: Int?
    var href: String?
    var src: String?
    var alt: String?
}

struct MDListItem: Decodable, Hashable {
    let task: Bool
    let checked: Bool
    let blocks: [MDBlock]
}

indirect enum MDBlock: Decodable, Hashable {
    case heading(Int, [MDRun])
    case paragraph([MDRun])
    case code(String, String)
    case embed(String, Int?)
    case list(ordered: Bool, start: Int, items: [MDListItem])
    case quote([MDBlock])
    case table(align: [String?], header: [[MDRun]], rows: [[[MDRun]]])
    case rule
    case text(String)

    private enum K: String, CodingKey { case t, depth, inline, lang, text, id, height, ordered, start, items, blocks, align, header, rows, v }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        switch try c.decode(String.self, forKey: .t) {
        case "heading": self = .heading(try c.decode(Int.self, forKey: .depth), try c.decode([MDRun].self, forKey: .inline))
        case "paragraph": self = .paragraph(try c.decode([MDRun].self, forKey: .inline))
        case "code": self = .code(try c.decode(String.self, forKey: .lang), try c.decode(String.self, forKey: .text))
        case "embed": self = .embed(try c.decode(String.self, forKey: .id), try c.decodeIfPresent(Int.self, forKey: .height))
        case "list": self = .list(ordered: try c.decode(Bool.self, forKey: .ordered), start: try c.decode(Int.self, forKey: .start), items: try c.decode([MDListItem].self, forKey: .items))
        case "blockquote": self = .quote(try c.decode([MDBlock].self, forKey: .blocks))
        case "table": self = .table(align: try c.decode([String?].self, forKey: .align), header: try c.decode([[MDRun]].self, forKey: .header), rows: try c.decode([[[MDRun]]].self, forKey: .rows))
        case "hr": self = .rule
        default: self = .text((try? c.decode(String.self, forKey: .v)) ?? "")
        }
    }
}

// MARK: - Time

/// "3 minutes ago", "yesterday", or a date for anything older than a week (time.ts).
func timeAgo(_ iso: String?, now: Date = Date()) -> String {
    guard let iso, let date = parseISO(iso) else { return "" }
    let s = date.timeIntervalSince(now)
    let abs = Swift.abs(s)
    if abs < 45 { return "just now" }
    if abs < 7 * 86400 {
        let f = RelativeDateTimeFormatter()
        f.dateTimeStyle = .named
        f.unitsStyle = .full
        if abs < 3600 { return f.localizedString(from: DateComponents(minute: Int((s / 60).rounded()))) }
        if abs < 86400 { return f.localizedString(from: DateComponents(hour: Int((s / 3600).rounded()))) }
        return f.localizedString(from: DateComponents(day: Int((s / 86400).rounded())))
    }
    return date.formatted(.dateTime.day().month(.abbreviated).year(abs > 300 * 86400 ? .defaultDigits : .omitted))
}

func parseISO(_ iso: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: iso) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: iso)
}

func fullDate(_ iso: String) -> String {
    parseISO(iso)?.formatted(date: .abbreviated, time: .shortened) ?? iso
}

extension SharedJS {
    struct DiffPart: Decodable, Hashable { let op: String; let lines: [String] }

    /// Line-level diff of two texts (the `diff` package).
    func lineDiff(_ before: String, _ after: String) -> [DiffPart] {
        (try? JSON.decode([DiffPart].self, from: invoke("lineDiff", [before, after]))) ?? []
    }
}
