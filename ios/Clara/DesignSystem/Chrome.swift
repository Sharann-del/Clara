import SwiftUI
import UIKit

// Clara's own chrome. The app never uses system navigation bars, sheets, menus, pickers or
// context menus (they render as Liquid Glass); these components replace them with the same
// solid surfaces as the web (`.menu-popover`, `.dialog-panel`, `.topbar`).

// MARK: - Menus (`.menu-popover`)

struct ClaraMenuItem: Identifiable {
    let id = UUID()
    var title: String
    var symbol: String?
    var destructive = false
    var checked = false
    var disabled = false
    var action: () -> Void
}

enum ClaraMenuEntry: Identifiable {
    case item(ClaraMenuItem)
    case separator(UUID = UUID())
    case header(String)

    var id: String {
        switch self {
        case .item(let i): i.id.uuidString
        case .separator(let u): u.uuidString
        case .header(let t): "h:" + t
        }
    }

    static func action(_ title: String, _ symbol: String? = nil, destructive: Bool = false, checked: Bool = false, disabled: Bool = false, _ action: @escaping () -> Void) -> ClaraMenuEntry {
        .item(ClaraMenuItem(title: title, symbol: symbol, destructive: destructive, checked: checked, disabled: disabled, action: action))
    }

    static var divider: ClaraMenuEntry { .separator() }
}

@resultBuilder
enum MenuBuilder {
    static func buildExpression(_ e: ClaraMenuEntry) -> [ClaraMenuEntry] { [e] }
    static func buildExpression(_ e: [ClaraMenuEntry]) -> [ClaraMenuEntry] { e }
    static func buildBlock(_ parts: [ClaraMenuEntry]...) -> [ClaraMenuEntry] { parts.flatMap { $0 } }
    static func buildOptional(_ e: [ClaraMenuEntry]?) -> [ClaraMenuEntry] { e ?? [] }
    static func buildEither(first e: [ClaraMenuEntry]) -> [ClaraMenuEntry] { e }
    static func buildEither(second e: [ClaraMenuEntry]) -> [ClaraMenuEntry] { e }
    static func buildArray(_ e: [[ClaraMenuEntry]]) -> [ClaraMenuEntry] { e.flatMap { $0 } }
}

@Observable
final class MenuCenter {
    struct Presented { let entries: [ClaraMenuEntry]; let anchor: CGRect; let id = UUID() }
    var current: Presented?

    func show(_ entries: [ClaraMenuEntry], anchor: CGRect) {
        UISelectionFeedbackGenerator().selectionChanged()
        withAnimation(Theme.spring) { current = Presented(entries: entries, anchor: anchor) }
    }

    func dismiss() { withAnimation(Theme.fast) { current = nil } }
}

/// A button that opens a Clara menu anchored to itself.
struct ClaraMenu<Label: View>: View {
    var accessibilityLabel: String
    @MenuBuilder var entries: () -> [ClaraMenuEntry]
    @ViewBuilder var label: () -> Label
    @Environment(MenuCenter.self) private var menus
    @State private var frame: CGRect = .zero

    init(_ accessibilityLabel: String, @MenuBuilder entries: @escaping () -> [ClaraMenuEntry], @ViewBuilder label: @escaping () -> Label) {
        self.accessibilityLabel = accessibilityLabel
        self.entries = entries
        self.label = label
    }

    var body: some View {
        Button { menus.show(entries(), anchor: frame) } label: { label() }
            .buttonStyle(PressScale())
            .accessibilityLabel(accessibilityLabel)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
    }
}

/// The "…" button (`.btn-icon` with a more icon).
struct MoreMenu: View {
    var label = "More actions"
    @MenuBuilder var entries: () -> [ClaraMenuEntry]
    var body: some View {
        ClaraMenu(label, entries: entries) {
            Image(systemName: "ellipsis").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink2).frame(width: 40, height: 40).contentShape(Rectangle())
        }
    }
}

