import SwiftUI

struct RootView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppModel.self) private var model
    /// Signed out: nil shows the landing page, otherwise the sign-in / sign-up step.
    @State private var authStep: AuthFlow.Step?
    @State private var sitePath: [SiteRoute] = []

    var body: some View {
        ZStack {
            Theme.paper.ignoresSafeArea()
            if auth.isSignedIn && !model.showLanding {
                MainShell().transition(.opacity)
            } else if let step = authStep, !auth.isSignedIn {
                AuthFlow(step: step) { withAnimation(Theme.easeOut) { authStep = nil } }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            } else {
                NavigationStack(path: $sitePath) {
                    LandingView(signedIn: auth.isSignedIn)
                        .toolbar(.hidden, for: .navigationBar)
                        .navigationDestination(for: SiteRoute.self) { SitePage(route: $0).environment(\.isPushed, true) }
                }
                .environment(\.siteOpen, openSite)
                .transition(.opacity)
            }
            ToastOverlay()
            MenuOverlay()
            DialogOverlay()
        }
        .animation(Theme.easeOut, value: auth.isSignedIn)
        .onChange(of: auth.isSignedIn) { _, signedIn in
            if !signedIn { model.signedOut(); authStep = nil }
            sitePath = []
            if signedIn { model.showLanding = false }
        }
    }

    /// Site pages for the landing area; auth routes open the sign-in flow (or the app when signed in).
    private func openSite(_ r: SiteRoute) {
        switch r {
        case .signIn, .signUp:
            if auth.isSignedIn {
                withAnimation(Theme.easeOut) { model.showLanding = false }
            } else {
                withAnimation(Theme.easeOut) { authStep = r == .signIn ? .signIn : .signUp }
            }
        default:
            sitePath.append(r)
        }
    }
}
