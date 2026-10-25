import SwiftUI

// MARK: - Toasts (`.toast`)

@Observable
final class ToastCenter {
    enum Tone { case info, success, error }
    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let message: String
        let tone: Tone
        var actionLabel: String?
        var action: (() -> Void)?
        static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
    }

    private(set) var toasts: [Toast] = []

    func show(_ message: String, tone: Tone = .info, actionLabel: String? = nil, action: (() -> Void)? = nil) {
        let toast = Toast(message: message, tone: tone, actionLabel: actionLabel, action: action)
        withAnimation(Theme.spring) { toasts.append(toast) }
        let haptic = UINotificationFeedbackGenerator()
        haptic.notificationOccurred(tone == .error ? .error : .success)
        Task {
            try? await Task.sleep(for: .seconds(tone == .error ? 6 : 3.5))
            dismiss(toast.id)
        }
    }

    func success(_ message: String) { show(message, tone: .success) }
    func error(_ message: String) { show(message, tone: .error) }
    func error(_ error: Error) { show(errorMessage(error), tone: .error) }

    func dismiss(_ id: UUID) {
        withAnimation(Theme.med) { toasts.removeAll { $0.id == id } }
    }
}

struct ToastOverlay: View {
    @Environment(ToastCenter.self) private var center

    var body: some View {
        VStack(spacing: 8) {
            Spacer()
            ForEach(center.toasts) { t in
                HStack(spacing: 10) {
                    if t.tone == .success { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.green) }
                    if t.tone == .error { Image(systemName: "exclamationmark.circle.fill") }
                    Text(t.message).font(ClaraFont.body(15)).frame(maxWidth: .infinity, alignment: .leading)
                    if let label = t.actionLabel, let action = t.action {
                        Button(label) { action(); center.dismiss(t.id) }.font(ClaraFont.body(15, weight: .semibold)).underline()
                    }
                    Button { center.dismiss(t.id) } label: { Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)) }
                        .accessibilityLabel("Dismiss")
                }
                .foregroundStyle(t.tone == .error ? Theme.red : Theme.ink)
                .padding(.leading, 14).padding(.trailing, 12).padding(.vertical, 12)
                .background(t.tone == .error ? Theme.redSoft : Theme.surface4, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
                .transition(.move(edge: .bottom).combined(with: .opacity).combined(with: .scale(scale: 0.97)))
            }
        }
        .frame(maxWidth: 460)
        .padding(.horizontal, 16).padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

// MARK: - Dialogs (`ConfirmProvider`): confirm and prompt, awaited like the web's

@Observable
final class DialogCenter {
    struct Request: Identifiable {
        let id = UUID()
        let title: String
        var message: String?
        var label: String?
        var placeholder: String?
        var initial: String?
        var confirmLabel: String
        var danger = false
        var isPrompt: Bool
        let resume: (String?) -> Void
    }

    var current: Request?

    /// True when confirmed.
    func confirm(title: String, message: String? = nil, confirmLabel: String = "Confirm", danger: Bool = false) async -> Bool {
        await withCheckedContinuation { cont in
            present(Request(title: title, message: message, confirmLabel: confirmLabel, danger: danger, isPrompt: false) { cont.resume(returning: $0 != nil) })
        }
    }

    /// The trimmed text, or nil when cancelled or empty.
    func prompt(title: String, label: String? = nil, placeholder: String? = nil, initial: String? = nil, confirmLabel: String = "Save") async -> String? {
        await withCheckedContinuation { cont in
            present(Request(title: title, label: label, placeholder: placeholder, initial: initial, confirmLabel: confirmLabel, isPrompt: true) { value in
                let v = value?.trimmingCharacters(in: .whitespacesAndNewlines)
                cont.resume(returning: v?.isEmpty == false ? v : nil)
            })
        }
    }

    private func present(_ r: Request) {
        current?.resume(nil)
        withAnimation(Theme.spring) { current = r }
    }

    func finish(_ value: String?) {
        let r = current
        withAnimation(Theme.med) { current = nil }
        r?.resume(value)
    }
}

struct DialogOverlay: View {
    @Environment(DialogCenter.self) private var center
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            if let r = center.current {
                Theme.scrim.ignoresSafeArea()
                    .onTapGesture { center.finish(nil) }
                    .transition(.opacity)
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top) {
                        Text(r.title).font(ClaraFont.display(21, weight: .bold)).foregroundStyle(Theme.ink)
                        Spacer()
                        Button { center.finish(nil) } label: { Image(systemName: "xmark").foregroundStyle(Theme.ink2) }
                            .accessibilityLabel("Close")
                    }
                    if let m = r.message { Text(m).font(ClaraFont.body(15)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true) }
                    if r.isPrompt {
                        ClaraTextField(label: r.label, placeholder: r.placeholder ?? "", text: $text, background: Theme.surface3, onSubmit: { center.finish(text) })
                            .focused($focused)
                    }
                    HStack(spacing: 8) {
                        Spacer()
                        Button("Cancel") { center.finish(nil) }.buttonStyle(.clara(.secondary))
                        Button(r.confirmLabel) { center.finish(r.isPrompt ? text : "ok") }
                            .buttonStyle(.clara(r.danger ? .dangerSolid : .primary))
                            .disabled(r.isPrompt && text.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .padding(.top, 4)
                }
                .padding(22)
                .frame(maxWidth: 440)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rLg, style: .continuous))
                .padding(20)
                .transition(.scale(scale: 0.96).combined(with: .opacity).combined(with: .offset(y: 10)))
                .onAppear {
                    text = r.initial ?? ""
                    if r.isPrompt { focused = true }
                }
                .id(r.id)
            }
        }
        .animation(Theme.spring, value: center.current?.id)
    }
}
