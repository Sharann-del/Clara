import SwiftUI

/// Documents, diagrams and folders in one card with column headers (ItemList.tsx).
struct ItemListView: View {
    let items: [ListItem]
    var onTagTap: ((String) -> Void)?
    var onOpenFolder: ((String) -> Void)?
    var menu: ((ListItem) -> AnyView)?
    var showStar = true

    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        VStack(spacing: 2) {
            if hSize == .regular, items.contains(where: { $0.updatedAt != nil }) {
                HStack {
                    Text("Name").eyebrowStyle()
                    Spacer()
                    Text("Updated").eyebrowStyle().padding(.trailing, menu != nil ? 44 : 34)
                }
                .padding(.leading, 56).padding(.trailing, 12).padding(.top, 8).padding(.bottom, 4)
            }
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                row(item).fadeUp(index)
            }
        }
        .padding(6)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.rLg, style: .continuous))
    }

    private func row(_ it: ListItem) -> some View {
        HStack(spacing: 12) {
            Button {
                switch it.kind {
                case .folder: onOpenFolder?(it.itemId)
                case .document: model.open(.document(it.itemId))
                case .diagram: model.open(.diagram(it.itemId))
                }
            } label: {
                HStack(spacing: 12) {
                    KindIcon(kind: it.kind)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(it.name.isEmpty ? "Untitled" : it.name).font(ClaraFont.body(15.5, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1)
                        if hSize != .regular, let sub = subtitle(it) {
                            Text(sub).font(ClaraFont.body(13)).foregroundStyle(Theme.muted).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                    if hSize == .regular {
                        tags(it)
                        if let c = it.context { Text(c).font(ClaraFont.body(13.5)).foregroundStyle(Theme.muted).lineLimit(1) }
                        Text(timeAgo(it.updatedAt)).font(ClaraFont.body(13.5)).foregroundStyle(Theme.muted).frame(minWidth: 96, alignment: .trailing)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(RowPress())
            if showStar, it.kind != .folder, model.isFavorite(it.kind, it.itemId) {
                Image(systemName: "star.fill").font(.system(size: 13)).foregroundStyle(Theme.cobalt).transition(.scale)
            }
            if let menu {
                menu(it)
            }
        }
        .padding(.leading, 10).padding(.trailing, 6).frame(minHeight: 56)
    }

    private func subtitle(_ it: ListItem) -> String? {
        let parts = [it.context, it.updatedAt.map { timeAgo($0) }, it.tags.isEmpty ? nil : it.tags.map { "#\($0)" }.joined(separator: " ")].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    @ViewBuilder private func tags(_ it: ListItem) -> some View {
        HStack(spacing: 4) {
            ForEach(it.tags.prefix(3), id: \.self) { t in
                if let onTagTap { Button { onTagTap(t) } label: { TagChip(text: t) }.buttonStyle(PressScale()) } else { TagChip(text: t) }
            }
        }
    }
}

/// Row highlight on press (`.item-row:hover`).
struct RowPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.vertical, 6)
            .background(configuration.isPressed ? Theme.surface2 : .clear, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
            .animation(Theme.fast, value: configuration.isPressed)
    }
}

