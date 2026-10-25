import SwiftUI

/// What a signed-out visitor sees first (LandingPage.tsx): hero, a live demo with an AI proposal
/// to review, the features, and a way in.
struct LandingView: View {
    var signedIn: Bool
    @Environment(\.siteOpen) private var siteOpen
    private func open(_ r: SiteRoute) { siteOpen?(r) }
    @State private var shown = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                header
                hero
                HeroDemo()
                    .padding(.horizontal, 16)
                    .padding(.top, 36)
                    .opacity(shown ? 1 : 0).offset(y: shown ? 0 : 16)
                    .animation(Theme.easeOut.delay(0.28), value: shown)
                features
                closing
                footer
            }
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background(Theme.paper)
        .onAppear { shown = true }
    }

    private var header: some View {
        HStack {
            ClaraLogo(size: 26)
            Spacer()
            ClaraMenu("Site menu") { siteMenuEntries(open) } label: {
                Image(systemName: "line.3.horizontal").font(.system(size: 18, weight: .medium)).foregroundStyle(Theme.ink).frame(width: 40, height: 40)
            }
            if signedIn {
                Button("Open Clara") { open(.signIn) }.buttonStyle(.claraPrimary)
            } else {
                Button("Sign in") { open(.signIn) }.buttonStyle(.claraGhost)
                Button("Start free") { open(.signUp) }.buttonStyle(.claraPrimary)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
    }

    private var hero: some View {
        VStack(spacing: 22) {
            Text(Highlight.make([("System design", .marker), (" you can ", .plain), ("type", .accent), (", zoom into, and hand to Claude.", .plain)]))
                .font(ClaraFont.display(44, weight: .heavy))
                .tracking(-1.4)
                .lineSpacing(-4)
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .stagger(shown, 0)
            Text("Clara keeps architecture docs and diagrams in one place. Write a diagram as code, drill from the whole system down to a single service, walk people through how it changes, and let AI assistants propose edits that land only when you approve them.")
                .font(ClaraFont.body(18))
                .lineSpacing(5)
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 600)
                .stagger(shown, 1)
            HStack(spacing: 10) {
                Button { open(.playground) } label: { Label("Open the playground", systemImage: "arrow.right").labelStyle(TrailingIcon()) }
                    .buttonStyle(ClaraButtonStyle(kind: .primary, size: .large))
                Button(signedIn ? "Open Clara" : "Create a free account") { open(signedIn ? .signIn : .signUp) }.buttonStyle(ClaraButtonStyle(kind: .secondary, size: .large))
            }
            .stagger(shown, 2)
            Text("The playground needs no sign-in. Try editing the code below.").font(ClaraFont.body(14)).foregroundStyle(Theme.muted).stagger(shown, 3)
        }
        .padding(.horizontal, 20)
        .padding(.top, 40)
    }

    private struct Feature: Identifiable {
        let id: String
        let eyebrow: String
        let title: String
        let body: String
        let points: [String]
        let code: String
    }

    private let featureList: [Feature] = [
        Feature(id: "docs", eyebrow: "Docs + diagrams", title: "The reasoning and the picture, side by side",
                body: "Write markdown with live diagrams embedded right in it. Edit the diagram and every document showing it updates.",
                points: ["Markdown with tables, code and task lists", "Embeds stay live, not screenshots", "Version history with diffs"],
                code: "direction LR\nnode c \"Client\"\nnode g \"Gateway\"\nnode s \"Search\"\nedge c -> g\nedge g -> s \"query\""),
        Feature(id: "code", eyebrow: "Diagrams as code", title: "Type it, or paste your Mermaid",
                body: "Describe nodes and edges in a few lines and Clara lays them out. Bring Mermaid flowcharts across unchanged, then keep editing on the canvas.",
                points: ["Clara DSL and Mermaid flowcharts", "Automatic layout", "Export SVG, PNG, PDF or Mermaid"],
                code: "direction LR\nnode user \"User\"\nnode app \"Web app\"\nnode api \"API\"\nnode db \"Postgres\"\nedge user -> app\nedge app -> api \"JWT\"\nedge api -> db"),
        Feature(id: "c4", eyebrow: "C4 drill-down", title: "From the whole system to a single service",
                body: "Link any shape to a child diagram. Double-tap to go a level deeper, from context to containers to components.",
                points: ["Child diagrams one tap away", "Breadcrumbs back up the levels", "Each level stays readable"],
                code: "node cust \"Customer\"\nnode shop \"Online shop\"\nnode pay \"Payment provider\"\nedge cust -> shop \"orders\"\nedge shop -> pay \"charges\""),
        Feature(id: "states", eyebrow: "States + present", title: "Walk people through how it changes",
                body: "Keep Today, Migrating and Target as states of one diagram, then present them with smooth transitions.",
                points: ["One layout, many states", "Animated present mode", "Edits inside a state stay in that state"],
                code: "direction LR\nnode users \"Users\"\nnode mono \"Monolith\"\nnode billing \"Billing service\"\nnode bus \"Event bus\"\nedge users -> mono\nedge mono -> bus \"publishes\"\nedge bus -> billing \"consumes\""),
        Feature(id: "collab", eyebrow: "Live collaboration", title: "Everyone on the same canvas",
                body: "See who’s here, watch shapes move as teammates drag them, and share single documents or read-only public links.",
                points: ["Presence and live cursors", "Workspace roles", "Revocable public links"],
                code: "direction LR\nnode a \"Ingest\"\nnode b \"Stream processor\"\nnode c \"Warehouse\"\nedge a -> b\nedge b -> c \"hourly\""),
        Feature(id: "ai", eyebrow: "AI you review", title: "Claude proposes, you approve",
                body: "Connect Claude over MCP. Its edits arrive as proposals with a clear diff, and nothing changes until a person accepts.",
                points: ["One command to connect", "Every proposal shows its diff", "Accept keeps the old version in history"],
                code: "direction LR\nnode api \"Orders API\"\nnode cache \"Redis cache\"\nnode db \"Postgres\"\nedge api -> cache \"cache-aside\"\nedge api -> db \"SQL\""),
    ]

    private var features: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 10) {
                Text(Highlight.make([("Everything a ", .plain), ("design doc", .marker), (" needs", .plain)])).font(ClaraFont.display(32, weight: .bold)).tracking(-1).foregroundStyle(Theme.ink)
                Text("Built for engineers who want their architecture written down and kept current.").font(ClaraFont.body(17)).foregroundStyle(Theme.ink2)
            }
            .padding(.bottom, 8)
            ForEach(Array(featureList.enumerated()), id: \.element.id) { i, f in
                FeatureCard(eyebrow: f.eyebrow, title: f.title, text: f.body, points: f.points, code: f.code)
                    .scrollTransition(.animated(Theme.easeOut)) { content, phase in
                        content.opacity(phase.isIdentity ? 1 : 0.3).offset(y: phase.value > 0 ? 24 : 0)
                    }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 72)
    }

    private var closing: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(Highlight.make([("Write the design down. ", .plain), ("Keep it true.", .marker)])).font(ClaraFont.display(28, weight: .bold)).tracking(-0.8).foregroundStyle(Theme.ink)
            Text("Free to start. Your first workspace comes with a sample doc and diagram.").font(ClaraFont.body(16)).foregroundStyle(Theme.ink2)
            HStack {
                if signedIn {
                    Button("Open Clara") { open(.signIn) }.buttonStyle(.claraPrimary)
                } else {
                    Button("Create a free account") { open(.signUp) }.buttonStyle(.claraPrimary)
                    Button("Sign in") { open(.signIn) }.buttonStyle(ClaraButtonStyle(kind: .secondary))
                }
            }
            .padding(.top, 4)
        }
        .padding(28)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.cobaltSoft, in: RoundedRectangle(cornerRadius: Theme.rLg, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.top, 72)
    }

    private var footer: some View {
        VStack(spacing: 6) {
            ClaraLogo(size: 20)
            Text("System design docs, diagrams as code, and AI edits you approve.").font(ClaraFont.body(13.5)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
        }
        .padding(.vertical, 48)
        .frame(maxWidth: .infinity)
    }
}

