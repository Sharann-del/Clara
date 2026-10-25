import Foundation
import UIKit

/// One WebSocket per open document/diagram, matching packages/frontend/src/lib/realtimeSocket.ts:
/// presence, live typing and canvas edits. Pings inside API Gateway's 10-minute idle limit,
/// reconnects with exponential backoff (immediately when the app comes back to the foreground),
/// and fetches a fresh ID token for every attempt.
@Observable
final class RealtimeConnection {
    enum Status { case connecting, open, reconnecting, offline }

    private(set) var status: Status = .connecting
    /// Other people here right now.
    private(set) var presence: [PresenceUser] = []

    private let resourceType: String
    private let resourceId: String
    private let auth: AuthStore
    private var onMessage: ([String: Any]) -> Void = { _ in }
    /// Messages broadcast while disconnected were missed; callers refetch here.
    var onReconnect: () -> Void = {}

    private var task: URLSessionWebSocketTask?
    private var closedByCaller = false
    private var attempt = 0
    private var everOpened = false
    private var pingTimer: Timer?
    private var reconnectTask: Task<Void, Never>?
    private var foregroundObserver: NSObjectProtocol?

    init(_ resourceType: ItemKind, _ resourceId: String, auth: AuthStore) {
        self.resourceType = resourceType.rawValue
        self.resourceId = resourceId
        self.auth = auth
    }

    func start(onMessage: @escaping ([String: Any]) -> Void) {
        self.onMessage = onMessage
        foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.reconnectNow() }
        }
        Task { await open() }
    }

    func send(_ action: String, _ payload: [String: Any] = [:]) {
        guard let task, task.state == .running else { return }
        var msg = payload
        msg["action"] = action
        guard let data = try? JSONSerialization.data(withJSONObject: msg), let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    /// Encodable payload values (elements, overrides) as plain JSON objects.
    static func plain<T: Encodable>(_ value: T) -> Any {
        (try? JSONSerialization.jsonObject(with: JSON.encoder.encode(value), options: .fragmentsAllowed)) ?? NSNull()
    }

    func close() {
        closedByCaller = true
        reconnectTask?.cancel()
        pingTimer?.invalidate()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        if let o = foregroundObserver { NotificationCenter.default.removeObserver(o) }
    }

    private func open() async {
        guard !closedByCaller else { return }
        status = everOpened ? .reconnecting : .connecting
        let token = await auth.idToken() ?? ""
        guard !closedByCaller else { return }
        var comps = URLComponents(string: ClaraConfig.shared.wsUrl)!
        comps.queryItems = [
            URLQueryItem(name: "token", value: token),
            URLQueryItem(name: "resourceType", value: resourceType),
            URLQueryItem(name: "resourceId", value: resourceId),
        ]
        let t = URLSession.shared.webSocketTask(with: comps.url!)
        task = t
        t.resume()
        receive(t)
        // URLSessionWebSocketTask has no "open" event: the first successful send means we're connected.
        t.send(.string(#"{"action":"presence.sync"}"#)) { [weak self] error in
            Task { @MainActor in
                guard let self, self.task === t else { return }
                if error != nil { self.dropped(t); return }
                self.status = .open
                if self.everOpened { self.onReconnect() }
                self.everOpened = true
                self.pingTimer?.invalidate()
                self.pingTimer = Timer.scheduledTimer(withTimeInterval: 240, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated { self?.task?.send(.string(#"{"action":"ping"}"#)) { _ in } }
                }
                Task { try? await Task.sleep(for: .seconds(10)); if self.task === t { self.attempt = 0 } }
            }
        }
    }

    private func receive(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.task === t else { return }
                switch result {
                case .failure:
                    self.dropped(t)
                case .success(let message):
                    if case .string(let text) = message, let data = text.data(using: .utf8),
                       let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        self.handle(obj)
                    }
                    self.receive(t)
                }
            }
        }
    }

    private func handle(_ msg: [String: Any]) {
        let type = msg["type"] as? String
        if type == "pong" { return }
        switch type {
        case "presence.snapshot":
            presence = (msg["users"] as? [[String: Any]] ?? []).compactMap(PresenceUser.init)
        case "presence.joined":
            if let u = PresenceUser(msg) { presence = presence.filter { $0.userId != u.userId } + [u] }
        case "presence.left":
            presence.removeAll { $0.userId == msg["userId"] as? String }
        default: break
        }
        onMessage(msg)
    }

    private func dropped(_ t: URLSessionWebSocketTask) {
        guard task === t else { return }
        pingTimer?.invalidate()
        task = nil
        guard !closedByCaller, reconnectTask == nil else { return }
        status = .reconnecting
        let delay = min(30, pow(2, Double(attempt))) * Double.random(in: 0.5...1.0)
        attempt += 1
        reconnectTask = Task {
            try? await Task.sleep(for: .seconds(delay))
            reconnectTask = nil
            await open()
        }
    }

    private func reconnectNow() {
        guard !closedByCaller, task == nil else { return }
        reconnectTask?.cancel()
        reconnectTask = nil
        Task { await open() }
    }
}

struct PresenceUser: Identifiable, Hashable {
    var id: String { userId }
    let userId: String
    let email: String?

    init?(_ dict: [String: Any]) {
        guard let id = dict["userId"] as? String else { return nil }
        userId = id
        email = dict["email"] as? String
    }

    /// Stable colour per person (Presence.tsx COLORS).
    var color: UInt32 { PresenceUser.color(for: userId) }

    static func color(for userId: String) -> UInt32 {
        let colors: [UInt32] = [0xDB2777, 0x0F7A56, 0x7C3AED, 0xC2410C, 0x0E7490, 0x4D7C0F, 0xBE123C, 0x1D4ED8]
        let h = userId.unicodeScalars.reduce(UInt32(7)) { ($0 &* 31 &+ $1.value) }
        return colors[Int(h % UInt32(colors.count))]
    }
}
