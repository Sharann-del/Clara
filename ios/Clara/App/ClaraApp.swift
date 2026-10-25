import SwiftUI
import CoreText

@main
struct ClaraApp: App {
    @State private var auth: AuthStore
    @State private var model: AppModel
    @State private var toasts = ToastCenter()
    @State private var dialogs = DialogCenter()
    @State private var menus = MenuCenter()

    init() {
        Appearance.registerFonts()
        let auth = AuthStore()
        _auth = State(initialValue: auth)
        _model = State(initialValue: AppModel(api: APIClient(auth: auth)))
        Appearance.apply()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(model)
                .environment(model.api)
                .environment(toasts)
                .environment(dialogs)
                .environment(menus)
                .preferredColorScheme(.dark)
                .tint(Theme.cobalt)
        }
    }
}

/// UIKit chrome that SwiftUI doesn't reach: nav bars, lists, text views, page indicators.
enum Appearance {
    /// Bundled typefaces (ios/scripts/fetch-fonts.sh), registered before any view asks for them.
    static func registerFonts() {
        for name in ["BricolageGrotesque", "InstrumentSans", "JetBrainsMono"] {
            if let url = Bundle.main.url(forResource: name, withExtension: "ttf") {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
    }

    static func apply() {
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(Theme.paper)
        nav.shadowColor = .clear
        nav.titleTextAttributes = [.foregroundColor: UIColor(Theme.ink), .font: UIFont.systemFont(ofSize: 16, weight: .semibold)]
        nav.largeTitleTextAttributes = [.foregroundColor: UIColor(Theme.ink)]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().tintColor = UIColor(Theme.ink2)
        UITableView.appearance().backgroundColor = .clear
        // No rubber-band overscroll anywhere: content never stretches past its edges.
        UIScrollView.appearance().bounces = false
        UIScrollView.appearance().alwaysBounceVertical = false
        UIScrollView.appearance().alwaysBounceHorizontal = false
        UITextView.appearance().backgroundColor = .clear
    }
}

/// App-wide state: the signed-in user's workspaces, favourites and the current navigation.
@Observable
final class AppModel {
    let api: APIClient
    var workspaces: [Workspace]?
    var favorites: [Favorite] = []
    var pendingCounts: [String: Int] = [:]
    var foldersByWorkspace: [String: [Folder]] = [:]

    /// Sidebar selection, and the stack pushed on top of it.
    var section: AppSection? = .home
    var path: [Route] = []
    /// The slide-in sidebar on iPhone (always visible on wide screens).
    var drawerOpen = false

    func toggleDrawer() { withAnimation(Theme.spring) { drawerOpen.toggle() } }
    var searchOpen = false
    /// Signed in, but looking at the landing page (the logo goes there, as on the web).
    var showLanding = false

    init(api: APIClient) { self.api = api }

    var currentWorkspaceId: String? {
        switch section {
        case .workspace(let id, _), .pending(let id), .members(let id): return id
        default: return workspaces?.first?.id
        }
    }

    var currentWorkspace: Workspace? { workspaces?.first { $0.id == currentWorkspaceId } }

    func refreshWorkspaces() async {
        if let list = try? await api.workspaces() { workspaces = list }
    }

    func refreshFavorites() async {
        if let f = try? await api.favorites() { favorites = f }
    }

    func refreshPending(_ ws: String) async {
        if let n = try? await api.pendingCount(ws) { pendingCounts[ws] = n }
    }

    func refreshFolders(_ ws: String) async {
        if let f = try? await api.folders(ws) { foldersByWorkspace[ws] = f }
    }

    func isFavorite(_ kind: ItemKind, _ id: String) -> Bool { favorites.contains { $0.kind == kind && $0.id == id } }

    func toggleFavorite(_ kind: ItemKind, _ id: String, name: String) async throws {
        let on = isFavorite(kind, id)
        // Optimistic, rolled back on failure.
        if on { favorites.removeAll { $0.kind == kind && $0.id == id } } else { favorites.append(Favorite(kind: kind, id: id, name: name)) }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        do {
            if on { try await api.removeFavorite(kind, id) } else { try await api.addFavorite(kind, id) }
        } catch {
            await refreshFavorites()
            throw error
        }
    }

    func open(_ route: Route) {
        drawerOpen = false
        path.append(route)
    }

    func go(_ section: AppSection) {
        path = []
        self.section = section
        withAnimation(Theme.spring) { drawerOpen = false }
    }

    func signedOut() {
        workspaces = nil
        favorites = []
        pendingCounts = [:]
        foldersByWorkspace = [:]
        path = []
        section = .home
        drawerOpen = false
    }
}

enum AppSection: Hashable {
    case home
    case workspace(String, folder: String?)
    case pending(String)
    case members(String)
    case settings
    case tokens
    case shortcuts
    case site(SiteRoute)
}

enum Route: Hashable {
    case document(String)
    case diagram(String)
    case share(ItemKind, String, String)
    case history(ItemKind, String)
    case workspace(String, folder: String?)
    case members(String)
    case pending(String)
    case site(SiteRoute)
}
