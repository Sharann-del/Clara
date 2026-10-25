import SwiftUI

// MARK: - Buttons (`.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`)

enum ClaraButtonKind { case primary, secondary, ghost, danger, dangerSolid }

struct ClaraButtonStyle: ButtonStyle {
    var kind: ClaraButtonKind = .secondary
    var size: ControlSize = .regular
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let small = size == .small || size == .mini
        configuration.label
            .font(ClaraFont.body(small ? 14 : 15, weight: kind == .primary ? .semibold : .medium))
            .lineLimit(1)
            .padding(.horizontal, kind == .ghost && small ? 8 : (small ? 11 : 15))
            .frame(minHeight: small ? 32 : 40)
            .foregroundStyle(foreground)
            .background(background(pressed: configuration.isPressed), in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: Theme.rSm + 1))
            .scaleEffect(configuration.isPressed && enabled ? 0.97 : 1)
            .animation(Theme.fast, value: configuration.isPressed)
    }

    private var foreground: Color {
        guard enabled else { return Theme.muted }
        switch kind {
        case .primary: return Theme.primaryFg
        case .danger: return Theme.red
        case .dangerSolid: return Color(hex: 0x1A0605)
        default: return Theme.ink
        }
    }

    private func background(pressed: Bool) -> Color {
        switch kind {
        case .primary: return enabled ? (pressed ? .white : Theme.primary) : Theme.surface3
        case .secondary: return pressed ? Theme.surface4 : Theme.surface3
        case .ghost, .danger: return pressed ? Theme.surface2 : .clear
        case .dangerSolid: return pressed ? Color(hex: 0xF59A91) : Theme.red
        }
    }
}

extension ButtonStyle where Self == ClaraButtonStyle {
    static var claraPrimary: ClaraButtonStyle { .init(kind: .primary) }
    static var claraSecondary: ClaraButtonStyle { .init(kind: .secondary) }
    static var claraGhost: ClaraButtonStyle { .init(kind: .ghost) }
    static var claraDanger: ClaraButtonStyle { .init(kind: .danger) }
    static func clara(_ kind: ClaraButtonKind, small: Bool = false) -> ClaraButtonStyle { .init(kind: kind, size: small ? .small : .regular) }
}

/// Square icon button (`.btn-icon`).
struct IconButton: View {
    let symbol: String
    var label: String
    var active = false
    var tint: Color = Theme.ink2
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .medium))
                .frame(width: 40, height: 40)
                .foregroundStyle(active ? Theme.accentFg : tint)
                .background(active ? Theme.cobalt : .clear, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(PressScale())
        .accessibilityLabel(label)
    }
}

/// Just the press feedback, for custom-drawn buttons.
struct PressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(Theme.fast, value: configuration.isPressed)
    }
}

// MARK: - Inputs (`.input`)

struct ClaraFieldStyle: ViewModifier {
    var focused: Bool
    var background: Color = Theme.surface2
    func body(content: Content) -> some View {
        content
            .font(ClaraFont.body(16))
            .foregroundStyle(Theme.ink)
            .tint(Theme.cobalt)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(focused ? Theme.surface3 : background, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous).strokeBorder(Theme.cobalt, lineWidth: focused ? 2 : 0))
            .animation(Theme.fast, value: focused)
    }
}

/// Labelled text field with focus ring (`.field` + `.input`).
struct ClaraTextField: View {
    var label: String?
    var placeholder: String
    @Binding var text: String
    var secure = false
    var keyboard: UIKeyboardType = .default
    var contentType: UITextContentType?
    var background: Color = Theme.surface2
    var submitLabel: SubmitLabel = .done
    var onSubmit: () -> Void = {}
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let label { Text(label).font(ClaraFont.body(14, weight: .medium)).foregroundStyle(Theme.ink2) }
            Group {
                if secure {
                    SecureField("", text: $text, prompt: Text(placeholder).foregroundStyle(Theme.muted))
                } else {
                    TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Theme.muted))
                        .keyboardType(keyboard)
                }
            }
            .textContentType(contentType)
            .textInputAutocapitalization(keyboard == .emailAddress || secure ? .never : .sentences)
            .autocorrectionDisabled(keyboard == .emailAddress || secure)
            .focused($focused)
            .submitLabel(submitLabel)
            .onSubmit(onSubmit)
            .modifier(ClaraFieldStyle(focused: focused, background: background))
        }
    }
}

// MARK: - Surfaces

