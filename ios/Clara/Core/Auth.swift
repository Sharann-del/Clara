import Foundation
import Security

/// Endpoints from Resources/ClaraConfig.json (written by ios/scripts/configure.sh from the web
/// app's .env, so both clients always talk to the same stack).
struct ClaraConfig: Decodable, Sendable {
    let apiUrl: String
    let wsUrl: String
    let userPoolId: String
    let userPoolClientId: String
    let region: String
    let siteUrl: String?
    /// True when the stack only accepts sign-ups with an invite code (CDK `signupMode=invite`).
    let signupInviteRequired: Bool?

    static let shared: ClaraConfig = {
        guard let url = Bundle.main.url(forResource: "ClaraConfig", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let cfg = try? JSONDecoder().decode(ClaraConfig.self, from: data)
        else { fatalError("Missing Resources/ClaraConfig.json — run ios/scripts/configure.sh") }
        return cfg
    }()

    var mcpUrl: String { apiUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/mcp" }
}

// MARK: - Cognito (public JSON API; the pool allows USER_PASSWORD_AUTH)

struct CognitoError: LocalizedError {
    let code: String
    let message: String
    var errorDescription: String? { message }
}

struct Tokens: Codable, Sendable {
    var idToken: String
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date

    var claims: [String: Any] {
        let parts = idToken.split(separator: ".")
        guard parts.count > 1 else { return [:] }
        var b64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }
}

enum Cognito {
    private static func call(_ target: String, _ body: [String: Any]) async throws -> [String: Any] {
        let cfg = ClaraConfig.shared
        var req = URLRequest(url: URL(string: "https://cognito-idp.\(cfg.region).amazonaws.com/")!)
        req.httpMethod = "POST"
        req.setValue("application/x-amz-json-1.1", forHTTPHeaderField: "Content-Type")
        req.setValue("AWSCognitoIdentityProviderService.\(target)", forHTTPHeaderField: "X-Amz-Target")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, res) = try await URLSession.shared.data(for: req)
        let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        if let http = res as? HTTPURLResponse, http.statusCode >= 400 {
            let type = (json["__type"] as? String ?? "Error").components(separatedBy: "#").last ?? "Error"
            throw CognitoError(code: type, message: friendly(type, json["message"] as? String))
        }
        return json
    }

    /// Plain-language versions of Cognito's errors (matches `friendlyAuthError` on the web).
    private static func friendly(_ code: String, _ message: String?) -> String {
        switch code {
        case "NotAuthorizedException": return message?.contains("Incorrect") == true ? "Wrong email or password." : (message ?? "Not allowed.")
        case "UserNotFoundException": return "Wrong email or password."
        case "UserNotConfirmedException": return "Confirm your email first. We sent you a code."
        case "UsernameExistsException": return "There’s already an account with that email. Sign in instead."
        case "InvalidPasswordException": return "Use at least 10 characters with upper and lower case letters and a number."
        case "UserLambdaValidationException":
            // The pre-sign-up trigger's own message, e.g. "That invite code isn’t valid."
            let reason = (message ?? "").replacingOccurrences(of: "PreSignUp failed with error", with: "").trimmingCharacters(in: .whitespaces)
            return reason.isEmpty ? "Sign-ups are restricted on this deployment." : reason
        case "CodeMismatchException": return "That code isn’t right. Check the email and try again."
        case "ExpiredCodeException": return "That code expired. Send a new one."
        case "LimitExceededException", "TooManyRequestsException": return "Too many attempts. Wait a minute and try again."
        default: return message ?? "Something went wrong"
        }
    }

    private static func tokens(_ json: [String: Any], keepRefresh: String? = nil) throws -> Tokens {
        guard let r = json["AuthenticationResult"] as? [String: Any], let id = r["IdToken"] as? String, let access = r["AccessToken"] as? String else {
            throw CognitoError(code: "Unsupported", message: "This account needs a sign-in step the app doesn’t support yet. Use the web app.")
        }
        let refresh = (r["RefreshToken"] as? String) ?? keepRefresh ?? ""
        let expires = (r["ExpiresIn"] as? Double) ?? 3600
        return Tokens(idToken: id, accessToken: access, refreshToken: refresh, expiresAt: Date().addingTimeInterval(expires - 60))
    }

    static func signIn(email: String, password: String) async throws -> Tokens {
        try tokens(await call("InitiateAuth", [
            "AuthFlow": "USER_PASSWORD_AUTH",
            "ClientId": ClaraConfig.shared.userPoolClientId,
            "AuthParameters": ["USERNAME": email, "PASSWORD": password],
        ]))
    }

    static func refresh(_ refreshToken: String) async throws -> Tokens {
        try tokens(await call("InitiateAuth", [
            "AuthFlow": "REFRESH_TOKEN_AUTH",
            "ClientId": ClaraConfig.shared.userPoolClientId,
            "AuthParameters": ["REFRESH_TOKEN": refreshToken],
        ]), keepRefresh: refreshToken)
    }

    static func signUp(email: String, password: String, inviteCode: String? = nil) async throws {
        var body: [String: Any] = ["ClientId": ClaraConfig.shared.userPoolClientId, "Username": email, "Password": password]
        // Validation data reaches the pre-sign-up trigger only; Cognito doesn't store it.
        if let inviteCode, !inviteCode.isEmpty { body["ValidationData"] = [["Name": "inviteCode", "Value": inviteCode]] }
        _ = try await call("SignUp", body)
    }

    static func confirm(email: String, code: String) async throws {
        _ = try await call("ConfirmSignUp", ["ClientId": ClaraConfig.shared.userPoolClientId, "Username": email, "ConfirmationCode": code])
    }

    static func resendCode(email: String) async throws {
        _ = try await call("ResendConfirmationCode", ["ClientId": ClaraConfig.shared.userPoolClientId, "Username": email])
    }

    static func changePassword(accessToken: String, old: String, new: String) async throws {
        _ = try await call("ChangePassword", ["AccessToken": accessToken, "PreviousPassword": old, "ProposedPassword": new])
    }
}

// MARK: - Keychain

enum Keychain {
    private static let service = (Bundle.main.bundleIdentifier ?? "clara") + ".session"

