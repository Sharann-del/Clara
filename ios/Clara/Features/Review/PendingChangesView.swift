import SwiftUI

/// Changes proposed by AI assistants over MCP, waiting for a human (PendingChangesPanel.tsx).
/// Amber here means exactly that: proposed, not applied.
struct PendingChangesView: View {
    let workspaceId: String
    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(ToastCenter.self) private var toasts
    @Environment(DialogCenter.self) private var dialogs

    @State private var changes: [PendingChange]?
    @State private var error: String?
    @State private var busy: String?
    @State private var rowErrors: [String: String] = [:]

    var body: some View {
        PageScroll {
            PageHeader(title: "Pending changes from AI assistants", subtitle: "Nothing below has been applied yet. Accept applies it and saves the previous state to version history; Reject discards it.")
                .padding(.bottom, 8)
            if let error { Text(error).font(ClaraFont.body(14)).foregroundStyle(Theme.red) }
            if let changes {
                if changes.isEmpty {
                    EmptyStateView(symbol: "arrow.triangle.pull", title: "Nothing waiting for review", message: "When an assistant connected over MCP proposes a change, it appears here. Create an access token in Settings to connect Claude.") {
                        Button { model.go(.tokens) } label: { Label("Access tokens", systemImage: "key") }.buttonStyle(.claraSecondary)
                    }
                } else {
                    ForEach(Array(changes.enumerated()), id: \.element.id) { i, c in
                        card(c).fadeUp(i).transition(.asymmetric(insertion: .opacity, removal: .opacity.combined(with: .scale(scale: 0.97))))
                    }
                }
            } else {
                SkeletonRows(rows: 2, height: 120)
            }
        }
        .claraTopBar("Pending changes")
        .task { await load() }
    }

    private func card(_ c: PendingChange) -> some View {
        Card(background: Theme.surface) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        TagChip(text: "\(c.operation == "create" ? "new" : "edit") \(c.resource_type.rawValue)", tone: .amber)
                        if c.operation == "update", let id = c.resource_id {
                            Button(c.resource_name ?? "Untitled") { model.open(c.resource_type == .document ? .document(id) : .diagram(id)) }
                                .font(ClaraFont.body(16, weight: .semibold)).foregroundStyle(Theme.cobalt)
                        } else {
                            Text(c.resource_name ?? (c.proposed["title"]?.string ?? c.proposed["name"]?.string ?? "Untitled")).font(ClaraFont.body(16, weight: .semibold)).foregroundStyle(Theme.ink)
                        }
                    }
                    Text("proposed \(timeAgo(c.created_at))").font(ClaraFont.body(13)).foregroundStyle(Theme.muted)
                }
                Spacer()
            }
            if let s = c.summary, !s.isEmpty {
                Text("“\(s)”").font(ClaraFont.body(15).italic()).foregroundStyle(Theme.ink2)
            }
            if c.stale == true {
                VStack(alignment: .leading, spacing: 8) {
                    Text(c.current == nil || c.current?.isNull == true ? "The target was deleted after this was proposed." : "This changed after the proposal; the diff below is against its current state.")
                        .font(ClaraFont.body(14)).foregroundStyle(Theme.amber)
                    if !(c.current == nil || c.current?.isNull == true) {
                        Button("Accept anyway…") { Task { await review(c, accept: true, force: true) } }.buttonStyle(.clara(.secondary, small: true)).disabled(busy == c.id)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.amberSoft, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
            }
            ChangeDiffView(change: c)
            if let e = rowErrors[c.id] { Text(e).font(ClaraFont.body(14)).foregroundStyle(Theme.red) }
            HStack(spacing: 8) {
                Button { Task { await review(c, accept: true) } } label: {
                    HStack { if busy == c.id { Spinner(size: 16) }; Label("Accept", systemImage: "checkmark") }
                }
                .buttonStyle(.claraPrimary)
                Button { Task { await review(c, accept: false) } } label: { Text("Reject") }.buttonStyle(.claraDanger)
                Spacer()
            }
            .disabled(busy == c.id)
        }
    }

    private func load() async {
        do {
            let list = try await api.pendingChanges(workspaceId)
            withAnimation(Theme.easeOut) { changes = list }
            error = nil
        } catch { self.error = errorMessage(error) }
        await model.refreshPending(workspaceId)
    }

    private func review(_ c: PendingChange, accept: Bool, force: Bool = false) async {
        if force, !(await dialogs.confirm(title: "Overwrite newer edits?", message: "This changed after the proposal was made. Accepting replaces those newer edits with the proposal. The current version stays in version history, so you can restore it.", confirmLabel: "Accept and overwrite", danger: true)) { return }
        busy = c.id
        rowErrors[c.id] = nil
        do {
            if accept { try await api.accept(c.id, force: force) } else { try await api.reject(c.id) }
            toasts.success(accept ? "Accepted. The previous version is in history." : "Rejected. Nothing changed.")
        } catch {
            rowErrors[c.id] = errorMessage(error)
        }
        busy = nil
        await load()
    }
}

/// Readable diff of one change (ChangeDiff.tsx): text diff for documents, element changes for diagrams.
struct ChangeDiffView: View {
    let change: PendingChange