private struct FeatureCard: View {
    let eyebrow: String
    let title: String
    let text: String
    let points: [String]
    let code: String
    @State private var elements: [Resolved] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            DiagramViewer(elements: elements, inline: true, showControls: false, maxFitScale: 1)
                .frame(height: 210)
            VStack(alignment: .leading, spacing: 10) {
                Text(eyebrow).font(ClaraFont.mono(12.5)).foregroundStyle(Theme.cobaltInk)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Theme.cobaltSoft, in: RoundedRectangle(cornerRadius: Theme.rSm))
                Text(title).font(ClaraFont.display(23, weight: .bold)).tracking(-0.6).foregroundStyle(Theme.ink)
                Text(text).font(ClaraFont.body(16)).lineSpacing(4).foregroundStyle(Theme.ink2)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(points, id: \.self) { p in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            RoundedRectangle(cornerRadius: 1.5).fill(Theme.cobalt).frame(width: 6, height: 6).offset(y: -2)
                            Text(p).font(ClaraFont.body(15)).foregroundStyle(Theme.ink2)
                        }
                    }
                }
                .padding(.top, 2)
            }
            .padding(20)
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.rLg, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: Theme.rLg, style: .continuous))
        .task { elements = SharedJS.shared.compile(code, format: "clara").elements.map { Resolved(element: $0, hidden: false) } }
    }
}

