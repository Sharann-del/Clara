import SwiftUI
import Compression

/// The public site's pages, inside the app. Content comes from Resources/site-content.json,
/// exported from the live site by ios/scripts/export-site-content.mjs, so both say the same thing.
struct SiteContent: Decodable {
    struct DocSection: Decodable, Identifiable { let slug: String; let title: String; let description: String; let markdown: String; var id: String { slug } }
    struct LongPage: Decodable { let title: String; let subtitle: String; let markdown: String }
    struct Pricing: Decodable {
        let title, subtitle, plan, price, per: String
        let included: [String]
        let laterTitle, later, limitsTitle: String
        let limits: [[String]]
    }
    struct Example: Decodable, Identifiable { let id: String; let title: String; let blurb: String; let format: String; let code: String }

    let docs: [DocSection]
    let about: LongPage
    let privacy: LongPage
    let terms: LongPage
    let pricing: Pricing
    let examples: [Example]

    static let shared: SiteContent = {
        let url = Bundle.main.url(forResource: "site-content", withExtension: "json")!
        return try! JSONDecoder().decode(SiteContent.self, from: Data(contentsOf: url))
    }()
}

enum SiteRoute: Hashable {
    case docs(String)
    case pricing, about, privacy, terms
    case playground
    case signIn, signUp

    /// Site paths used in links inside the content (`/docs/dsl`, `/editor`, …).
    init?(path: String) {
        let parts = path.split(separator: "/").map(String.init)
        switch parts.first {
        case "docs": self = .docs(parts.count > 1 ? parts[1] : SiteContent.shared.docs.first?.slug ?? "getting-started")
        case "editor": self = .playground
        case "pricing": self = .pricing
        case "about": self = .about
        case "privacy": self = .privacy
        case "terms": self = .terms
        case "signin": self = .signIn
        case "signup": self = .signUp
        default: return nil
        }
    }
}

private struct SiteOpenKey: EnvironmentKey { static let defaultValue: ((SiteRoute) -> Void)? = nil }
extension EnvironmentValues {
    /// How this part of the app opens a site page (pushed in the app, or in the signed-out stack).
    var siteOpen: ((SiteRoute) -> Void)? {
        get { self[SiteOpenKey.self] }
        set { self[SiteOpenKey.self] = newValue }
    }
}

/// Renders a site route as its page.
struct SitePage: View {
    let route: SiteRoute
    var body: some View {
        switch route {
        case .docs(let slug): DocsView(slug: slug)
        case .pricing: PricingView()
        case .about: LongformView(page: SiteContent.shared.about, title: "About")
        case .privacy: LongformView(page: SiteContent.shared.privacy, title: "Privacy")
        case .terms: LongformView(page: SiteContent.shared.terms, title: "Terms")
        case .playground: PlaygroundView()
        case .signIn, .signUp: EmptyView()
        }
    }
}

/// Links to every site page (the site header + footer).
@MenuBuilder func siteMenuEntries(_ open: @escaping (SiteRoute) -> Void) -> [ClaraMenuEntry] {
    ClaraMenuEntry.action("Playground", "chevron.left.forwardslash.chevron.right") { open(.playground) }
    ClaraMenuEntry.action("Docs", "book") { open(.docs(SiteContent.shared.docs.first?.slug ?? "getting-started")) }
    ClaraMenuEntry.action("Pricing", "tag") { open(.pricing) }
    ClaraMenuEntry.action("About", "info.circle") { open(.about) }
    ClaraMenuEntry.divider
    ClaraMenuEntry.action("Privacy", "hand.raised") { open(.privacy) }
    ClaraMenuEntry.action("Terms", "doc.plaintext") { open(.terms) }
}

// MARK: - Docs

struct DocsView: View {
    @State var slug: String
    @Environment(\.horizontalSizeClass) private var hSize
    private var sections: [SiteContent.DocSection] { SiteContent.shared.docs }
    private var current: SiteContent.DocSection? { sections.first { $0.slug == slug } ?? sections.first }