/// A select-like control whose options open in a Clara menu (replaces `Picker(.menu)`).
struct ClaraSelect<T: Hashable>: View {
    let label: String
    @Binding var selection: T
    let options: [(T, String)]
    var background: Color = Theme.surface2
    var height: CGFloat = 44

    var body: some View {
        ClaraMenu(label) {
            for (value, title) in options {
                ClaraMenuEntry.action(title, checked: value == selection) { selection = value }
            }
        } label: {
            HStack(spacing: 6) {
                Text(options.first { $0.0 == selection }?.1 ?? "")
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.muted)
            }
            .font(ClaraFont.body(15)).foregroundStyle(Theme.ink)
            .padding(.horizontal, 12).frame(height: height)
            .background(background, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
        }
    }
}

struct MenuOverlay: View {
    @Environment(MenuCenter.self) private var menus
    private let width: CGFloat = 260

    var body: some View {
        GeometryReader { geo in
            if let m = menus.current {
                let size = geo.size
                let height = estimatedHeight(m.entries)
                let x = min(max(12, m.anchor.maxX - width), size.width - width - 12)
                let below = m.anchor.maxY + 6 + height < size.height - 20
                let y = below ? m.anchor.maxY + 6 : max(20, m.anchor.minY - 6 - height)
                ZStack(alignment: .topLeading) {
                    // Invisible tap catcher (menus have no backdrop on the web either).
                    Rectangle().fill(Color.black.opacity(0.001)).onTapGesture { menus.dismiss() }
                    VStack(spacing: 0) {
                        ForEach(m.entries) { entry in row(entry) }
                    }
                    .padding(5)
                    .frame(width: width)
                    .background(Theme.surface3, in: RoundedRectangle(cornerRadius: Theme.rMd + 2, style: .continuous))
                    .offset(x: x, y: y)
                    .transition(.scale(scale: 0.95, anchor: below ? .top : .bottom).combined(with: .opacity))
                }
                .id(m.id)
            }
        }
        .ignoresSafeArea()
    }

    private func estimatedHeight(_ entries: [ClaraMenuEntry]) -> CGFloat {
        entries.reduce(10) { h, e in
            switch e { case .item: h + 44; case .separator: h + 9; case .header: h + 30 }
        }
    }

    @ViewBuilder private func row(_ entry: ClaraMenuEntry) -> some View {
        switch entry {
        case .item(let item):
            Button {
                menus.dismiss()
                item.action()
            } label: {
                HStack(spacing: 11) {
                    if let s = item.symbol { Image(systemName: s).font(.system(size: 15)).frame(width: 20) }
                    Text(item.title).font(ClaraFont.body(15.5)).lineLimit(1)
                    Spacer(minLength: 8)
                    if item.checked { Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.cobalt) }
                }
                .foregroundStyle(item.disabled ? Theme.muted : item.destructive ? Theme.red : Theme.ink)
                .padding(.horizontal, 11).frame(height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(MenuRowPress())
            .disabled(item.disabled)
        case .separator:
            Rectangle().fill(Theme.surface4).frame(height: 1).padding(.vertical, 4).padding(.horizontal, 6)
        case .header(let t):
            Text(t).eyebrowStyle().frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 11).frame(height: 30)
        }
    }
}

private struct MenuRowPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(configuration.isPressed ? Theme.surface4 : .clear, in: RoundedRectangle(cornerRadius: Theme.rSm, style: .continuous))
    }
}

// MARK: - Sheets (`.dialog-panel`): bottom panel on iPhone, centred card on iPad

private struct ClaraDismissKey: EnvironmentKey { static let defaultValue: () -> Void = {} }
extension EnvironmentValues {
    /// Closes the Clara sheet this view is in.
    var claraDismiss: () -> Void {
        get { self[ClaraDismissKey.self] }
        set { self[ClaraDismissKey.self] = newValue }
    }
}

private struct ClaraSheetModifier<Sheet: View>: ViewModifier {
    @Binding var isPresented: Bool
    var modal: Bool
    var compactHeight: CGFloat?
    @ViewBuilder var sheet: () -> Sheet
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var drag: CGFloat = 0

