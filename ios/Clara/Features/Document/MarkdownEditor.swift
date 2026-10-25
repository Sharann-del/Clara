import SwiftUI

/// Markdown source editor with a formatting bar (MarkdownEditor.tsx / mdEdit.ts). Every action
/// works on the current selection: wrap it, or prefix the lines it touches.
struct MarkdownEditor: View {
    @Binding var text: String
    var onChange: () -> Void
    var onInsertDiagram: () -> Void

    @State private var selection: TextSelection?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            formatBar
            TextEditor(text: $text, selection: $selection)
                .font(ClaraFont.mono(15))
                .foregroundStyle(Theme.ink)
                .scrollContentBackground(.hidden)
                .lineSpacing(5)
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .focused($focused)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.sentences)
                .background(Theme.surface)
                .onChange(of: text) { _, _ in onChange() }
        }
        .clipShape(RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var formatBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                tool("number", "Heading") { prefixLines("## ") }
                tool("bold", "Bold", key: "b") { wrap("**", "**", placeholder: "bold") }
                tool("italic", "Italic", key: "i") { wrap("_", "_", placeholder: "italic") }
                tool("chevron.left.forwardslash.chevron.right", "Inline code", key: "e") { wrap("`", "`", placeholder: "code") }
                divider
                tool("list.bullet", "Bulleted list") { prefixLines("- ") }
                tool("list.number", "Numbered list") { prefixLines("1. ") }
                tool("checklist", "Task list") { prefixLines("- [ ] ") }
                tool("text.quote", "Quote") { prefixLines("> ") }
                divider
                tool("link", "Link") { wrap("[", "](https://)", placeholder: "link text") }
                tool("curlybraces", "Code block") { wrap("\n```\n", "\n```\n", placeholder: "code") }
                tool("tablecells", "Table") { insert("\n| Column | Column |\n| --- | --- |\n| Cell | Cell |\n") }
                tool("photo", "Image") { wrap("![", "](https://)", placeholder: "alt text") }
                tool("minus", "Divider") { insert("\n---\n") }
                divider
                Button(action: onInsertDiagram) {
                    Label("Insert diagram", systemImage: "point.3.connected.trianglepath.dotted").font(ClaraFont.body(14, weight: .medium))
                }
                .buttonStyle(.clara(.ghost, small: true))
                if focused {
                    Button { focused = false } label: { Image(systemName: "keyboard.chevron.compact.down") }
                        .buttonStyle(.clara(.ghost, small: true)).accessibilityLabel("Hide keyboard")
                }
            }
            .padding(4)
        }
        .background(Theme.surface2)
    }

    private var divider: some View { Rectangle().fill(Theme.surface4).frame(width: 1, height: 20).padding(.horizontal, 4) }

    private func tool(_ symbol: String, _ label: String, key: KeyEquivalent? = nil, action: @escaping () -> Void) -> some View {
        let button = Button(action: { action(); UISelectionFeedbackGenerator().selectionChanged() }) {
            Image(systemName: symbol).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.ink2).frame(width: 36, height: 34).contentShape(Rectangle())
        }
        .buttonStyle(PressScale())
        .accessibilityLabel(label)
        return Group {
            if let key { button.keyboardShortcut(key, modifiers: .command) } else { button }
        }
    }

    // MARK: Editing on the selection

    /// Selected character range as offsets (end == start for a caret; end of text when unknown).
    private var range: (Int, Int) {
        guard let sel = selection, case .selection(let r) = sel.indices else { return (text.count, text.count) }
        let lo = min(text.distance(from: text.startIndex, to: r.lowerBound), text.count)
        let hi = min(text.distance(from: text.startIndex, to: r.upperBound), text.count)
        return (lo, hi)
    }

    private func index(_ offset: Int) -> String.Index { text.index(text.startIndex, offsetBy: min(max(0, offset), text.count)) }

    private func select(_ lo: Int, _ hi: Int) {
        let a = index(lo), b = index(hi)
        selection = TextSelection(range: a..<b)
    }

    private func wrap(_ before: String, _ after: String, placeholder: String) {
        let (lo, hi) = range
        let selected = String(text[index(lo)..<index(hi)])
        let inner = selected.isEmpty ? placeholder : selected
        text.replaceSubrange(index(lo)..<index(hi), with: before + inner + after)
        select(lo + before.count, lo + before.count + inner.count)
        focused = true
    }

    private func insert(_ snippet: String) {
        let (lo, hi) = range
        text.replaceSubrange(index(lo)..<index(hi), with: snippet)
        select(lo + snippet.count, lo + snippet.count)
        focused = true
    }

    /// Adds `prefix` to every line the selection touches (or removes it when all already have it).
    private func prefixLines(_ prefix: String) {
        let (lo, hi) = range
        var start = index(lo)
        while start > text.startIndex, text[text.index(before: start)] != "\n" { start = text.index(before: start) }
        var end = index(hi)
        while end < text.endIndex, text[end] != "\n" { end = text.index(after: end) }
        let block = String(text[start..<end])
        let lines = block.components(separatedBy: "\n")
        let all = lines.allSatisfy { $0.hasPrefix(prefix) }
        let next = lines.map { all ? String($0.dropFirst(prefix.count)) : prefix + $0 }.joined(separator: "\n")
        let startOffset = text.distance(from: text.startIndex, to: start)
        text.replaceSubrange(start..<end, with: next)
        select(startOffset + next.count, startOffset + next.count)
        focused = true
    }
}