    var body: some View {
        ScrollViewReader { proxy in
            PageScroll {
                Color.clear.frame(height: 0).id("top")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(sections) { s in
                            Button { go(s.slug, proxy) } label: {
                                Text(s.title).font(ClaraFont.body(14.5, weight: s.slug == current?.slug ? .semibold : .regular))
                                    .foregroundStyle(s.slug == current?.slug ? Theme.cobaltInk : Theme.ink2)
                                    .padding(.horizontal, 12).frame(height: 34)
                                    .background(s.slug == current?.slug ? Theme.cobaltSoft : Theme.surface, in: Capsule())
                            }
                            .buttonStyle(PressScale())
                        }
                    }
                }
                if let c = current {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(c.title).font(ClaraFont.display(32, weight: .bold)).tracking(-1).foregroundStyle(Theme.ink)
                        if !c.description.isEmpty { Text(c.description).font(ClaraFont.body(18)).lineSpacing(4).foregroundStyle(Theme.ink2) }
                    }
                    .padding(.top, 12)
                    .id(c.slug)
                    .transition(.opacity)
                    MarkdownView(markdown: c.markdown)
                    pager(c, proxy)
                }
            }
        }
        .claraTopBar("Docs")
        .animation(Theme.med, value: slug)
    }

    private func go(_ s: String, _ proxy: ScrollViewProxy) {
        slug = s
        withAnimation(Theme.easeOut) { proxy.scrollTo("top", anchor: .top) }
    }

    private func pager(_ c: SiteContent.DocSection, _ proxy: ScrollViewProxy) -> some View {
        let i = sections.firstIndex { $0.slug == c.slug } ?? 0
        // Equal halves, both as tall as the taller card.
        return HStack(alignment: .top, spacing: 10) {
            if i > 0 { pagerLink(sections[i - 1], label: "Previous", leading: true, proxy) } else { Color.clear.frame(maxWidth: .infinity) }
            if i < sections.count - 1 { pagerLink(sections[i + 1], label: "Next", leading: false, proxy) } else { Color.clear.frame(maxWidth: .infinity) }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 28)
    }

    private func pagerLink(_ s: SiteContent.DocSection, label: String, leading: Bool, _ proxy: ScrollViewProxy) -> some View {
        Button { go(s.slug, proxy) } label: {
            VStack(alignment: leading ? .leading : .trailing, spacing: 3) {
                Text(label).font(ClaraFont.body(13)).foregroundStyle(Theme.muted)
                Text(s.title).font(ClaraFont.body(16, weight: .semibold)).foregroundStyle(Theme.cobalt).multilineTextAlignment(leading ? .leading : .trailing)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: leading ? .topLeading : .topTrailing)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
        }
        .buttonStyle(LiftPress())
    }
}

// MARK: - About, Privacy, Terms

struct LongformView: View {
    let page: SiteContent.LongPage
    let title: String
    var body: some View {
        PageScroll {
            VStack(alignment: .leading, spacing: 10) {
                Text(page.title).font(ClaraFont.display(36, weight: .bold)).tracking(-1.2).foregroundStyle(Theme.ink)
                if !page.subtitle.isEmpty { Text(page.subtitle).font(ClaraFont.body(15)).foregroundStyle(Theme.muted) }
            }
            .padding(.top, 8).padding(.bottom, 8)
            MarkdownView(markdown: page.markdown)
        }
        .claraTopBar(title)
    }
}

// MARK: - Pricing

struct PricingView: View {
    @Environment(\.siteOpen) private var siteOpen
    @Environment(AuthStore.self) private var auth
    @Environment(\.horizontalSizeClass) private var hSize
    private let p = SiteContent.shared.pricing

