import SwiftUI

/// Members of a workspace (MembersDialog.tsx, now a page): invite, change roles, remove or leave.
struct MembersView: View {
    let workspaceId: String
    @Environment(AppModel.self) private var model
    @Environment(APIClient.self) private var api
    @Environment(AuthStore.self) private var auth
    @Environment(ToastCenter.self) private var toasts
    @Environment(DialogCenter.self) private var dialogs
    @Environment(\.horizontalSizeClass) private var hSize

    @State private var members: [Member]?
    @State private var workspace: Workspace?
    @State private var email = ""
    @State private var role: Role = .editor
    @State private var busy = false
    @State private var error: String?

    private var myRole: Role { workspace?.role ?? .viewer }
    private var canManage: Bool { myRole >= .admin }

    var body: some View {
        PageScroll {
            PageHeader(title: "Members", subtitle: "People in this workspace and what they can do.").padding(.bottom, 8)
            let layout = hSize == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 20)) : AnyLayout(VStackLayout(spacing: 20))
            layout {
                VStack(spacing: 20) {
                    if canManage { inviteCard }
                    membersCard
                }
                .frame(maxWidth: .infinity)
                rolesCard.frame(maxWidth: hSize == .regular ? 300 : .infinity)
            }
        }
        .claraTopBar("Members")
        .task { await load() }
    }

    private var inviteCard: some View {
        Card {
            CardHeader(title: "Invite people", subtitle: "They need a Clara account first. They get access to everything in this workspace.")
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { emailField; rolePicker; inviteButton }
                VStack(spacing: 8) { emailField; HStack { rolePicker; Spacer(); inviteButton } }
            }
            if let error { Text(error).font(ClaraFont.body(14)).foregroundStyle(Theme.red) }
        }
    }

    private var emailField: some View {
        ClaraTextField(placeholder: "name@company.com", text: $email, keyboard: .emailAddress, contentType: .emailAddress, submitLabel: .send, onSubmit: { Task { await invite() } })
    }

    private var rolePicker: some View {
        ClaraSelect(label: "Role", selection: $role, options: [(Role.editor, "Editor"), (.viewer, "Viewer"), (.admin, "Admin")])
    }

    private var inviteButton: some View {
        Button { Task { await invite() } } label: { Text(busy ? "Inviting…" : "Invite").frame(minHeight: 44 - 8) }
            .buttonStyle(.claraPrimary)
            .disabled(busy || !email.contains("@"))
    }

    private var membersCard: some View {
        Card {
            CardHeader(title: "Members", count: members?.count)
            if let members {
                VStack(spacing: 4) {
                    ForEach(Array(members.enumerated()), id: \.element.id) { i, m in memberRow(m).fadeUp(i) }
                }
            } else {
                SkeletonRows(rows: 3, height: 60)
            }
        }
    }

    private func memberRow(_ m: Member) -> some View {
        let isMe = m.user_id == auth.sub
        let options = assignable(m)
        return HStack(spacing: 12) {
            Avatar(text: m.email ?? "?", size: 36)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(m.email ?? m.user_id).font(ClaraFont.body(15, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1).truncationMode(.middle)
                    if isMe { Text("(you)").font(ClaraFont.body(13.5)).foregroundStyle(Theme.muted) }
                }
                Text(m.role.help).font(ClaraFont.body(13)).foregroundStyle(Theme.muted).lineLimit(2)
            }
            Spacer(minLength: 8)
            if canManage && !isMe && !options.isEmpty {
                ClaraSelect(label: "Role for \(m.email ?? m.user_id)", selection: Binding(get: { m.role }, set: { (r: Role) in Task { @MainActor in await changeRole(m, r) } }),
                            options: options.map { ($0, $0.title) }, background: Theme.surface3, height: 34)
            } else {
                TagChip(text: m.role.rawValue, tone: .neutral)
            }
            if isMe || (canManage && (m.role != .owner || myRole == .owner)) {
                Button { Task { await remove(m) } } label: {
                    if isMe { Text("Leave") } else { Image(systemName: "xmark") }
                }
                .buttonStyle(.clara(.danger, small: true))
                .accessibilityLabel(isMe ? "Leave workspace" : "Remove \(m.email ?? "member")")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
    }

    private var rolesCard: some View {
        Card {
            Text("Roles").font(ClaraFont.display(18, weight: .semibold)).foregroundStyle(Theme.ink)
            ForEach([Role.owner, .admin, .editor, .viewer], id: \.self) { r in
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.title).font(ClaraFont.body(15, weight: .semibold)).foregroundStyle(Theme.ink)
                    Text(r.help).font(ClaraFont.body(14)).foregroundStyle(Theme.muted)
                }
            }
        }
    }

    /// Owners can assign any role; admins can't touch owners or create them.
    private func assignable(_ m: Member) -> [Role] {
        myRole == .owner ? [.owner, .admin, .editor, .viewer] : m.role == .owner ? [] : [.admin, .editor, .viewer]
    }

    private func load() async {
        async let w = api.workspace(workspaceId)
        async let ms = api.members(workspaceId)
        workspace = try? await w
        do { let list = try await ms; withAnimation(Theme.easeOut) { members = list } } catch { self.error = errorMessage(error) }
    }

    private func invite() async {
        let e = email.trimmingCharacters(in: .whitespaces)
        guard e.contains("@"), !busy else { return }
        busy = true
        error = nil
        do {
            try await api.invite(workspaceId, email: e, role: role)
            toasts.success("Added \(e) as \(role.rawValue)")
            email = ""
            await load()
        } catch { self.error = errorMessage(error) }
        busy = false
    }

    private func changeRole(_ m: Member, _ r: Role) async {
        do {
            try await api.setRole(workspaceId, user: m.user_id, role: r)
            toasts.success("\(m.email ?? "Member") is now \(r >= .admin ? "an" : "a") \(r.rawValue)")
        } catch { toasts.error(error) }
        await load()
    }

    private func remove(_ m: Member) async {
        let isMe = m.user_id == auth.sub
        guard await dialogs.confirm(title: isMe ? "Leave this workspace?" : "Remove \(m.email ?? "this member")?",
                                    message: isMe ? "You’ll lose access to its documents and diagrams unless someone invites you back." : "They’ll lose access to everything in this workspace except items shared with them directly.",
                                    confirmLabel: isMe ? "Leave workspace" : "Remove member", danger: true) else { return }
        do {
            try await api.removeMember(workspaceId, user: m.user_id)
            if isMe {
                await model.refreshWorkspaces()
                toasts.success("You left the workspace")
                model.go(.home)
                return
            }
            toasts.success("Removed \(m.email ?? "member")")
            await load()
        } catch { toasts.error(error) }
    }
}