/// Pick a diagram from the workspace, or create one (InsertDiagramDialog.tsx / DiagramPicker).
struct DiagramPickerSheet: View {
    let workspaceId: String
    var title = "Pick a diagram"
    var excludeIds: [String] = []
    var allowCreate = false
    var confirmLabel = "Insert"
    let onPick: (String) -> Void

    @Environment(APIClient.self) private var api
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.claraDismiss) private var dismiss
    @State private var diagrams: [DiagramSummary]?
    @State private var query = ""
    @State private var newName = ""

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: title)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if allowCreate {
                        Text("New diagram").eyebrowStyle()
                        HStack(spacing: 8) {
                            ClaraTextField(placeholder: "Name, e.g. Checkout flow", text: $newName, onSubmit: { Task { await create() } })
                            Button("Create") { Task { await create() } }.buttonStyle(.claraPrimary).disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                    Text("In this workspace").eyebrowStyle().padding(.top, allowCreate ? 8 : 0)
                    ClaraTextField(placeholder: "Filter diagrams", text: $query)
                    if let diagrams {
                        let list = diagrams.filter { !excludeIds.contains($0.id) && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)) }
                        if list.isEmpty { Text("No diagrams match.").font(ClaraFont.body(15)).foregroundStyle(Theme.muted).padding(.vertical, 12) }
                        VStack(spacing: 2) {
                            ForEach(list) { d in
                                Button { onPick(d.id); dismiss() } label: {
                                    HStack(spacing: 12) {
                                        KindIcon(kind: .diagram, size: 32)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(d.name).font(ClaraFont.body(15.5, weight: .medium)).foregroundStyle(Theme.ink)
                                            Text(timeAgo(d.updated_at)).font(ClaraFont.body(13)).foregroundStyle(Theme.muted)
                                        }
                                        Spacer()
                                        Text(confirmLabel).font(ClaraFont.body(14, weight: .medium)).foregroundStyle(Theme.cobalt)
                                    }
                                    .padding(.horizontal, 10)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(RowPress())
                            }
                        }
                        .padding(4)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
                    } else {
                        Spinner().frame(maxWidth: .infinity).padding(20)
                    }
                }
                .padding(16)
            }
        }
        .task { diagrams = (try? await api.diagrams(workspaceId))?.sorted { ($0.updated_at ?? "") > ($1.updated_at ?? "") } ?? [] }
    }

    private func create() async {
        do {
            let d = try await api.createDiagram(workspaceId, name: newName.trimmingCharacters(in: .whitespaces), folder: nil)
            onPick(d.id)
            dismiss()
        } catch { toasts.error(error) }
    }
}
