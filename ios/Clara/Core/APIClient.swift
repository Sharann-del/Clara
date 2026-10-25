import Foundation

struct APIError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
    /// The deployed API doesn't have this route (it's older than the app): callers fall back.
    var isMissingRoute: Bool { status == 404 && message.hasPrefix("Route ") && message.hasSuffix(" not found") }
}

/// Toast-friendly text; network failures get a plain-language explanation (as on the web).
func errorMessage(_ error: Error) -> String {
    if let e = error as? URLError {
        return e.code == .notConnectedToInternet || e.code == .networkConnectionLost || e.code == .timedOut
            ? "Can’t reach Clara. Check your connection and try again." : e.localizedDescription
    }
    return (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
}

/// REST client for @clara/api. Every method mirrors one in packages/frontend/src/lib/api.ts.
@Observable
final class APIClient {
    let auth: AuthStore
    private let base: String

    init(auth: AuthStore, base: String = ClaraConfig.shared.apiUrl) {
        self.auth = auth
        self.base = base.hasSuffix("/") ? String(base.dropLast()) : base
    }

    private struct Empty: Decodable {}
    private struct ErrorBody: Decodable { let error: String? }

    private func send(_ path: String, method: String = "GET", body: (any Encodable)? = nil, authed: Bool = true) async throws -> Data {
        var req = URLRequest(url: URL(string: base + path)!)
        req.httpMethod = method
        req.timeoutInterval = 30
        if authed, let token = await auth.idToken() { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSON.encoder.encode(AnyEncodable(body))
        }
        let (data, res) = try await URLSession.shared.data(for: req)
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401, authed { auth.signOut() }
        guard (200..<300).contains(status) else {
            let msg = (try? JSON.decoder.decode(ErrorBody.self, from: data).error) ?? HTTPURLResponse.localizedString(forStatusCode: status)
            throw APIError(status: status, message: msg)
        }
        return data
    }

    private func get<T: Decodable>(_ path: String, authed: Bool = true) async throws -> T {
        try JSON.decoder.decode(T.self, from: await send(path, authed: authed))
    }

    private func call<T: Decodable>(_ method: String, _ path: String, _ body: (any Encodable)? = nil) async throws -> T {
        try JSON.decoder.decode(T.self, from: await send(path, method: method, body: body))
    }

    private func run(_ method: String, _ path: String, _ body: (any Encodable)? = nil) async throws {
        _ = try await send(path, method: method, body: body)
    }

    private func q(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+?"))) ?? s }

    // MARK: Account
    func onboard() async throws -> OnboardingResult { try await call("POST", "/onboarding") }
    func favorites() async throws -> [Favorite] { try await get("/favorites") }
    func addFavorite(_ kind: ItemKind, _ id: String) async throws { try await run("PUT", "/favorites/\(kind.rawValue)/\(id)") }
    func removeFavorite(_ kind: ItemKind, _ id: String) async throws { try await run("DELETE", "/favorites/\(kind.rawValue)/\(id)") }
    func search(_ term: String, limit: Int = 20) async throws -> [SearchResult] { try await get("/search?q=\(q(term))&limit=\(limit)") }
    func sharedWithMe() async throws -> [SharedItem] { try await get("/shared-with-me") }

    // MARK: Workspaces & members
    func workspaces() async throws -> [Workspace] { try await get("/workspaces") }
    func workspace(_ id: String) async throws -> Workspace { try await get("/workspaces/\(id)") }
    func createWorkspace(_ name: String) async throws -> Workspace { try await call("POST", "/workspaces", ["name": name]) }
    func renameWorkspace(_ id: String, _ name: String) async throws -> Workspace { try await call("PATCH", "/workspaces/\(id)", ["name": name]) }
    func deleteWorkspace(_ id: String) async throws { try await run("DELETE", "/workspaces/\(id)") }
    func members(_ ws: String) async throws -> [Member] { try await get("/workspaces/\(ws)/members") }
    func invite(_ ws: String, email: String, role: Role) async throws { try await run("POST", "/workspaces/\(ws)/members", ["email": email, "role": role.rawValue]) }
    func setRole(_ ws: String, user: String, role: Role) async throws { try await run("PATCH", "/workspaces/\(ws)/members/\(user)", ["role": role.rawValue]) }
    func removeMember(_ ws: String, user: String) async throws { try await run("DELETE", "/workspaces/\(ws)/members/\(user)") }

    // MARK: Folders
    func folders(_ ws: String) async throws -> [Folder] { try await get("/workspaces/\(ws)/folders") }
    func createFolder(_ ws: String, name: String, parent: String?) async throws -> Folder {
        try await call("POST", "/workspaces/\(ws)/folders", FolderBody(name: name, parentFolderId: parent))
    }
    func renameFolder(_ id: String, _ name: String) async throws { try await run("PATCH", "/folders/\(id)", ["name": name]) }
    func moveFolder(_ id: String, parent: String?) async throws { try await run("PATCH", "/folders/\(id)", NullableBody(key: "parentFolderId", value: parent)) }
    func deleteFolder(_ id: String) async throws { try await run("DELETE", "/folders/\(id)") }

    // MARK: Documents
    func documents(_ ws: String) async throws -> [DocumentSummary] { try await get("/workspaces/\(ws)/documents") }
    func createDocument(_ ws: String, title: String, folder: String?) async throws -> DocumentFull {
        try await call("POST", "/workspaces/\(ws)/documents", CreateBody(title: title, name: nil, folderId: folder, parentDiagramId: nil))
    }
    func document(_ id: String) async throws -> DocumentFull { try await get("/documents/\(id)") }
    func updateDocument(_ id: String, _ patch: DocumentPatch) async throws -> DocumentFull { try await call("PATCH", "/documents/\(id)", patch) }
    func moveDocument(_ id: String, folder: String?) async throws { try await run("PATCH", "/documents/\(id)", NullableBody(key: "folderId", value: folder)) }
    func deleteDocument(_ id: String) async throws { try await run("DELETE", "/documents/\(id)") }

    // MARK: Diagrams
    func diagrams(_ ws: String) async throws -> [DiagramSummary] { try await get("/workspaces/\(ws)/diagrams") }
    func createDiagram(_ ws: String, name: String, folder: String?, parent: String? = nil) async throws -> DiagramSummary {
        try await call("POST", "/workspaces/\(ws)/diagrams", CreateBody(title: nil, name: name, folderId: folder, parentDiagramId: parent))
    }
    func diagram(_ id: String) async throws -> DiagramFull { try await get("/diagrams/\(id)") }
    func updateDiagram(_ id: String, name: String? = nil, tags: [String]? = nil) async throws {
        try await run("PATCH", "/diagrams/\(id)", DiagramPatch(name: name, tags: tags))
    }
    func moveDiagram(_ id: String, folder: String?) async throws { try await run("PATCH", "/diagrams/\(id)", NullableBody(key: "folderId", value: folder)) }
    func deleteDiagram(_ id: String) async throws { try await run("DELETE", "/diagrams/\(id)") }
    func saveElements(_ id: String, _ elements: [DiagramElement]) async throws -> [DiagramElement] { try await call("PUT", "/diagrams/\(id)/elements", ["elements": elements]) }
    func source(_ id: String) async throws -> (text: String, format: String) {
        struct S: Decodable { let dsl_text: String?; let format: String? }
        let s: S = try await get("/diagrams/\(id)/source")
        return (s.dsl_text ?? "", s.format ?? "clara")
    }
    func setSource(_ id: String, text: String, format: String) async throws { try await run("PUT", "/diagrams/\(id)/source", ["dslText": text, "format": format]) }
    func children(_ id: String) async throws -> [IdName] { try await get("/diagrams/\(id)/children") }

    // MARK: States
    func states(_ diagram: String) async throws -> [DiagramState] { try await get("/diagrams/\(diagram)/states") }
    func createState(_ diagram: String, name: String, copyFrom: String?) async throws -> DiagramState {
        try await call("POST", "/diagrams/\(diagram)/states", StateBody(name: name, copyFromStateId: copyFrom))
    }
    func renameState(_ id: String, _ name: String) async throws { try await run("PATCH", "/diagram-states/\(id)", ["name": name]) }
    func deleteState(_ id: String) async throws { try await run("DELETE", "/diagram-states/\(id)") }
    func reorderStates(_ diagram: String, _ ids: [String]) async throws -> [DiagramState] { try await call("PUT", "/diagrams/\(diagram)/states/order", ["stateIds": ids]) }

    // MARK: Versions
    func versions(_ kind: ItemKind, _ id: String) async throws -> [VersionSummary] { try await get("/\(kind.plural)/\(id)/versions") }
    func version(_ kind: ItemKind, _ id: String, _ versionId: String) async throws -> VersionFull { try await get("/\(kind.plural)/\(id)/versions/\(versionId)") }
    func restore(_ kind: ItemKind, _ id: String, _ versionId: String) async throws { try await run("POST", "/\(kind.plural)/\(id)/versions/\(versionId)/restore") }

    // MARK: Sharing
    func grants(_ kind: ItemKind, _ id: String) async throws -> [Grant] { try await get("/\(kind.plural)/\(id)/permissions") }
    func grant(_ kind: ItemKind, _ id: String, email: String, role: String) async throws { try await run("POST", "/\(kind.plural)/\(id)/permissions", ["email": email, "role": role]) }
    func changeGrant(_ kind: ItemKind, _ id: String, user: String, role: String) async throws { try await run("PATCH", "/\(kind.plural)/\(id)/permissions/\(user)", ["role": role]) }
    func revokeGrant(_ kind: ItemKind, _ id: String, user: String) async throws { try await run("DELETE", "/\(kind.plural)/\(id)/permissions/\(user)") }
    func shareLinks(_ kind: ItemKind, _ id: String) async throws -> [PublicLink] { try await get("/\(kind.plural)/\(id)/share-links") }
    func createShareLink(_ kind: ItemKind, _ id: String) async throws -> PublicLink { try await call("POST", "/\(kind.plural)/\(id)/share-links") }
    func revokeShareLink(_ id: String) async throws { try await run("DELETE", "/share-links/\(id)") }

    // MARK: Tokens
    func tokens() async throws -> [PersonalAccessToken] { try await get("/tokens") }
    func createToken(name: String, days: Int?) async throws -> CreatedToken { try await call("POST", "/tokens", TokenBody(name: name, expiresInDays: days)) }
    func revokeToken(_ id: String) async throws { try await run("DELETE", "/tokens/\(id)") }

    // MARK: AI review
    func pendingChanges(_ ws: String) async throws -> [PendingChange] { try await get("/workspaces/\(ws)/pending-changes?status=pending") }
    func pendingCount(_ ws: String) async throws -> Int {
        struct C: Decodable { let count: Int }
        return (try await get("/workspaces/\(ws)/pending-changes/count") as C).count
    }
    func accept(_ id: String, force: Bool = false) async throws { try await run("POST", "/pending-changes/\(id)/accept", ["force": force]) }
    func reject(_ id: String) async throws { try await run("POST", "/pending-changes/\(id)/reject") }

    func exportURL(_ kind: ItemKind, _ id: String) -> URL { URL(string: "\(base)/\(kind.plural)/\(id)/export")! }
    func authorizedData(_ url: URL) async throws -> Data { try await send(String(url.absoluteString.dropFirst(base.count))) }
}

// MARK: - Request bodies

struct IdName: Codable, Hashable, Sendable { let id: String; let name: String }

struct DocumentPatch: Encodable {
    var title: String?
    var contentMd: String?
    var tags: [String]?
}

private struct DiagramPatch: Encodable { let name: String?; let tags: [String]? }
private struct FolderBody: Encodable { let name: String; let parentFolderId: String? }
private struct StateBody: Encodable { let name: String; let copyFromStateId: String? }
private struct TokenBody: Encodable {
    let name: String
    let expiresInDays: Int?
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(expiresInDays, forKey: .expiresInDays) // explicit null = never expires
    }
    enum CodingKeys: String, CodingKey { case name, expiresInDays }
}
private struct CreateBody: Encodable { let title: String?; let name: String?; let folderId: String?; let parentDiagramId: String? }

/// `{ key: value }` where a nil value is sent as JSON null (e.g. "move to top level").
private struct NullableBody: Encodable {
    let key: String
    let value: String?
    struct K: CodingKey { var stringValue: String; var intValue: Int? { nil }; init(stringValue: String) { self.stringValue = stringValue }; init?(intValue: Int) { nil } }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        try c.encode(value, forKey: K(stringValue: key))
    }
}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
