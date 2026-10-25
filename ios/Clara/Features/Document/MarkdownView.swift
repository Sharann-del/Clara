import SwiftUI

/// Renders markdown natively from marked's GFM tokens (see shared-bridge.ts). Raw HTML shows as
/// text and only safe links are live, as on the web; ```clara-diagram blocks become live diagrams.
struct MarkdownView: View {
    let markdown: String
    var fontSize: CGFloat = 17
    @State private var blocks: [MDBlock] = []
    @Environment(AppModel.self) private var model
    @Environment(\.siteOpen) private var siteOpen
    @Environment(AuthStore.self) private var auth

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, b in
                MDBlockView(block: b, fontSize: fontSize)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
        .environment(\.openURL, OpenURLAction { url in
            // Links to other Clara pages open in the app.
            let parts = url.path.split(separator: "/").map(String.init)
            if url.host == nil || url.absoluteString.hasPrefix(ClaraConfig.shared.siteUrl ?? "~") {
                if parts.count >= 2, parts[0] == "documents" { model.open(.document(parts[1])); return .handled }
                if parts.count >= 2, parts[0] == "diagrams" { model.open(.diagram(parts[1])); return .handled }
                if let r = SiteRoute(path: url.path), let siteOpen { siteOpen(r); return .handled }
                if parts.first == "settings", auth.isSignedIn {
                    model.go(parts.count > 1 && parts[1] == "tokens" ? .tokens : .settings)
                    return .handled
                }
            }
            return .systemAction
        })
        .task(id: markdown) { blocks = SharedJS.shared.markdown(markdown) }
    }
}

struct MDBlockView: View {
    let block: MDBlock
    var fontSize: CGFloat

    var body: some View {
        switch block {
        case .heading(let depth, let runs):
            Text(MDInline.attributed(runs, size: headingSize(depth), base: .bold, display: true))
                .tracking(depth <= 2 ? -0.4 : -0.2)
                .padding(.top, depth <= 2 ? 14 : 8)
                .fixedSize(horizontal: false, vertical: true)
        case .paragraph(let runs):
            paragraph(runs)
        case .code(let lang, let text) where lang == "clara-example":
            ExampleDiagram(id: text.trimmingCharacters(in: .whitespacesAndNewlines))
        case .code(let lang, let text):
            VStack(alignment: .leading, spacing: 6) {
                if !lang.isEmpty { Text(lang).font(ClaraFont.mono(11)).foregroundStyle(Theme.muted) }
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(text).font(ClaraFont.mono(fontSize - 3.5)).foregroundStyle(Theme.ink).lineSpacing(3).fixedSize()
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.paper, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
        case .embed(let id, let height):
            DiagramEmbedView(diagramId: id, height: CGFloat(height ?? 320))
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Group {
                            if item.task {
                                Image(systemName: item.checked ? "checkmark.square.fill" : "square").foregroundStyle(item.checked ? Theme.cobalt : Theme.muted)
                            } else if ordered {
                                Text("\(start + i).").monospacedDigit().foregroundStyle(Theme.muted)
                            } else {
                                Circle().fill(Theme.muted).frame(width: 5, height: 5).offset(y: -3)
                            }
                        }
                        .font(ClaraFont.body(fontSize))
                        .frame(minWidth: 16, alignment: .trailing)
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(item.blocks.enumerated()), id: \.offset) { _, b in MDBlockView(block: b, fontSize: fontSize) }
                        }
                        .strikethrough(item.task && item.checked, color: Theme.muted)
                    }
                }
            }
        case .quote(let blocks):
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(blocks.enumerated()), id: \.offset) { _, b in MDBlockView(block: b, fontSize: fontSize - 0.5) }
            }
            .foregroundStyle(Theme.ink2)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
        case .table(let align, let header, let rows):
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 2, verticalSpacing: 2) {
                    GridRow {
                        ForEach(Array(header.enumerated()), id: \.offset) { i, cell in tableCell(cell, header: true, align: align[safe: i] ?? nil) }
                    }
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { i, cell in tableCell(cell, header: false, align: align[safe: i] ?? nil) }
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
            }
        case .rule:
            Rectangle().fill(Theme.surface3).frame(height: 2).padding(.vertical, 8)
        case .text(let t):
            Text(t).font(ClaraFont.body(fontSize)).foregroundStyle(Theme.ink)
        }
    }

    private func headingSize(_ depth: Int) -> CGFloat {
        switch depth { case 1: 28; case 2: 23; case 3: 19.5; default: 17.5 }
    }

    /// Text runs; images split the paragraph into text and picture blocks.
    @ViewBuilder private func paragraph(_ runs: [MDRun]) -> some View {
        let chunks = runs.split(whereSeparator: { $0.t == "image" }).map(Array.init)
        let images = runs.filter { $0.t == "image" }
        if images.isEmpty {
            Text(MDInline.attributed(runs, size: fontSize)).lineSpacing(fontSize * 0.32).fixedSize(horizontal: false, vertical: true)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(chunks.enumerated()), id: \.offset) { _, c in
                    Text(MDInline.attributed(c, size: fontSize)).lineSpacing(fontSize * 0.32)
                }
                ForEach(Array(images.enumerated()), id: \.offset) { _, img in MDImage(run: img) }
            }
        }
    }

    private func tableCell(_ runs: [MDRun], header: Bool, align: String?) -> some View {
        Text(MDInline.attributed(runs, size: fontSize - 2, base: header ? .semibold : .regular))
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: align == "center" ? .center : align == "right" ? .trailing : .leading)
            .background(header ? Theme.surface3 : Theme.surface2)
    }
}

