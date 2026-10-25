import SwiftUI

/// Signed-out area: sign in, create an account, confirm the emailed code (SignInPage / SignUpPage).
struct AuthFlow: View {
    enum Step: Equatable { case signIn, signUp, confirm(String) }
    @State var step: Step
    var onBack: () -> Void

    var body: some View {
        ZStack {
            DotGrid().ignoresSafeArea()
            ScrollView {
                VStack(spacing: 28) {
                    HStack {
                        Button(action: onBack) { Label("Back", systemImage: "arrow.left") }.buttonStyle(.clara(.ghost, small: true))
                        Spacer()
                    }
                    ClaraLogo(size: 30).padding(.top, 12)
                    Group {
                        switch step {
                        case .signIn: SignInCard(step: $step)
                        case .signUp: SignUpCard(step: $step)
                        case .confirm(let email): ConfirmCard(email: email, step: $step)
                        }
                    }
                    .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 10)), removal: .opacity))
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
        .animation(Theme.easeOut, value: step)
    }
}

/// Paper with a faint dot grid (`.auth-shell`).
struct DotGrid: View {
    var body: some View {
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Theme.paper))
            var dots = Path()
            for x in stride(from: CGFloat(11), to: size.width, by: 22) {
                for y in stride(from: CGFloat(11), to: size.height, by: 22) { dots.addEllipse(in: CGRect(x: x - 1, y: y - 1, width: 2, height: 2)) }
            }
            ctx.fill(dots, with: .color(Theme.surface2))
        }
    }
}

private struct AuthCard<Content: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(ClaraFont.display(26, weight: .bold)).tracking(-0.6).foregroundStyle(Theme.ink)
                if let subtitle { Text(subtitle).font(ClaraFont.body(15)).foregroundStyle(Theme.muted) }
            }
            .padding(.bottom, 4)
            content
        }
        .padding(28)
        .frame(maxWidth: 420)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.rLg, style: .continuous))
    }
}

private struct ErrorText: View {
    let text: String?
    var body: some View {
        if let text {
            Text(text).font(ClaraFont.body(14)).foregroundStyle(Theme.red).transition(.opacity.combined(with: .offset(y: -4)))
        }
    }
}

private struct SignInCard: View {
    @Binding var step: AuthFlow.Step
    @Environment(AuthStore.self) private var auth
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        AuthCard(title: "Sign in", subtitle: "Welcome back to Clara.") {
            ClaraTextField(label: "Email", placeholder: "you@company.com", text: $email, keyboard: .emailAddress, contentType: .username, submitLabel: .next)
            ClaraTextField(label: "Password", placeholder: "Your password", text: $password, secure: true, contentType: .password, submitLabel: .go, onSubmit: submit)
            ErrorText(text: error)
            Button(action: submit) {
                HStack { if busy { Spinner(size: 16) }; Text(busy ? "Signing in…" : "Sign in") }.frame(maxWidth: .infinity)
            }
            .buttonStyle(.claraPrimary)
            .disabled(busy || email.isEmpty || password.isEmpty)
            HStack(spacing: 4) {
                Text("New to Clara?").foregroundStyle(Theme.muted)
                Button("Create an account") { step = .signUp }.foregroundStyle(Theme.cobalt)
            }
            .font(ClaraFont.body(14.5))
            .frame(maxWidth: .infinity)
        }
        .animation(Theme.med, value: error)
    }

    private func submit() {
        guard !email.isEmpty, !password.isEmpty, !busy else { return }
        busy = true
        error = nil
        Task {
            do { try await auth.signIn(email: email, password: password) }
            catch let e as CognitoError where e.code == "UserNotConfirmedException" {
                try? await Cognito.resendCode(email: email)
                step = .confirm(email)
            } catch { self.error = errorMessage(error) }
            busy = false
        }
    }
}

private struct SignUpCard: View {
    @Binding var step: AuthFlow.Step
    @State private var email = ""
    @State private var password = ""
    @State private var inviteCode = ""
    @State private var busy = false
    @State private var error: String?
    private let inviteRequired = ClaraConfig.shared.signupInviteRequired == true

