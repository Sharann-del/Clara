import SwiftUI

/// Version list with a preview and a diff against now, then restore (VersionHistoryPanel.tsx).
struct VersionHistoryView: View {
    let kind: ItemKind
    let id: String
    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(ToastCenter.self) private var toasts
    @Environment(DialogCenter.self) private var dialogs
    @Environment(\.horizontalSizeClass) private var hSize

    enum View2: Hashable { case changes, preview }

    @State private var versions: [VersionSummary]?
    @State private var selected: String?
    @State private var version: VersionFull?
    @State private var view: View2 = .changes
    @State private var canRestore = false
    @State private var currentMd = ""
    @State private var currentTitle = ""
    @State private var currentElements: [DiagramElement] = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        PageScroll {
            PageHeader(title: "Version history", subtitle: "Every save keeps the previous version. Preview one, then restore it if you need to.").padding(.bottom, 8)
            if let error { Text(error).font(ClaraFont.body(14)).foregroundStyle(Theme.red) }
            if let versions {
                if versions.isEmpty {
                    EmptyStateView(symbol: "clock.arrow.circlepath", title: "No earlier versions yet", message: "A version is saved each time this \(kind.rawValue) changes.", compact: true)
                } else {
                    let layout = hSize == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 16)) : AnyLayout(VStackLayout(spacing: 16))
                    layout {
                        list(versions).frame(maxWidth: hSize == .regular ? 240 : .infinity)
                        detail.frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            } else {
                SkeletonRows(rows: 4)
            }
        }
        .claraTopBar("Version history")
        .task { await load() }
        .task(id: selected) {
            guard let selected else { return }
            version = nil
            do { let v = try await api.version(kind, id, selected); withAnimation(Theme.med) { version = v } } catch { self.error = errorMessage(error) }
        }
    }

    private func list(_ versions: [VersionSummary]) -> some View {
        let content = ForEach(Array(versions.enumerated()), id: \.element.id) { i, v in
            Button { withAnimation(Theme.fast) { selected = v.id } } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(timeAgo(v.created_at)).font(ClaraFont.body(15, weight: .semibold)).foregroundStyle(Theme.ink)
                    Text(fullDate(v.created_at)).font(ClaraFont.body(13)).foregroundStyle(Theme.muted)
                    if i == 0 { TagChip(text: "latest saved", tone: .neutral).padding(.top, 2) }
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                .frame(maxWidth: hSize == .regular ? .infinity : nil, alignment: .leading)
                .background(selected == v.id ? Theme.cobaltSoft : .clear, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
            }
            .buttonStyle(PressScale())
            .accessibilityAddTraits(selected == v.id ? .isSelected : [])
        }
        return Group {
            if hSize == .regular {
                VStack(spacing: 2) { content }
            } else {
                ScrollView(.horizontal, showsIndicators: false) { HStack(spacing: 4) { content } }
            }
        }
        .padding(6)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
    }

    @ViewBuilder private var detail: some View {
        if let version {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Segmented(options: [(View2.changes, "Changes since"), (.preview, "Preview")], selection: $view)
                    Spacer()
                    if canRestore {
                        Button { Task { await restore(version) } } label: { Label(busy ? "Restoring…" : "Restore this version", systemImage: "clock.arrow.circlepath") }
                            .buttonStyle(.claraPrimary).disabled(busy)
                    }
                }
                if kind == .document { documentVersion(version.snapshot) } else { diagramVersion(version.snapshot) }
            }
            .transition(.opacity)
        } else {
            SkeletonRows(rows: 6, height: 22)
        }
    }

    @ViewBuilder private func documentVersion(_ snap: JSONObject) -> some View {
        let then = snap["content_md"]?.string ?? ""
        let thenTitle = snap["title"]?.string ?? ""
        if view == .preview {
            VStack(alignment: .leading, spacing: 12) {
                Text(thenTitle).font(ClaraFont.display(24, weight: .bold)).foregroundStyle(Theme.ink)
                MarkdownView(markdown: then)
            }
            .padding(18)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
        } else {
            Text("Red is in this version but not now; green was added since. Restoring removes the green and brings back the red.").font(ClaraFont.body(14)).foregroundStyle(Theme.muted)
            if thenTitle != currentTitle {
                HStack { Text("Title").font(ClaraFont.body(14, weight: .semibold)); DiffChip(text: thenTitle, kind: .del); DiffChip(text: currentTitle, kind: .add) }
            }
            if then == currentMd && thenTitle == currentTitle {
                Text("Identical to the current version.").font(ClaraFont.body(14)).foregroundStyle(Theme.muted)
            } else {
                TextDiffView(before: then, after: currentMd, maxHeight: 460)
            }
        }
    }

    @ViewBuilder private func diagramVersion(_ snap: JSONObject) -> some View {
        let then: [DiagramElement] = {
            guard let raw = snap["elements"], let data = try? JSON.encoder.encode(raw) else { return [] }
            return (try? JSON.decoder.decode([DiagramElement].self, from: data)) ?? []
        }()
        if view == .preview {
            DiagramViewer(elements: then.map { Resolved(element: $0, hidden: false) }).frame(height: 440).clipShape(RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
        } else {
            let d = SharedJS.shared.diff(current: then, proposed: currentElements)
            Text("What changed between this version and now. Restoring undoes these.").font(ClaraFont.body(14)).foregroundStyle(Theme.muted)
            if d.added.isEmpty && d.removed.isEmpty && d.changed.isEmpty {
                Text("Same shapes as the current diagram.").font(ClaraFont.body(14)).foregroundStyle(Theme.muted)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(d.removed, id: \.id) { e in HStack { DiffChip(text: "removed since", kind: .del); Text(SharedJS.shared.describe(e)).font(ClaraFont.body(14)).foregroundStyle(Theme.ink2) } }
                    ForEach(d.added, id: \.id) { e in HStack { DiffChip(text: "added since", kind: .add); Text(SharedJS.shared.describe(e)).font(ClaraFont.body(14)).foregroundStyle(Theme.ink2) } }
                    ForEach(d.changed, id: \.id) { c in HStack { DiffChip(text: "changed", kind: .change); Text("\(SharedJS.shared.describe(c.after)) (\(c.fields.joined(separator: ", ")))").font(ClaraFont.body(14)).foregroundStyle(Theme.ink2) } }
                }
            }
            DiagramViewer(elements: then.map { Resolved(element: $0, hidden: false) }, showControls: false).frame(height: 260).clipShape(RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
        }
    }

    private func load() async {
        do {
            if kind == .document {
                let d = try await api.document(id)
                currentMd = d.content_md
                currentTitle = d.title
                canRestore = (d.role ?? .viewer) >= .editor
            } else {
                let d = try await api.diagram(id)
                currentElements = d.elements
                canRestore = (d.role ?? .viewer) >= .editor
            }
            let v = try await api.versions(kind, id)
            withAnimation(Theme.easeOut) { versions = v; selected = selected ?? v.first?.id }
        } catch { self.error = errorMessage(error); versions = versions ?? [] }
    }

    private func restore(_ v: VersionFull) async {
        guard await dialogs.confirm(title: "Restore this version?", message: "The \(kind.rawValue) goes back to how it was \(timeAgo(v.created_at)). What it looks like now is saved as a new version first, so you can undo this.", confirmLabel: "Restore version") else { return }
        busy = true
        do {
            try await api.restore(kind, id, v.id)
            toasts.success("Version restored. The previous state is saved in history.")
            if !model.path.isEmpty { model.path.removeLast() }
        } catch { toasts.error(error) }
        busy = false
    }
}