    var body: some View {
        PageScroll {
            VStack(alignment: .leading, spacing: 12) {
                Text("price: 0").font(ClaraFont.mono(13)).foregroundStyle(Theme.cobalt).padding(.horizontal, 8).padding(.vertical, 3).background(Theme.cobaltSoft, in: RoundedRectangle(cornerRadius: Theme.rSm))
                Text(p.title).font(ClaraFont.display(36, weight: .bold)).tracking(-1.2).foregroundStyle(Theme.ink)
                Text(p.subtitle).font(ClaraFont.body(18)).lineSpacing(4).foregroundStyle(Theme.ink2)
            }
            .padding(.top, 8)
            let layout = hSize == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(spacing: 16))
            layout {
                Card(background: Theme.cobaltSoft, padding: 24) {
                    Text(p.plan).font(ClaraFont.display(20, weight: .bold)).foregroundStyle(Theme.ink)
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(p.price).font(ClaraFont.display(42, weight: .heavy)).tracking(-1.4).foregroundStyle(Theme.ink)
                        Text(p.per).font(ClaraFont.body(14)).foregroundStyle(Theme.muted)
                    }
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach(p.included, id: \.self) { f in
                            HStack(alignment: .firstTextBaseline, spacing: 9) {
                                Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.green)
                                Text(f).font(ClaraFont.body(15.5)).foregroundStyle(Theme.ink2)
                            }
                        }
                    }
                    if !auth.isSignedIn {
                        HStack {
                            Button("Create a free account") { siteOpen?(.signUp) }.buttonStyle(.claraPrimary)
                            Button("Try without an account") { siteOpen?(.playground) }.buttonStyle(.claraSecondary)
                        }
                        .padding(.top, 6)
                    }
                }
                .frame(maxWidth: .infinity)
                Card(padding: 24) {
                    Text(p.laterTitle).font(ClaraFont.display(20, weight: .bold)).foregroundStyle(Theme.ink)
                    MarkdownView(markdown: p.later, fontSize: 16)
                }
                .frame(maxWidth: .infinity)
            }
            .padding(.top, 8)
            SectionHeader(title: p.limitsTitle)
            VStack(spacing: 3) {
                ForEach(p.limits, id: \.self) { row in
                    let layout = hSize == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                    layout {
                        Text(row.first ?? "").font(ClaraFont.body(15, weight: .semibold)).foregroundStyle(Theme.ink2).frame(maxWidth: hSize == .regular ? 320 : .infinity, alignment: .leading)
                        Text(row.last ?? "").font(ClaraFont.body(15)).foregroundStyle(Theme.ink).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 12)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
                }
            }
        }
        .claraTopBar("Pricing")
    }
}

// MARK: - Playground