    var body: some View {
        AuthCard(title: "Create your account", subtitle: "Docs and diagrams as code, with AI edits you approve.") {
            ClaraTextField(label: "Email", placeholder: "you@company.com", text: $email, keyboard: .emailAddress, contentType: .username, submitLabel: .next)
            ClaraTextField(label: "Password", placeholder: "At least 10 characters", text: $password, secure: true, contentType: .newPassword, submitLabel: .go, onSubmit: submit)
            Text("Use upper and lower case letters and a number.").font(ClaraFont.body(13)).foregroundStyle(Theme.muted)
            if inviteRequired {
                ClaraTextField(label: "Invite code", placeholder: "From whoever runs this Clara", text: $inviteCode, submitLabel: .go, onSubmit: submit)
            }
            ErrorText(text: error)
            Button(action: submit) {
                HStack { if busy { Spinner(size: 16) }; Text(busy ? "Creating…" : "Create account") }.frame(maxWidth: .infinity)
            }
            .buttonStyle(.claraPrimary)
            .disabled(busy || email.isEmpty || password.count < 10 || (inviteRequired && inviteCode.isEmpty))
            HStack(spacing: 4) {
                Text("Have an account?").foregroundStyle(Theme.muted)
                Button("Sign in") { step = .signIn }.foregroundStyle(Theme.cobalt)
            }
            .font(ClaraFont.body(14.5))
            .frame(maxWidth: .infinity)
        }
        .animation(Theme.med, value: error)
    }

    private func submit() {
        guard !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                try await Cognito.signUp(
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password,
                    inviteCode: inviteRequired ? inviteCode.trimmingCharacters(in: .whitespaces) : nil
                )
                PendingSignUp.password = password
                step = .confirm(email.trimmingCharacters(in: .whitespaces))
            } catch { self.error = errorMessage(error) }
            busy = false
        }
    }
}

/// The password from sign-up, kept in memory only, so confirming the code signs straight in.
private enum PendingSignUp { @MainActor static var password: String? }

private struct ConfirmCard: View {
    let email: String
    @Binding var step: AuthFlow.Step
    @Environment(AuthStore.self) private var auth
    @Environment(ToastCenter.self) private var toasts
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        AuthCard(title: "Check your email", subtitle: "We sent a 6-digit code to \(email).") {
            ClaraTextField(label: "Code", placeholder: "123456", text: $code, keyboard: .numberPad, contentType: .oneTimeCode, onSubmit: submit)
            ErrorText(text: error)
            Button(action: submit) {
                HStack { if busy { Spinner(size: 16) }; Text(busy ? "Confirming…" : "Confirm and continue") }.frame(maxWidth: .infinity)
            }
            .buttonStyle(.claraPrimary)
            .disabled(busy || code.count < 6)
            HStack {
                Button("Send a new code") {
                    Task {
                        do { try await Cognito.resendCode(email: email); toasts.success("New code sent") } catch { self.error = errorMessage(error) }
                    }
                }
                Spacer()
                Button("Back to sign in") { step = .signIn }
            }
            .font(ClaraFont.body(14.5))
            .foregroundStyle(Theme.cobalt)
        }
        .animation(Theme.med, value: error)
    }

    private func submit() {
        guard code.count >= 6, !busy else { return }
        busy = true
        error = nil
        Task {
            do {
                try await Cognito.confirm(email: email, code: code.trimmingCharacters(in: .whitespaces))
                if let pw = PendingSignUp.password {
                    PendingSignUp.password = nil
                    try await auth.signIn(email: email, password: pw)
                } else {
                    toasts.success("Email confirmed. Sign in to continue.")
                    step = .signIn
                }
            } catch { self.error = errorMessage(error) }
            busy = false
        }
    }
}

/// The Clara wordmark with its C4 drill-down glyph (Logo.tsx).
struct ClaraLogo: View {
    var size: CGFloat = 24
    var body: some View {
        HStack(spacing: size * 0.35) {
            LogoGlyph(size: size)
            Text("Clara").font(ClaraFont.display(size * 0.8, weight: .heavy)).tracking(-size * 0.03).foregroundStyle(Theme.ink)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Clara")
    }
}

struct LogoGlyph: View {
    var size: CGFloat = 26
    var body: some View {
        Canvas { ctx, s in
            let k = s.width / 32
            ctx.scaleBy(x: k, y: k)
            ctx.fill(Path(roundedRect: CGRect(x: 0, y: 0, width: 32, height: 32), cornerRadius: 8), with: .color(Theme.ink))
            ctx.stroke(Path(roundedRect: CGRect(x: 6.5, y: 6.5, width: 10, height: 8), cornerRadius: 2), with: .color(Theme.paper), lineWidth: 2)
            var p = Path()
            p.move(to: CGPoint(x: 11.5, y: 14.5)); p.addLine(to: CGPoint(x: 11.5, y: 19)); p.addQuadCurve(to: CGPoint(x: 13.5, y: 21), control: CGPoint(x: 11.5, y: 21)); p.addLine(to: CGPoint(x: 16.5, y: 21))
            ctx.stroke(p, with: .color(Theme.paper), style: StrokeStyle(lineWidth: 2, lineCap: .round))
            ctx.fill(Path(roundedRect: CGRect(x: 16.5, y: 17, width: 9, height: 8), cornerRadius: 2), with: .color(Theme.cobalt))
        }
        .frame(width: size, height: size)
    }
}