/// Rounded surface block (`.card`, `.panel`).
struct Card<Content: View>: View {
    var background: Color = Theme.surface
    var padding: CGFloat = 20
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 14) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background, in: RoundedRectangle(cornerRadius: Theme.rLg, style: .continuous))
    }
}

struct CardHeader: View {
    let title: String
    var subtitle: String?
    var count: Int?
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(title).font(ClaraFont.display(18, weight: .semibold)).foregroundStyle(Theme.ink)
                if let count {
                    Text("\(count)").font(ClaraFont.body(13, weight: .semibold)).foregroundStyle(Theme.ink2)
                        .padding(.horizontal, 9).padding(.vertical, 1).background(Theme.surface3, in: Capsule())
                }
            }
            if let subtitle { Text(subtitle).font(ClaraFont.body(14.5)).foregroundStyle(Theme.muted) }
        }
    }
}

// MARK: - Tags, badges, avatars

enum TagTone { case accent, amber, green, neutral }

struct TagChip: View {
    let text: String
    var tone: TagTone = .accent
    var count: Int?
    var body: some View {
        HStack(spacing: 4) {
            Text(text)
            if let count { Text("\(count)").foregroundStyle(Theme.muted) }
        }
        .font(ClaraFont.body(12.5, weight: .medium))
        .lineLimit(1)
        .padding(.horizontal, 9).padding(.vertical, 2)
        .foregroundStyle(fg)
        .background(bg, in: Capsule())
    }
    private var fg: Color {
        switch tone { case .accent: Theme.cobaltInk; case .amber: Theme.amber; case .green: Theme.green; case .neutral: Theme.ink2 }
    }
    private var bg: Color {
        switch tone { case .accent: Theme.cobaltSoft; case .amber: Theme.amberSoft; case .green: Theme.greenSoft; case .neutral: Theme.surface3 }
    }
}

/// Amber count badge: only ever used for "AI changes waiting for review".
struct PendingBadge: View {
    let count: Int
    var body: some View {
        Text("\(count)")
            .font(ClaraFont.body(12, weight: .bold))
            .foregroundStyle(Color(hex: 0x2B1A00))
            .padding(.horizontal, 6)
            .frame(minWidth: 20, minHeight: 20)
            .background(Theme.amber, in: Capsule())
            .transition(.scale.combined(with: .opacity))
    }
}

/// Letter avatar (`.ws-avatar`). Square for workspaces, round for people.
struct Avatar: View {
    let text: String
    var round = true
    var size: CGFloat = 26
    var color: Color = Theme.cobalt
    var body: some View {
        Text(String(text.prefix(1)).uppercased())
            .font(ClaraFont.body(size * 0.46, weight: .bold))
            .foregroundStyle(round ? Theme.accentFg : Theme.paper)
            .frame(width: size, height: size)
            .background(round ? color : Theme.ink, in: RoundedRectangle(cornerRadius: round ? size / 2 : size * 0.27, style: .continuous))
    }
}

/// Coloured tile behind an item icon (`.item-icon-*`).
struct KindIcon: View {
    let kind: ItemKind
    var size: CGFloat = 34
    var body: some View {
        Image(systemName: kind.symbol)
            .font(.system(size: size * 0.44, weight: .medium))
            .foregroundStyle(kind == .document ? Theme.cobaltInk : kind == .diagram ? Theme.green : Theme.ink2)
            .frame(width: size, height: size)
            .background(kind == .document ? Theme.cobaltSoft : kind == .diagram ? Theme.greenSoft : Theme.surface3, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

// MARK: - Empty, loading

struct EmptyStateView<Actions: View>: View {
    let symbol: String
    let title: String
    var message: String?
    var compact = false
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: compact ? 16 : 19, weight: .medium))
                .foregroundStyle(Theme.cobaltInk)
                .frame(width: compact ? 36 : 44, height: compact ? 36 : 44)
                .background(Theme.cobaltSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.bottom, 4)
            Text(title).font(ClaraFont.display(17, weight: .semibold)).foregroundStyle(Theme.ink)
            if let message {
                Text(message).font(ClaraFont.body(15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center).frame(maxWidth: 420)
            }
            HStack(spacing: 8) { actions }.padding(.top, 8)
        }
        .padding(.vertical, compact ? 20 : 36).padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.rLg, style: .continuous))
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }
}

extension EmptyStateView where Actions == EmptyView {
    init(symbol: String, title: String, message: String? = nil, compact: Bool = false) {
        self.init(symbol: symbol, title: title, message: message, compact: compact) { EmptyView() }
    }
}