/// Per-item access and the public read-only link (ShareDialog.tsx, now a page).
struct ShareView: View {
    let kind: ItemKind
    let id: String
    let name: String
    @Environment(APIClient.self) private var api
    @Environment(ToastCenter.self) private var toasts
    @Environment(DialogCenter.self) private var dialogs

    @State private var grants: [Grant]?
    @State private var links: [PublicLink] = []
    @State private var workspaceName: String?
    @State private var canManage = false
    @State private var unsupported = false
    @State private var email = ""
    @State private var role = "viewer"
    @State private var busy = false
    @State private var error: String?

    private func publicURL(_ token: String) -> String { "\(ClaraConfig.shared.siteUrl ?? "")/s/\(token)" }

    var body: some View {
        PageScroll {
            PageHeader(title: "Share “\(name)”", subtitle: "Who can open it, and whether there’s a public read-only link.").padding(.bottom, 8)
            if unsupported {
                Text("Sharing single items needs a newer Clara API than this one. Until it’s deployed, invite people to the workspace from Members.").font(ClaraFont.body(15)).foregroundStyle(Theme.muted)
            } else if let grants {
                peopleCard(grants)
                linkCard
            } else {
                SkeletonRows(rows: 2, height: 80)
            }
            if let error { Text(error).font(ClaraFont.body(14)).foregroundStyle(Theme.red) }
        }
        .claraTopBar("Share")
        .task { await load() }
    }

