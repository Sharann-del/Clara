import SwiftUI

/// Profile and password (SettingsPage.tsx).
struct SettingsView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var model
    @Environment(ToastCenter.self) private var toasts
    @State private var current = ""
    @State private var next = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        PageScroll {
            PageHeader(title: "Settings").padding(.bottom, 8)
            Card {
                CardHeader(title: "Profile")
                HStack(spacing: 14) {
                    Avatar(text: auth.email ?? "?", size: 44)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(auth.email ?? "").font(ClaraFont.body(16, weight: .semibold)).foregroundStyle(Theme.ink)
                        Text("This is how teammates see you and find you when they share.").font(ClaraFont.body(14)).foregroundStyle(Theme.muted)
                    }
                }
            }
            Card {
                CardHeader(title: "Password")
                ClaraTextField(label: "Current password", placeholder: "", text: $current, secure: true, contentType: .password)
                ClaraTextField(label: "New password", placeholder: "At least 8 characters", text: $next, secure: true, contentType: .newPassword)
                if let error { Text(error).font(ClaraFont.body(14)).foregroundStyle(Theme.red) }
                Button(busy ? "Changing…" : "Change password") { Task { await change() } }.buttonStyle(.claraPrimary).disabled(busy || current.isEmpty || next.count < 8)
            }
            Card {
                CardHeader(title: "AI assistants", subtitle: "Connect Claude over MCP with a personal access token. Its edits arrive as pending changes you review.")
                Button { model.go(.tokens) } label: { Label("Access tokens", systemImage: "key") }.buttonStyle(.claraSecondary)
            }
            Card {
                CardHeader(title: "Session")
                Button(role: .destructive) { auth.signOut() } label: { Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right") }.buttonStyle(.claraDanger)
            }
            Text("Clara for iOS \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")").font(ClaraFont.body(13)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity)
        }
        .claraTopBar("Settings")
    }

    private func change() async {
        busy = true
        error = nil
        do {
            guard let token = await auth.accessToken() else { throw CognitoError(code: "NotAuthorized", message: "You’re signed out. Sign in again first.") }
            try await Cognito.changePassword(accessToken: token, old: current, new: next)
            current = ""
            next = ""
            toasts.success("Password changed")
        } catch { self.error = errorMessage(error) }
        busy = false
    }
}

/// Personal access tokens for MCP clients (TokensPage.tsx).
struct TokensView: View {
    @Environment(APIClient.self) private var api
    @Environment(ToastCenter.self) private var toasts
    @Environment(DialogCenter.self) private var dialogs
    @State private var tokens: [PersonalAccessToken]?
    @State private var name = ""
    @State private var days: Int? = 90
    @State private var created: CreatedToken?
    @State private var busy = false

    private var command: String {
        "claude mcp add --transport http clara \(ClaraConfig.shared.mcpUrl) \\\n  --header \"Authorization: Bearer \(created?.token ?? "clara_pat_YOUR_TOKEN")\""
    }