    static func save(_ tokens: Tokens) {
        guard let data = try? JSONEncoder().encode(tokens) else { return }
        clear()
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func load() -> Tokens? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecReturnData as String: true]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Tokens.self, from: data)
    }

    static func clear() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary)
    }
}

// MARK: - Session

@Observable
final class AuthStore {
    private(set) var tokens: Tokens?
    private(set) var loading = true
    private var refreshing: Task<Tokens?, Never>?

    var isSignedIn: Bool { tokens != nil }
    var email: String? { tokens?.claims["email"] as? String }
    var sub: String? { tokens?.claims["sub"] as? String }

    init() {
        tokens = Keychain.load()
        loading = false
    }

    func signIn(email: String, password: String) async throws {
        let t = try await Cognito.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
        Keychain.save(t)
        tokens = t
    }

    func signOut() {
        Keychain.clear()
        tokens = nil
    }

    /// A valid ID token, refreshing it first when it's about to expire. Concurrent callers share one refresh.
    func idToken() async -> String? {
        guard let t = tokens else { return nil }
        if t.expiresAt > Date() { return t.idToken }
        if refreshing == nil {
            refreshing = Task {
                do {
                    let fresh = try await Cognito.refresh(t.refreshToken)
                    Keychain.save(fresh)
                    tokens = fresh
                    return fresh
                } catch {
                    // A revoked or expired refresh token means signing in again.
                    if error is CognitoError { signOut() }
                    return nil
                }
            }
        }
        let fresh = await refreshing?.value
        refreshing = nil
        return fresh?.idToken
    }

    func accessToken() async -> String? {
        _ = await idToken()
        return tokens?.accessToken
    }
}