private struct MDImage: View {
    let run: MDRun
    var body: some View {
        if let src = run.src, src.hasPrefix("https://") || src.hasPrefix("http://"), let url = URL(string: src) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let img): img.resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: Theme.rSm, style: .continuous))
                case .failure: Text(run.alt ?? "Image").font(ClaraFont.body(14)).foregroundStyle(Theme.muted)
                default: RoundedRectangle(cornerRadius: Theme.rSm).fill(Theme.surface2).frame(height: 160)
                }
            }
            .accessibilityLabel(run.alt ?? "Image")
        } else {
            Text(run.alt ?? "").font(ClaraFont.body(14)).foregroundStyle(Theme.muted)
        }
    }
}

enum MDInline {
    static func attributed(_ runs: [MDRun], size: CGFloat, base: Font.Weight = .regular, display: Bool = false) -> AttributedString {
        var out = AttributedString()
        for r in runs {
            if r.t == "br" { out += AttributedString("\n"); continue }
            guard r.t == "text", let v = r.v else { continue }
            var a = AttributedString(v)
            let weight: Font.Weight = r.b != nil ? .bold : base
            var font = r.code != nil ? ClaraFont.mono(size * 0.88) : (display ? ClaraFont.display(size, weight: weight) : ClaraFont.body(size, weight: weight))
            if r.i != nil { font = font.italic() }
            a.font = font
            a.foregroundColor = Theme.ink
            if r.code != nil { a.backgroundColor = Theme.surface3 }
            if r.s != nil { a.strikethroughStyle = .single }
            if let href = r.href, let url = URL(string: href) {
                a.link = url
                a.foregroundColor = Theme.cobalt
                a.underlineStyle = .single
            }
            out += a
        }
        return out
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

/// A live diagram inside a document (`.embed-card`): header with the name, pan/zoom view below.
struct DiagramEmbedView: View {
    let diagramId: String
    var height: CGFloat = 320
    @Environment(APIClient.self) private var api
    @Environment(AppModel.self) private var model
    @State private var diagram: DiagramFull?
    @State private var failed = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "point.3.connected.trianglepath.dotted").foregroundStyle(Theme.green)
                Text(diagram?.name ?? (failed ? "Diagram unavailable" : "Loading diagram…")).font(ClaraFont.body(14, weight: .semibold)).foregroundStyle(Theme.ink2).lineLimit(1)
                Spacer()
                if diagram != nil {
                    Button { model.open(.diagram(diagramId)) } label: { Label("Open", systemImage: "arrow.up.right").font(ClaraFont.body(13.5, weight: .medium)) }
                        .buttonStyle(.clara(.ghost, small: true))
                }
            }
            .padding(.leading, 12).padding(.trailing, 4).frame(height: 42)
            .background(Theme.surface2)
            Group {
                if let diagram {
                    DiagramViewer(elements: States.resolve(diagram.elements, nil), inline: true) { model.open(.diagram($0)) }
                } else if failed {
                    Text("You may not have access to this diagram, or it was deleted.").font(ClaraFont.body(14)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    Spinner().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(height: height)
            .background(Theme.canvas)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
        .task(id: diagramId) {
            do {
                diagram = try await api.diagram(diagramId)
            } catch { failed = true }
        }
    }
}

/// A diagram from the playground examples, drawn live (the About page's architecture diagram).
private struct ExampleDiagram: View {
    let id: String
    @State private var elements: [Resolved] = []
    var body: some View {
        DiagramViewer(elements: elements, inline: true)
            .frame(height: 380)
            .clipShape(RoundedRectangle(cornerRadius: Theme.rLg, style: .continuous))
            .task {
                guard let ex = SiteContent.shared.examples.first(where: { $0.id == id }) else { return }
                elements = SharedJS.shared.compile(ex.code, format: ex.format).elements.map { Resolved(element: $0, hidden: false) }
            }
    }
}