/// The landing hero's working editor (HeroDemo.tsx): edit the code, the diagram re-renders; a
/// simulated Claude proposal previews in the accent colour and lands only when accepted.
private struct HeroDemo: View {
    private static let base = """
    direction LR
    node web "Web app"
    node api "Orders API"
    node db "Postgres"
    node queue "Job queue"
    node worker "Worker"
    edge web -> api "HTTPS"
    edge api -> db "SQL"
    edge api -> queue "enqueue"
    edge queue -> worker
    """
    private static let proposal = ["node cache \"Redis cache\"", "edge api -> cache \"cache-aside\""]

    enum Phase { case waiting, pending, accepted, rejected }

    @State private var code = HeroDemo.base
    @State private var phase: Phase = .waiting
    @State private var flash = false
    @State private var compiled: SharedJS.Compiled?

    private var showPreview: Bool { phase == .pending }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "chevron.left.forwardslash.chevron.right").font(.system(size: 12)).foregroundStyle(Theme.muted)
                Text("orders.clara").font(ClaraFont.mono(13)).foregroundStyle(Theme.ink2)
                Spacer()
                HStack(spacing: 6) {
                    Circle().fill(Theme.green).frame(width: 7, height: 7).modifier(Pulse())
                    Text("Re-renders as you type").font(ClaraFont.body(13)).foregroundStyle(Theme.muted)
                }
            }
            .padding(.horizontal, 14).frame(height: 42)
            .background(Theme.surface2)

            VStack(spacing: 2) {
                VStack(spacing: 0) {
                    TextEditor(text: $code)
                        .font(ClaraFont.mono(13.5))
                        .foregroundStyle(Theme.ink)
                        .scrollContentBackground(.hidden)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .padding(.horizontal, 10).padding(.top, 6)
                        .frame(height: 190)
                        .background(Theme.surface)
                    Text(compiled?.summary ?? " ").font(ClaraFont.mono(12)).foregroundStyle(compiled?.issues.isEmpty == false ? Theme.red : Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.vertical, 7).background(Theme.surface2)
                }
                ZStack(alignment: .bottom) {
                    DiagramViewer(elements: (compiled?.elements ?? []).map { Resolved(element: $0, hidden: false) }, highlights: highlights, inline: true, showControls: false, maxFitScale: 1.1)
                        .frame(height: 300)
                }
                proposalStrip
            }
            .background(Theme.paper)
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.rLg, style: .continuous))
        .task(id: code + (showPreview ? "+p" : "")) {
            try? await Task.sleep(for: .milliseconds(120))
            let text = showPreview ? code + "\n" + Self.proposal.joined(separator: "\n") : code
            withAnimation(Theme.easeOut) { compiled = SharedJS.shared.compile(text, format: "clara") }
        }
        .task(id: phase == .waiting) {
            guard phase == .waiting else { return }
            try? await Task.sleep(for: .seconds(1.6))
            withAnimation(Theme.spring) { phase = .pending }
        }
    }

    /// The accent outlines what Claude adds while it waits; green flashes briefly once accepted.
    private var highlights: [String: Color] {
        guard showPreview || flash, let els = compiled?.elements else { return [:] }
        let color = flash ? Theme.green : Theme.cobalt
        let added = Set(els.filter { $0.type != .connector && $0.text == "Redis cache" }.map(\.id))
        var out: [String: Color] = [:]
        for el in els where added.contains(el.id) || (el.type == .connector && (added.contains(el.fromId ?? "") || added.contains(el.toId ?? ""))) { out[el.id] = color }
        return out
    }

    @ViewBuilder private var proposalStrip: some View {
        switch phase {
        case .waiting:
            EmptyView()
        case .pending:
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 7) {
                    Image(systemName: "arrow.triangle.pull")
                    Text("Claude proposes").textCase(.uppercase).tracking(0.6)
                }
                .font(ClaraFont.body(12.5, weight: .semibold)).foregroundStyle(Theme.cobaltInk)
                Text("Cache order reads in Redis").font(ClaraFont.body(15.5, weight: .semibold)).foregroundStyle(Theme.ink)
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Self.proposal, id: \.self) { Text("+ \($0)").font(ClaraFont.mono(12)).foregroundStyle(Theme.green) }
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.paper, in: RoundedRectangle(cornerRadius: Theme.rSm))
                HStack(spacing: 8) {
                    Button {
                        code = code.trimmingCharacters(in: .whitespacesAndNewlines) + "\n" + Self.proposal.joined(separator: "\n")
                        withAnimation(Theme.spring) { phase = .accepted; flash = true }
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        Task { try? await Task.sleep(for: .seconds(1.8)); withAnimation { flash = false } }
                    } label: { Label("Accept", systemImage: "checkmark") }
                    .buttonStyle(.clara(.primary, small: true))
                    Button("Reject") { withAnimation(Theme.spring) { phase = .rejected } }.buttonStyle(.clara(.secondary, small: true))
                    Text("Not applied yet").font(ClaraFont.body(13)).foregroundStyle(Theme.muted)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.cobaltSoft)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        case .accepted, .rejected:
            HStack(spacing: 10) {
                Image(systemName: phase == .accepted ? "checkmark" : "xmark")
                Text(phase == .accepted ? "Accepted. The previous version is in history." : "Rejected. Nothing changed.").font(ClaraFont.body(14.5))
                Spacer()
                Button {
                    code = Self.base
                    withAnimation(Theme.spring) { phase = .waiting }
                } label: { Label("Replay", systemImage: "arrow.counterclockwise") }
                .buttonStyle(.clara(.ghost, small: true))
            }
            .foregroundStyle(phase == .accepted ? Theme.green : Theme.ink2)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Theme.surface)
            .transition(.opacity)
        }
    }
}

private struct Pulse: ViewModifier {
    @State private var on = false
    func body(content: Content) -> some View {
        content.scaleEffect(on ? 0.6 : 1).onAppear { withAnimation(.easeInOut(duration: 1.2).repeatForever()) { on = true } }
    }
}

private struct TrailingIcon: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) { configuration.title; configuration.icon }
    }
}

private extension View {
    /// Staggered hero entrance (`.hero-copy > *` delays).
    func stagger(_ shown: Bool, _ i: Int) -> some View {
        opacity(shown ? 1 : 0).offset(y: shown ? 0 : 10).animation(Theme.easeOut.delay(Double(i) * 0.06), value: shown)
    }
}

/// Heading text with a solid marker behind a key phrase (`mark.hl` on the web).
enum Highlight {
    enum Style { case plain, marker, accent }
    static let color = Color(hex: 0x31346A)

    static func make(_ parts: [(String, Style)]) -> AttributedString {
        var out = AttributedString()
        for (text, style) in parts {
            var a = AttributedString(text)
            switch style {
            case .marker: a.backgroundColor = color
            case .accent: a.foregroundColor = Theme.cobalt
            case .plain: break
            }
            out += a
        }
        return out
    }
}