    private func peopleCard(_ grants: [Grant]) -> some View {
        Card {
            CardHeader(title: "People with access")
            VStack(spacing: 4) {
                row(avatar: AnyView(Image(systemName: "person.2.fill").font(.system(size: 12)).foregroundStyle(Theme.paper).frame(width: 30, height: 30).background(Theme.ink, in: RoundedRectangle(cornerRadius: 8))),
                    title: "Members of \(workspaceName ?? "the workspace")") { TagChip(text: "their workspace role", tone: .neutral) }
                ForEach(grants) { g in
                    row(avatar: AnyView(Avatar(text: g.email ?? "?", size: 30)), title: g.email ?? g.user_id, subtitle: g.workspace_role.map { "also \($0.rawValue) of the workspace" }) {
                        if canManage {
                            ClaraSelect(label: "Access for \(g.email ?? g.user_id)", selection: Binding(get: { g.role }, set: { (r: String) in Task { @MainActor in await change(g, r) } }),
                                        options: [("viewer", "Can view"), ("editor", "Can edit")], background: Theme.surface3, height: 34)
                            Button { Task { await revoke(g) } } label: { Image(systemName: "xmark") }.buttonStyle(.clara(.danger, small: true)).accessibilityLabel("Remove access for \(g.email ?? "this person")")
                        } else {
                            TagChip(text: g.role == "editor" ? "can edit" : "can view", tone: .neutral)
                        }
                    }
                }
            }
            if canManage {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { addField; accessPicker; addButton }
                    VStack(spacing: 8) { addField; HStack { accessPicker; Spacer(); addButton } }
                }
            }
            Text("People you add see only this \(kind.rawValue), not the rest of the workspace. They need a Clara account.").font(ClaraFont.body(13)).foregroundStyle(Theme.muted)
        }
    }

    private var addField: some View { ClaraTextField(placeholder: "name@company.com", text: $email, keyboard: .emailAddress, contentType: .emailAddress, onSubmit: { Task { await add() } }) }
    private var accessPicker: some View {
        ClaraSelect(label: "Access", selection: $role, options: [("viewer", "Can view"), ("editor", "Can edit")])
    }
    private var addButton: some View {
        Button(busy ? "Sharing…" : "Share") { Task { await add() } }.buttonStyle(.claraPrimary).disabled(busy || !email.contains("@"))
    }

    private var linkCard: some View {
        Card {
            CardHeader(title: "Public link")
            if links.isEmpty {
                HStack {
                    Text("Off. Anyone with a link could view this \(kind.rawValue) without signing in.").font(ClaraFont.body(14.5)).foregroundStyle(Theme.muted)
                    Spacer()
                    if canManage { Button { Task { await createLink() } } label: { Label("Create public link", systemImage: "globe") }.buttonStyle(.claraSecondary) }
                }
            } else {
                ForEach(links) { l in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(publicURL(l.token)).font(ClaraFont.mono(12.5)).foregroundStyle(Theme.ink).lineLimit(1).truncationMode(.middle)
                            .padding(.horizontal, 12).frame(height: 40).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rSm + 1)).textSelection(.enabled)
                        HStack {
                            Button { UIPasteboard.general.string = publicURL(l.token); toasts.success("Link copied") } label: { Label("Copy", systemImage: "doc.on.doc") }.buttonStyle(.claraSecondary)
                            Button { SystemShare.present([URL(string: publicURL(l.token))!]) } label: { Label("Share", systemImage: "square.and.arrow.up") }.buttonStyle(.claraSecondary)
                            Spacer()
                            if canManage { Button("Turn off") { Task { await revokeLink(l) } }.buttonStyle(.claraDanger) }
                        }
                    }
                }
                Text("Read-only. \(kind == .document ? "Diagrams embedded in the document are visible through the link too." : "Linked child diagrams need their own links.")").font(ClaraFont.body(13)).foregroundStyle(Theme.muted)
            }
        }
    }

    private func row<Trailing: View>(avatar: AnyView, title: String, subtitle: String? = nil, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 12) {
            avatar
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(ClaraFont.body(15)).foregroundStyle(Theme.ink).lineLimit(1).truncationMode(.middle)
                if let subtitle { Text(subtitle).font(ClaraFont.body(13)).foregroundStyle(Theme.muted) }
            }
            Spacer()
            trailing()
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.rMd, style: .continuous))
    }

    private func load() async {
        // Editors can manage sharing; the item's effective role decides.
        if kind == .document, let d = try? await api.document(id) {
            canManage = (d.role ?? .viewer) >= .editor
            workspaceName = (try? await api.workspace(d.workspace_id))?.name
        } else if kind == .diagram, let d = try? await api.diagram(id) {
            canManage = (d.role ?? .viewer) >= .editor
            workspaceName = (try? await api.workspace(d.workspace_id))?.name
        }
        do {
            async let g = api.grants(kind, id)
            async let l = api.shareLinks(kind, id)
            let (gs, ls) = try await (g, l)
            withAnimation(Theme.easeOut) { grants = gs; links = ls }
        } catch let e as APIError where e.isMissingRoute {
            unsupported = true
        } catch {
            self.error = errorMessage(error)
            grants = []
        }
    }

    private func add() async {
        let e = email.trimmingCharacters(in: .whitespaces)
        guard e.contains("@"), !busy else { return }
        busy = true
        error = nil
        do { try await api.grant(kind, id, email: e, role: role); toasts.success("Shared with \(e) as \(role)"); email = ""; await load() }
        catch { self.error = errorMessage(error) }
        busy = false
    }

    private func change(_ g: Grant, _ r: String) async {
        do { try await api.changeGrant(kind, id, user: g.user_id, role: r); await load() } catch { toasts.error(error) }
    }

    private func revoke(_ g: Grant) async {
        do { try await api.revokeGrant(kind, id, user: g.user_id); toasts.success("Removed access for \(g.email ?? "that person")"); await load() } catch { toasts.error(error) }
    }

    private func createLink() async {
        do {
            let link = try await api.createShareLink(kind, id)
            UIPasteboard.general.string = publicURL(link.token)
            toasts.success("Public link created and copied")
            await load()
        } catch { toasts.error(error) }
    }

    private func revokeLink(_ l: PublicLink) async {
        guard await dialogs.confirm(title: "Turn off this public link?", message: "Anyone who has it will see “link no longer works”. You can create a new link later.", confirmLabel: "Turn off link", danger: true) else { return }
        do { try await api.revokeShareLink(l.id); toasts.success("Public link turned off"); await load() } catch { toasts.error(error) }
    }
}