/// Shimmering placeholder rows (`.skeleton`).
struct SkeletonRows: View {
    var rows = 4
    var height: CGFloat = 48
    @State private var phase: CGFloat = -1

    var body: some View {
        VStack(spacing: 6) {
            ForEach(0..<rows, id: \.self) { i in
                RoundedRectangle(cornerRadius: Theme.rSm, style: .continuous)
                    .fill(Theme.surface2)
                    .overlay(
                        LinearGradient(colors: [Theme.surface2, Theme.surface3, Theme.surface2], startPoint: .leading, endPoint: .trailing)
                            .scaleEffect(x: 2, anchor: .leading)
                            .offset(x: phase * 300)
                            .mask(RoundedRectangle(cornerRadius: Theme.rSm, style: .continuous))
                    )
                    .frame(height: height)
                    .opacity(1 - Double(i) * 0.12)
            }
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.3).repeatForever(autoreverses: false)) { phase = 1 }
        }
        .accessibilityLabel("Loading")
    }
}

struct Spinner: View {
    var size: CGFloat = 22
    @State private var spin = false
    var body: some View {
        Circle()
            .trim(from: 0, to: 0.25)
            .stroke(Theme.cobalt, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
            .background(Circle().stroke(Theme.surface3, lineWidth: 2.5))
            .frame(width: size, height: size)
            .rotationEffect(.degrees(spin ? 360 : 0))
            .onAppear { withAnimation(.linear(duration: 0.8).repeatForever(autoreverses: false)) { spin = true } }
    }
}

// MARK: - Segmented control (`.segmented`)

struct Segmented<T: Hashable>: View {
    let options: [(T, String)]
    @Binding var selection: T
    @Namespace private var ns

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.0) { value, label in
                Button {
                    withAnimation(Theme.spring) { selection = value }
                } label: {
                    Text(label)
                        .font(ClaraFont.body(14, weight: .medium))
                        .foregroundStyle(selection == value ? Theme.ink : Theme.muted)
                        .padding(.horizontal, 11).frame(height: 32)
                        .background {
                            if selection == value {
                                RoundedRectangle(cornerRadius: 5, style: .continuous).fill(Theme.surface4).matchedGeometryEffect(id: "seg", in: ns)
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == value ? .isSelected : [])
            }
        }
        .padding(2)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rSm + 1, style: .continuous))
    }
}

// MARK: - Page chrome

/// Big title + subtitle (+ trailing actions), like `.page-head`.
struct PageHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .bottom, spacing: 16) {
                titles
                Spacer(minLength: 12)
                HStack(spacing: 8) { trailing }
            }
            VStack(alignment: .leading, spacing: 14) {
                titles
                HStack(spacing: 8) { trailing }
            }
        }
    }

    private var titles: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).pageTitleStyle().fixedSize(horizontal: false, vertical: true)
            if let subtitle { Text(subtitle).font(ClaraFont.body(15)).foregroundStyle(Theme.muted) }
        }
    }
}

extension PageHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) { self.init(title: title, subtitle: subtitle) { EmptyView() } }
}

struct SectionHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing
    var body: some View {
        HStack {
            Text(title).sectionTitleStyle()
            Spacer()
            trailing
        }
        .padding(.top, 28).padding(.bottom, 4)
    }
}

extension SectionHeader where Trailing == EmptyView {
    init(title: String) { self.init(title: title) { EmptyView() } }
}

/// Scrollable page body with the app's paddings, max width and entrance animation.
struct PageScroll<Content: View>: View {
    var maxWidth: CGFloat = .infinity
    @ViewBuilder var content: Content
    @State private var shown = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) { content }
                .frame(maxWidth: maxWidth, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 48)
                .frame(maxWidth: .infinity)
                .opacity(shown ? 1 : 0)
                .offset(y: shown ? 0 : 8)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.basedOnSize)
        .background(Theme.paper)
        .onAppear { withAnimation(Theme.easeOut) { shown = true } }
    }
}

/// Staggered fade-up entrance for list rows (`.item-row` animation).
struct FadeUp: ViewModifier {
    var index: Int
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 8)
            .onAppear { withAnimation(Theme.easeOut.delay(Double(min(index, 6)) * 0.02)) { shown = true } }
    }
}

extension View {
    func fadeUp(_ index: Int = 0) -> some View { modifier(FadeUp(index: index)) }

}