    func body(content: Content) -> some View {
        content.overlay {
            GeometryReader { geo in
                ZStack(alignment: hSize == .regular ? .center : .bottom) {
                    if isPresented {
                        if modal {
                            Theme.scrim.ignoresSafeArea().onTapGesture { close() }.transition(.opacity)
                        }
                        panel(geo.size)
                            .transition(hSize == .regular ? .scale(scale: 0.96).combined(with: .opacity) : .move(edge: .bottom))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .animation(Theme.spring, value: isPresented)
            }
            .ignoresSafeArea(.container, edges: .bottom)
        }
    }

    private func close() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        isPresented = false
    }

    @ViewBuilder private func panel(_ size: CGSize) -> some View {
        let regular = hSize == .regular
        VStack(spacing: 0) {
            if !regular {
                Capsule().fill(Theme.surface4).frame(width: 40, height: 5).padding(.top, 8).padding(.bottom, 4)
                    .frame(maxWidth: .infinity).contentShape(Rectangle())
                    .gesture(DragGesture().onChanged { drag = max(0, $0.translation.height) }.onEnded { v in
                        if v.translation.height > 90 { close() }
                        withAnimation(Theme.spring) { drag = 0 }
                    })
            }
            sheet().environment(\.claraDismiss, close)
        }
        .frame(maxWidth: regular ? 600 : .infinity)
        .frame(height: regular ? nil : compactHeight, alignment: .top)
        .frame(maxHeight: regular ? size.height * 0.82 : size.height * 0.9, alignment: .top)
        .background(Theme.surface, in: UnevenRoundedRectangle(topLeadingRadius: Theme.rLg + 4, bottomLeadingRadius: regular ? Theme.rLg + 4 : 0, bottomTrailingRadius: regular ? Theme.rLg + 4 : 0, topTrailingRadius: Theme.rLg + 4, style: .continuous))
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: Theme.rLg + 4, bottomLeadingRadius: regular ? Theme.rLg + 4 : 0, bottomTrailingRadius: regular ? Theme.rLg + 4 : 0, topTrailingRadius: Theme.rLg + 4, style: .continuous))
        .offset(y: drag)
        .padding(regular ? 24 : 0)
    }
}

private struct ClaraItemSheetModifier<Item: Identifiable, Sheet: View>: ViewModifier {
    @Binding var item: Item?
    var modal: Bool
    @ViewBuilder var sheet: (Item) -> Sheet
    func body(content: Content) -> some View {
        content.modifier(ClaraSheetModifier(isPresented: Binding(get: { item != nil }, set: { if !$0 { item = nil } }), modal: modal, compactHeight: nil) {
            if let item { sheet(item) }
        })
    }
}

extension View {
    /// A solid Clara panel over this view (never a system sheet).
    func claraSheet<S: View>(isPresented: Binding<Bool>, modal: Bool = true, compactHeight: CGFloat? = nil, @ViewBuilder content: @escaping () -> S) -> some View {
        modifier(ClaraSheetModifier(isPresented: isPresented, modal: modal, compactHeight: compactHeight, sheet: content))
    }

    func claraSheet<Item: Identifiable, S: View>(item: Binding<Item?>, modal: Bool = true, @ViewBuilder content: @escaping (Item) -> S) -> some View {
        modifier(ClaraItemSheetModifier(item: item, modal: modal, sheet: content))
    }
}

/// Title row for a sheet: Cancel · Title · primary action.
struct SheetHeader: View {
    let title: String
    var confirm: String?
    var confirmDisabled = false
    var onConfirm: () -> Void = {}
    @Environment(\.claraDismiss) private var dismiss

