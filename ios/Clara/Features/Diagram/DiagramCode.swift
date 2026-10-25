import SwiftUI

/// Code tab: Clara DSL or Mermaid on one side, a live preview on the other (or stacked on iPhone).
struct DiagramCodeTab: View {
    @Bindable var store: DiagramStore
    var editable: Bool
    var onApplied: () -> Void

    @Environment(ToastCenter.self) private var toasts
    @Environment(DialogCenter.self) private var dialogs
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var preview: SharedJS.Compiled?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Segmented(options: [("clara", "Clara"), ("mermaid", "Mermaid")], selection: $store.codeFormat)
                Spacer()
                if editable {
                    Button { store.loadFromCanvas() } label: { Label("From canvas", systemImage: "arrow.down.doc") }.buttonStyle(.clara(.ghost, small: true))
                    Button { Task { await apply() } } label: { Label("Apply to canvas", systemImage: "checkmark") }.buttonStyle(.clara(.primary, small: true))
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .background(Theme.surface2)

            let layout = hSize == .regular ? AnyLayout(HStackLayout(spacing: 2)) : AnyLayout(VStackLayout(spacing: 2))
            layout {
                VStack(spacing: 0) {
                    TextEditor(text: $store.code)
                        .font(ClaraFont.mono(14))
                        .foregroundStyle(Theme.ink)
                        .scrollContentBackground(.hidden)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .disabled(!editable)
                        .padding(10)
                        .background(Theme.surface)
                    Text(preview?.summary ?? " ")
                        .font(ClaraFont.mono(12))
                        .foregroundStyle(preview?.issues.isEmpty == false ? Theme.red : Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Theme.surface2)
                }
                DiagramViewer(elements: (preview?.elements ?? []).map { Resolved(element: $0, hidden: false) }, emptyText: "The preview appears as you type")
                    .frame(minHeight: 240)
            }
            .background(Theme.paper)
        }
        .task(id: store.code + store.codeFormat) {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            preview = store.compiled
        }
    }

    private func apply() async {
        let c = store.compiled
        guard c.nodeCount > 0 else {
            toasts.error(store.codeFormat == "mermaid" ? "No nodes found. Check the syntax, e.g. A[Label] --> B[Label]." : "No nodes found. Declare some with: node id \"Label\".")
            return
        }
        if !store.elements.isEmpty {
            let n = store.elements.count
            guard await dialogs.confirm(title: "Replace the canvas with this code?", message: "The \(n) element\(n == 1 ? "" : "s") on the canvas are replaced by a fresh layout of the code. The current version is saved to history first.", confirmLabel: "Apply to canvas") else { return }
        }
        do {
            try await store.applyCode()
            toasts.success("Applied: \(c.summary)")
            onApplied()
        } catch { toasts.error(error) }
    }
}

/// Full-screen walkthrough of Base and each state, with animated transitions (PresentMode.tsx).
struct PresentModeView: View {
    let base: [DiagramElement]
    let states: [DiagramState]
    let startIndex: Int
    @Environment(\.dismiss) private var dismiss

    @State private var index = 0
    @State private var from: [RenderFrame] = []
    @State private var progress: Double = 1
    @State private var playing = false

    private var steps: [(name: String, state: DiagramState?)] { [("Base", nil)] + states.map { ($0.name, $0) } }
    private func frames(_ i: Int) -> [RenderFrame] { States.resolve(base, steps[i].state).map(RenderFrame.init) }