/// Diagram code in, diagram out, no account needed (PlaygroundPage.tsx): examples, Clara DSL or
/// Mermaid, live preview, export, share links that carry the diagram, and Save to Clara.
struct PlaygroundView: View {
    @Environment(\.siteOpen) private var siteOpen
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.horizontalSizeClass) private var hSize

    @AppStorage("clara.playground.code") private var code = SiteContent.shared.examples.first?.code ?? ""
    @AppStorage("clara.playground.format") private var format = SiteContent.shared.examples.first?.format ?? "clara"
    @State private var name = "Untitled diagram"
    @State private var compiled: SharedJS.Compiled?
    @State private var tab = "code"
    @State private var saving = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                ClaraMenu("Examples") {
                    ClaraMenuEntry.header("Examples")
                    for ex in SiteContent.shared.examples {
                        ClaraMenuEntry.action(ex.title, ex.format == "mermaid" ? "m.square" : "square.grid.3x3") { load(ex) }
                    }
                } label: {
                    Label("Examples", systemImage: "square.grid.2x2").font(ClaraFont.body(14, weight: .medium)).foregroundStyle(Theme.ink)
                        .padding(.horizontal, 12).frame(height: 36).background(Theme.surface3, in: RoundedRectangle(cornerRadius: Theme.rSm + 1))
                }
                Segmented(options: [("clara", "Clara"), ("mermaid", "Mermaid")], selection: $format)
                Spacer(minLength: 0)
                if hSize != .regular { Segmented(options: [("code", "Code"), ("diagram", "Diagram")], selection: $tab) }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .background(Theme.surface)

            let layout = hSize == .regular ? AnyLayout(HStackLayout(spacing: 2)) : AnyLayout(VStackLayout(spacing: 0))
            layout {
                if hSize == .regular || tab == "code" {
                    VStack(spacing: 0) {
                        TextEditor(text: $code)
                            .font(ClaraFont.mono(14))
                            .foregroundStyle(Theme.ink)
                            .scrollContentBackground(.hidden)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .padding(10)
                            .background(Theme.surface)
                        Text(compiled?.summary ?? " ").font(ClaraFont.mono(12)).foregroundStyle(compiled?.issues.isEmpty == false ? Theme.red : Theme.muted)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.vertical, 8).background(Theme.surface2)
                    }
                    .frame(maxWidth: hSize == .regular ? 460 : .infinity)
                    .transition(.opacity)
                }
                if hSize == .regular || tab == "diagram" {
                    DiagramViewer(elements: (compiled?.elements ?? []).map { Resolved(element: $0, hidden: false) }, emptyText: "The diagram appears as you type")
                        .transition(.opacity)
                }
            }
            .background(Theme.paper)
            .animation(Theme.med, value: tab)
        }
        .claraTopBar("Playground") {
            ClaraMenu("Export") {
                ClaraMenuEntry.header("Export")
                for f in DiagramExport.Format.allCases { ClaraMenuEntry.action(f.label) { export(f) } }
            } label: {
                Image(systemName: "square.and.arrow.down").font(.system(size: 16)).foregroundStyle(Theme.ink2).frame(width: 36, height: 40)
            }
            Button { share() } label: { Label("Share", systemImage: "link") }.buttonStyle(.clara(.secondary, small: true))
            Button { Task { await save() } } label: { Text(saving ? "Saving…" : "Save to Clara") }.buttonStyle(.clara(.primary, small: true)).disabled(saving)
        }
        .task(id: code + format) {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            withAnimation(Theme.easeOut) { compiled = SharedJS.shared.compile(code, format: format) }
        }
    }

    private func load(_ ex: SiteContent.Example) {
        code = ex.code
        format = ex.format
        name = ex.title
        withAnimation(Theme.med) { tab = "diagram" }
    }

    private func export(_ f: DiagramExport.Format) {
        do { SystemShare.present([try DiagramExport.file((compiled?.elements ?? []).map { Resolved(element: $0, hidden: false) }, name: name, format: f)]) }
        catch { toasts.error("Export failed: \(errorMessage(error))") }
    }

    /// `/editor#z=…`: the same deflate-raw + base64url link format the web playground reads.
    private func share() {
        let json = (try? JSONSerialization.data(withJSONObject: ["c": code, "f": format == "mermaid" ? "m" : "c"])) ?? Data()
        let hash: String
        if let z = deflateRaw(json) { hash = "z=" + base64url(z) } else { hash = "t=" + base64url(json) }
        let link = "\(ClaraConfig.shared.siteUrl ?? "")/editor#\(hash)"
        UIPasteboard.general.string = link
        toasts.success("Share link copied")
        SystemShare.present([URL(string: link) ?? link])
    }

    private func base64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// Raw DEFLATE (Apple's COMPRESSION_ZLIB writes RFC 1951 without a header, like CompressionStream('deflate-raw')).
    private func deflateRaw(_ data: Data) -> Data? {
        guard !data.isEmpty else { return nil }
        let cap = data.count + 1024
        var out = Data(count: cap)
        let n = out.withUnsafeMutableBytes { dst in
            data.withUnsafeBytes { src in
                compression_encode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, cap, src.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
            }
        }
        return n > 0 ? out.prefix(n) : nil
    }

    private func save() async {
        guard auth.isSignedIn else { siteOpen?(.signUp); return }
        guard let ws = model.currentWorkspaceId else { toasts.error("Create a workspace first"); return }
        guard let c = compiled, c.nodeCount > 0 else { toasts.error("Nothing to save yet"); return }
        saving = true
        do {
            let d = try await api.createDiagram(ws, name: name, folder: nil)
            _ = try await api.saveElements(d.id, c.elements)
            try await api.setSource(d.id, text: code, format: format)
            toasts.success("Saved “\(name)” to \(model.currentWorkspace?.name ?? "your workspace")")
            model.open(.diagram(d.id))
        } catch { toasts.error(error) }
        saving = false
    }
}