    var body: some View {
        PageScroll {
            PageHeader(title: "Access tokens", subtitle: "Let AI assistants like Claude read your workspaces and propose changes over MCP. Proposals wait for your review.").padding(.bottom, 8)

            if let created {
                Card(background: Theme.cobaltSoft) {
                    CardHeader(title: "Copy your token now", subtitle: "It won’t be shown again. Treat it like a password.")
                    Text(created.token).font(ClaraFont.mono(13)).foregroundStyle(Theme.ink).textSelection(.enabled)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Theme.paper, in: RoundedRectangle(cornerRadius: Theme.rSm + 1))
                    HStack {
                        Button { UIPasteboard.general.string = created.token; toasts.success("Token copied") } label: { Label("Copy token", systemImage: "doc.on.doc") }.buttonStyle(.claraPrimary)
                        Button("Done") { withAnimation(Theme.med) { self.created = nil } }.buttonStyle(.claraSecondary)
                    }
                }
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }

            Card {
                CardHeader(title: "Create a token")
                ClaraTextField(label: "Name", placeholder: "e.g. Claude Code on my laptop", text: $name)
                HStack {
                    Text("Expires").font(ClaraFont.body(14, weight: .medium)).foregroundStyle(Theme.ink2)
                    ClaraSelect(label: "Expires", selection: $days, options: [(Int?.some(30), "In 30 days"), (Int?.some(90), "In 90 days"), (Int?.some(365), "In a year"), (Int?.none, "Never")])
                    Spacer()
                    Button(busy ? "Creating…" : "Create token") { Task { await create() } }.buttonStyle(.claraPrimary).disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }

            Card {
                CardHeader(title: "Connect Claude Code", subtitle: "Run this in a terminal, with your token in place of the placeholder.")
                Text(command).font(ClaraFont.mono(12.5)).foregroundStyle(Color(hex: 0xD6D6DC)).textSelection(.enabled)
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Color(hex: 0x070708), in: RoundedRectangle(cornerRadius: Theme.rSm + 1))
                Button { UIPasteboard.general.string = command; toasts.success("Command copied") } label: { Label("Copy command", systemImage: "doc.on.doc") }.buttonStyle(.claraSecondary)
            }

            SectionHeader(title: "Your tokens")
            if let tokens {
                if tokens.isEmpty {
                    EmptyStateView(symbol: "key", title: "No tokens yet", message: "Create one above to connect an assistant.", compact: true)
                } else {
                    VStack(spacing: 2) {
                        ForEach(Array(tokens.enumerated()), id: \.element.id) { i, t in tokenRow(t).fadeUp(i) }
                    }
                    .padding(6)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.rLg, style: .continuous))
                }
            } else {
                SkeletonRows(rows: 2)
            }
        }
        .claraTopBar("Access tokens")
        .animation(Theme.easeOut, value: created?.id)
        .task { await load() }
    }

    private func tokenRow(_ t: PersonalAccessToken) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "key").foregroundStyle(Theme.ink2).frame(width: 32, height: 32).background(Theme.surface3, in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(t.name).font(ClaraFont.body(15, weight: .medium)).foregroundStyle(Theme.ink)
                    if t.revoked_at != nil { TagChip(text: "revoked", tone: .neutral) }
                }
                Text([ "\(t.token_prefix)…", "created \(timeAgo(t.created_at))", t.last_used_at.map { "used \(timeAgo($0))" } ?? "never used", t.expires_at.map { "expires \(timeAgo($0))" } ?? "never expires" ].joined(separator: " · "))
                    .font(ClaraFont.body(13)).foregroundStyle(Theme.muted)
            }
            Spacer()
            if t.revoked_at == nil {
                Button("Revoke") { Task { await revoke(t) } }.buttonStyle(.clara(.danger, small: true))
            }
        }
        .padding(10)
    }

    private func load() async {
        if let list = try? await api.tokens() { withAnimation(Theme.easeOut) { tokens = list } } else { tokens = tokens ?? [] }
    }

    private func create() async {
        busy = true
        do {
            created = try await api.createToken(name: name.trimmingCharacters(in: .whitespaces), days: days)
            name = ""
            await load()
        } catch { toasts.error(error) }
        busy = false
    }

    private func revoke(_ t: PersonalAccessToken) async {
        guard await dialogs.confirm(title: "Revoke “\(t.name)”?", message: "Assistants using it lose access immediately. Pending proposals they made stay in the review queue.", confirmLabel: "Revoke token", danger: true) else { return }
        do { try await api.revokeToken(t.id); toasts.success("Token revoked"); await load() } catch { toasts.error(error) }
    }
}

/// Keyboard shortcuts with a hardware keyboard (lib/shortcuts.ts), plus the touch equivalents.
struct ShortcutsView: View {
    private let groups: [(String, [([String], String)])] = [
        ("Anywhere in the app", [(["⌘", "K"], "Search documents and diagrams, run commands"), (["?"], "Show keyboard shortcuts")]),
        ("Diagram canvas", [
            (["V"], "Select tool"), (["R"], "Rectangle tool"), (["O"], "Ellipse tool"), (["T"], "Text tool"), (["C"], "Connector tool (tap two shapes)"),
            (["Return"], "Edit the selected shape’s text"), (["Delete"], "Delete the selection (in a state: hide it there)"), (["Esc"], "Clear selection / cancel the current tool"),
            (["←", "↑", "→", "↓"], "Nudge the selection 1pt (hold Shift for 10pt)"), (["⌘", "A"], "Select all"), (["⌘", "D"], "Duplicate the selection"),
            (["+", "−"], "Zoom in / out"), (["0"], "Zoom to fit"),
        ]),
        ("Markdown editor", [(["⌘", "B"], "Bold"), (["⌘", "I"], "Italic"), (["⌘", "E"], "Inline code")]),
        ("Present mode", [(["←", "→"], "Previous / next state"), (["Space"], "Play or pause auto-advance"), (["Esc"], "Exit")]),
        ("Touch", [
            (["Drag"], "Move a shape, or pan empty canvas"), (["Pinch"], "Zoom around your fingers"), (["Double-tap"], "Edit a label, or open a linked diagram"),
            (["Corner handle"], "Resize the selected shape"), (["Swipe"], "Next / previous state in present mode"),
        ]),
    ]

    var body: some View {
        PageScroll {
            PageHeader(title: "Keyboard shortcuts", subtitle: "With a hardware keyboard on iPad. Press ? anywhere to come back here.").padding(.bottom, 8)
            ForEach(groups, id: \.0) { title, items in
                SectionHeader(title: title)
                VStack(spacing: 2) {
                    ForEach(items, id: \.1) { keys, action in
                        HStack(alignment: .firstTextBaseline, spacing: 16) {
                            HStack(spacing: 4) {
                                ForEach(keys, id: \.self) { k in
                                    Text(k).font(ClaraFont.mono(12.5)).foregroundStyle(Theme.ink2).padding(.horizontal, 7).padding(.vertical, 2).background(Theme.surface3, in: RoundedRectangle(cornerRadius: 5))
                                }
                            }
                            .frame(minWidth: 130, alignment: .leading)
                            Text(action).font(ClaraFont.body(15)).foregroundStyle(Theme.ink)
                            Spacer()
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rSm, style: .continuous))
                    }
                }
            }
        }
        .claraTopBar("Shortcuts")
    }
}