    var body: some View {
        let target = frames(index)
        let blended = progress >= 1 ? target : RenderFrame.interpolate(from, target, RenderFrame.easeInOut(progress))
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(steps[index].name).font(ClaraFont.display(24, weight: .bold)).foregroundStyle(Theme.ink)
                    .id(index).transition(.opacity.combined(with: .offset(y: 6)))
                Text("\(index + 1) / \(steps.count)").font(ClaraFont.body(15)).monospacedDigit().foregroundStyle(Theme.muted)
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink2).frame(width: 40, height: 40) }
                    .accessibilityLabel("Exit")
            }
            .padding(.horizontal, 24).padding(.vertical, 14)
            .animation(Theme.easeOut, value: index)

            Canvas { ctx, size in
                DiagramRenderer.drawGrid(&ctx, size: size, offset: .zero, scale: 1.2, palette: .dark)
                let all = (from + target).filter { $0.opacity > 0 }.map(\.rect)
                guard let first = all.first else { return }
                let b = all.dropFirst().reduce(first) { $0.union($1) }
                let k = min((size.width - 80) / max(b.width, 1), (size.height - 80) / max(b.height, 1), 2)
                ctx.translateBy(x: (size.width - b.width * k) / 2 - b.minX * k, y: (size.height - b.height * k) / 2 - b.minY * k)
                ctx.scaleBy(x: k, y: k)
                let scene = DiagramScene(elements: blended.map { Resolved(element: $0.drawable, hidden: $0.opacity <= 0.01) },
                                         palette: .dark, opacity: Dictionary(uniqueKeysWithValues: blended.map { ($0.id, $0.opacity) }))
                DiagramRenderer.draw(scene, in: &ctx)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 30).onEnded { v in go(v.translation.width < 0 ? 1 : -1) })
            .onTapGesture { go(1) }

            HStack(spacing: 12) {
                Button { go(-1) } label: { Label("Prev", systemImage: "chevron.left") }.buttonStyle(.claraSecondary).disabled(index == 0)
                Button { playing.toggle() } label: { Label(playing ? "Pause" : "Play", systemImage: playing ? "pause.fill" : "play.fill") }.buttonStyle(.claraSecondary)
                Button { go(1) } label: { Label("Next", systemImage: "chevron.right") }.buttonStyle(.claraPrimary).disabled(index == steps.count - 1)
                HStack(spacing: 6) {
                    ForEach(steps.indices, id: \.self) { i in
                        Capsule().fill(i == index ? Theme.cobalt : Theme.surface4).frame(width: i == index ? 18 : 7, height: 7)
                    }
                }
                .animation(Theme.spring, value: index)
            }
            .padding(14)
            .frame(maxWidth: .infinity)
            .background(Theme.surface)
        }
        .background(Theme.canvas.ignoresSafeArea())
        .statusBarHidden()
        .onAppear { index = min(startIndex, steps.count - 1) }
        .task(id: playing) {
            while playing, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2.6))
                guard playing else { break }
                if index >= steps.count - 1 { playing = false } else { go(1) }
            }
        }
        .onKeyPress(.rightArrow) { go(1); return .handled }
        .onKeyPress(.leftArrow) { go(-1); return .handled }
        .onKeyPress(.space) { playing.toggle(); return .handled }
        .onKeyPress(.escape) { dismiss(); return .handled }
    }

    private func go(_ dir: Int) {
        let next = min(steps.count - 1, max(0, index + dir))
        guard next != index else { return }
        from = progress >= 1 ? frames(index) : RenderFrame.interpolate(from, frames(index), RenderFrame.easeInOut(progress))
        index = next
        progress = 0
        UISelectionFeedbackGenerator().selectionChanged()
        Task {
            let start = Date()
            while progress < 1 {
                try? await Task.sleep(for: .milliseconds(16))
                progress = min(1, Date().timeIntervalSince(start) / 0.6)
            }
        }
    }
}

// MARK: - Export (exporters.ts): SVG via the shared renderer, PNG/PDF drawn natively on the light sheet, Mermaid source.

enum DiagramExport {
    enum Format: String, CaseIterable { case svg, png, pdf, mermaid
        var label: String {
            switch self { case .svg: "SVG image"; case .png: "PNG image (2×)"; case .pdf: "PDF document"; case .mermaid: "Mermaid source (.mmd)" }
        }
        var ext: String { self == .mermaid ? "mmd" : rawValue }
    }

    static func file(_ elements: [Resolved], name: String, format: Format) throws -> URL {
        let shown = elements.filter { !$0.hidden }
        let safe = name.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(safe).\(format.ext)")
        switch format {
        case .svg:
            try SharedJS.shared.svg(shown.map(\.element)).write(to: url, atomically: true, encoding: .utf8)
        case .mermaid:
            try SharedJS.shared.toMermaid(shown.map(\.element)).write(to: url, atomically: true, encoding: .utf8)
        case .png, .pdf:
            let b = Geometry.bounds(shown.map(\.element)) ?? CGRect(x: 0, y: 0, width: 400, height: 240)
            let size = CGSize(width: b.width + 64, height: b.height + 64)
            let view = Canvas { ctx, _ in
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(.white))
                ctx.translateBy(x: 32 - b.minX, y: 32 - b.minY)
                DiagramRenderer.draw(DiagramScene(elements: shown, palette: .light), in: &ctx)
            }
            .frame(width: size.width, height: size.height)
            let renderer = ImageRenderer(content: view)
            if format == .png {
                renderer.scale = 2
                guard let img = renderer.uiImage, let data = img.pngData() else { throw APIError(status: 0, message: "Couldn’t draw the image") }
                try data.write(to: url)
            } else {
                var box = CGRect(origin: .zero, size: size)
                guard let ctx = CGContext(url as CFURL, mediaBox: &box, nil) else { throw APIError(status: 0, message: "Couldn’t create the PDF") }
                renderer.render { _, draw in
                    ctx.beginPDFPage(nil)
                    draw(ctx)
                    ctx.endPDFPage()
                    ctx.closePDF()
                }
            }
        }
        return url
    }
}