    private var created: Bool { change.operation == "create" }
    private var base: JSONObject? { created ? nil : (change.current?.object ?? change.base) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if change.resource_type == .document { documentDiff } else { diagramDiff }
        }
    }

    // MARK: Documents

    @ViewBuilder private var documentDiff: some View {
        let p = change.proposed
        let rows = scalarRows(p, titleKey: "title")
        ForEach(rows, id: \.0) { row in scalar(row.0, before: row.1, after: row.2) }
        if let after = p["contentMd"]?.string, after != base?["contentMd"]?.string {
            TextDiffView(before: created ? "" : base?["contentMd"]?.string ?? "", after: after)
        } else if rows.isEmpty {
            Text("No visible differences.").font(ClaraFont.body(14)).foregroundStyle(Theme.muted)
        }
    }

    private func scalarRows(_ p: JSONObject, titleKey: String) -> [(String, String?, String)] {
        var rows: [(String, String?, String)] = []
        if let t = p[titleKey]?.string, t != base?[titleKey]?.string { rows.append((titleKey == "title" ? "Title" : "Name", base?[titleKey]?.string, t)) }
        if let tags = p["tags"]?.array?.compactMap(\.string) {
            let before = base?["tags"]?.array?.compactMap(\.string)
            if tags != (before ?? []) { rows.append(("Tags", before?.joined(separator: ", "), tags.joined(separator: ", "))) }
        }
        return rows
    }

    private func scalar(_ label: String, before: String?, after: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label).font(ClaraFont.body(14, weight: .semibold)).foregroundStyle(Theme.ink).frame(minWidth: 70, alignment: .leading)
            if let before { DiffChip(text: before.isEmpty ? "(empty)" : before, kind: .del) }
            DiffChip(text: after.isEmpty ? "(empty)" : after, kind: .add)
        }
    }

    // MARK: Diagrams

    @ViewBuilder private var diagramDiff: some View {
        let p = change.proposed
        ForEach(scalarRows(p, titleKey: "name"), id: \.0) { row in scalar(row.0, before: row.1, after: row.2) }
        if let src = p["source"]?["format"]?.string { scalar("Source", before: nil, after: "\(src) source replaced") }
        if let raw = p["elements"], let proposed = decodeElements(raw) {
            let current = base?["elements"].flatMap(decodeElements) ?? []
            let d = SharedJS.shared.diff(current: current, proposed: proposed)
            Text("\(d.added.count) added · \(d.changed.count) changed · \(d.removed.count) removed\(d.unchangedCount > 0 ? " · \(d.unchangedCount) unchanged" : "")")
                .font(ClaraFont.body(13.5)).foregroundStyle(Theme.muted)
            FlowLayout(spacing: 6) {
                ForEach(d.added, id: \.id) { DiffChip(text: "+ \(SharedJS.shared.describe($0))", kind: .add) }
                ForEach(d.changed, id: \.id) { DiffChip(text: "~ \(SharedJS.shared.describe($0.after)) (\($0.fields.joined(separator: ", ")))", kind: .change) }
                ForEach(d.removed, id: \.id) { DiffChip(text: "− \(SharedJS.shared.describe($0))", kind: .del) }
            }
            // The proposal drawn, with what it adds or changes outlined in amber.
            let marks = Dictionary(uniqueKeysWithValues: (d.added.map(\.id) + d.changed.map(\.id)).map { ($0, Theme.amber) })
            DiagramViewer(elements: proposed.map { Resolved(element: $0, hidden: false) }, highlights: marks, inline: true, maxFitScale: 1.1)
                .frame(height: 260)
                .clipShape(RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
        }
    }

    private func decodeElements(_ v: JSONValue) -> [DiagramElement]? {
        guard let data = try? JSON.encoder.encode(v) else { return nil }
        return try? JSON.decoder.decode([DiagramElement].self, from: data)
    }
}

struct DiffChip: View {
    enum Kind { case add, del, change }
    let text: String
    let kind: Kind
    var body: some View {
        Text(text)
            .font(ClaraFont.body(14))
            .strikethrough(kind == .del, color: Theme.red)
            .foregroundStyle(kind == .add ? Theme.green : kind == .del ? Theme.red : Theme.cobaltInk)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(kind == .add ? Theme.greenSoft : kind == .del ? Theme.redSoft : Theme.cobaltSoft, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

/// Line diff with long unchanged runs collapsed (`.diff-text`).
struct TextDiffView: View {
    let before: String
    let after: String
    var maxHeight: CGFloat = 340

    var body: some View {
        let parts = SharedJS.shared.lineDiff(before, after)
        ScrollView([.vertical, .horizontal]) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                    let lines = part.op == "same" && part.lines.count > 6
                        ? Array(part.lines.prefix(2)) + ["… \(part.lines.count - 4) unchanged lines …"] + Array(part.lines.suffix(2))
                        : part.lines
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        let mark = line.hasPrefix("… ") ? "" : part.op == "add" ? "+ " : part.op == "del" ? "- " : "  "
                        Text(mark + line)
                            .font(ClaraFont.mono(12.5))
                            .foregroundStyle(part.op == "add" ? Theme.green : part.op == "del" ? Theme.red : Theme.muted)
                            .padding(.horizontal, 8).padding(.vertical, 1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(part.op == "add" ? Theme.greenSoft : part.op == "del" ? Theme.redSoft : .clear)
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .frame(maxHeight: maxHeight)
        .background(Theme.paper, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
    }
}