    var body: some View {
        HStack(spacing: 10) {
            Button("Cancel") { dismiss() }.buttonStyle(.clara(.ghost, small: true))
            Spacer(minLength: 4)
            Text(title).font(ClaraFont.display(17, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1)
            Spacer(minLength: 4)
            if let confirm {
                Button(confirm) { onConfirm(); dismiss() }.buttonStyle(.clara(.primary, small: true)).disabled(confirmDisabled)
            } else {
                Color.clear.frame(width: 60, height: 1)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
    }
}

// MARK: - Top bar (`.topbar`), replacing the system navigation bar

private struct IsPushedKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    /// True for pages pushed onto the stack (they get a back button).
    var isPushed: Bool {
        get { self[IsPushedKey.self] }
        set { self[IsPushedKey.self] = newValue }
    }
}

private struct TopBarModifier<Trailing: View>: ViewModifier {
    let title: String
    @ViewBuilder var trailing: () -> Trailing
    @Environment(\.isPushed) private var pushed
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @Environment(\.shellIsWide) private var wide

    func body(content: Content) -> some View {
        content
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .top, spacing: 0) {
                HStack(spacing: 6) {
                    if pushed {
                        Button { dismiss() } label: {
                            Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink).frame(width: 40, height: 40).contentShape(Rectangle())
                        }
                        .buttonStyle(PressScale()).accessibilityLabel("Back")
                    } else if !wide {
                        Button { model.toggleDrawer() } label: {
                            Image(systemName: "line.3.horizontal").font(.system(size: 18, weight: .medium)).foregroundStyle(Theme.ink).frame(width: 40, height: 40).contentShape(Rectangle())
                        }
                        .buttonStyle(PressScale()).accessibilityLabel("Open navigation")
                    }
                    Text(title).font(ClaraFont.body(16, weight: .semibold)).foregroundStyle(Theme.ink).lineLimit(1).truncationMode(.middle)
                        .padding(.leading, pushed || !wide ? 0 : 10)
                    Spacer(minLength: 8)
                    HStack(spacing: 4) { trailing() }
                }
                .padding(.horizontal, 8)
                .frame(height: 54)
                .background(Theme.paper)
            }
    }
}

extension View {
    /// Clara's page header: back (pushed) or menu (iPhone root), title, trailing actions.
    func claraTopBar<T: View>(_ title: String, @ViewBuilder trailing: @escaping () -> T) -> some View {
        modifier(TopBarModifier(title: title, trailing: trailing)).background(Theme.paper)
    }

    func claraTopBar(_ title: String) -> some View { claraTopBar(title) { EmptyView() } }
}

private struct ShellIsWideKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    /// The sidebar is always on screen (iPad / wide windows).
    var shellIsWide: Bool {
        get { self[ShellIsWideKey.self] }
        set { self[ShellIsWideKey.self] = newValue }
    }
}

/// Keep the edge-swipe back gesture working with the system navigation bar hidden.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1
    }
}

// MARK: - System share (the OS share panel; used only to hand files and links to other apps)

enum SystemShare {
    static func present(_ items: [Any]) {
        guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
              var top = scene.windows.first(where: \.isKeyWindow)?.rootViewController else { return }
        while let next = top.presentedViewController { top = next }
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        vc.popoverPresentationController?.sourceView = top.view
        vc.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: 60, width: 1, height: 1)
        top.present(vc, animated: true)
    }
}

/// −  value  +  (replaces `Stepper`).
struct ClaraStepper: View {
    let value: Double
    let range: ClosedRange<Double>
    var step: Double = 1
    var format: (Double) -> String = { "\(Int($0))" }
    let onChange: (Double) -> Void

    var body: some View {
        HStack(spacing: 0) {
            button("minus", enabled: value - step >= range.lowerBound) { onChange(value - step) }
            Text(format(value)).font(ClaraFont.body(15)).monospacedDigit().foregroundStyle(Theme.ink).frame(minWidth: 64)
            button("plus", enabled: value + step <= range.upperBound) { onChange(value + step) }
        }
        .padding(3)
        .background(Theme.surface3, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
    }

    private func button(_ symbol: String, enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: symbol).font(.system(size: 13, weight: .semibold)).frame(width: 36, height: 34) }
            .buttonStyle(PressScale()).foregroundStyle(enabled ? Theme.ink : Theme.lineStrong).disabled(!enabled)
    }
}
