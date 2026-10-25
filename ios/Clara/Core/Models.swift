import Foundation

// Mirrors the types in packages/frontend/src/lib/api.ts. Keys are mapped explicitly (no
// snake-case strategy) so free-form JSON like element geometry keeps its exact keys.

enum Role: String, Codable, CaseIterable, Comparable, Sendable {
    case viewer, editor, admin, owner
    private var rank: Int { Role.allCases.firstIndex(of: self)! }
    static func < (a: Role, b: Role) -> Bool { a.rank < b.rank }
    var title: String { rawValue.capitalized }
    var help: String {
        switch self {
        case .owner: "Everything, including deleting the workspace"
        case .admin: "Manage members, plus everything editors can do"
        case .editor: "Create, edit, delete and review AI changes"
        case .viewer: "Read, export and present"
        }
    }
}

enum ItemKind: String, Codable, Hashable, Sendable {
    case document, diagram, folder
    var symbol: String {
        switch self { case .document: "doc.text"; case .diagram: "point.3.connected.trianglepath.dotted"; case .folder: "folder" }
    }
    var plural: String { rawValue + "s" }
}

struct Workspace: Codable, Identifiable, Hashable, Sendable {
    let id: String
    var name: String
    let created_at: String?
    var role: Role?
}

struct Member: Codable, Identifiable, Hashable, Sendable {
    var id: String { user_id }
    let user_id: String
    let email: String?
    var role: Role
}

struct Folder: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let workspace_id: String
    var parent_folder_id: String?
    var name: String
}

struct DocumentSummary: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let workspace_id: String
    var folder_id: String?
    var title: String
    var tags: [String]
    var updated_at: String?
}

struct DocumentFull: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let workspace_id: String
    var folder_id: String?
    var title: String
    var tags: [String]
    var content_md: String
    var updated_at: String
    var role: Role?
}

struct DiagramSummary: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let workspace_id: String
    var folder_id: String?
    var parent_diagram_id: String?
    var name: String
    var tags: [String]
    var updated_at: String?
}

struct DiagramFull: Codable, Identifiable, Sendable {
    let id: String
    let workspace_id: String
    var folder_id: String?
    var parent_diagram_id: String?
    var name: String
    var tags: [String]
    var updated_at: String?
    var elements: [DiagramElement]
    var role: Role?
}

/// A canvas element. Decodes both the stored row shape (`z_index`, `linked_diagram_id`, …) and
/// the camelCase write shape, like `normalizeElement` in @clara/shared; always encodes camelCase.
struct DiagramElement: Codable, Identifiable, Hashable, Sendable {
    enum Kind: String, Codable, Sendable { case rect, ellipse, text, connector, group }
    var id: String
    var type: Kind
    var geometry: JSONObject
    var style: JSONObject
    var zIndex: Double
    var linkedDiagramId: String?
    var parentGroupId: String?

    init(id: String = UUID().uuidString.lowercased(), type: Kind, geometry: JSONObject, style: JSONObject = [:], zIndex: Double = 1, linkedDiagramId: String? = nil) {
        self.id = id
        self.type = type
        self.geometry = geometry
        self.style = style
        self.zIndex = zIndex
        self.linkedDiagramId = linkedDiagramId
    }

    private enum K: String, CodingKey { case id, type, geometry, style, zIndex, z_index, linkedDiagramId, linked_diagram_id, parentGroupId, parent_group_id }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString.lowercased()
        type = try c.decode(Kind.self, forKey: .type)
        geometry = (try? c.decode(JSONObject.self, forKey: .geometry)) ?? [:]
        style = (try? c.decode(JSONObject.self, forKey: .style)) ?? [:]
        zIndex = (try? c.decode(Double.self, forKey: .zIndex)) ?? (try? c.decode(Double.self, forKey: .z_index)) ?? 0
        linkedDiagramId = (try? c.decodeIfPresent(String.self, forKey: .linkedDiagramId)) ?? (try? c.decodeIfPresent(String.self, forKey: .linked_diagram_id)) ?? nil
        parentGroupId = (try? c.decodeIfPresent(String.self, forKey: .parentGroupId)) ?? (try? c.decodeIfPresent(String.self, forKey: .parent_group_id)) ?? nil
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        try c.encode(id, forKey: .id)
        try c.encode(type, forKey: .type)
        try c.encode(geometry, forKey: .geometry)
        try c.encode(style, forKey: .style)
        try c.encode(zIndex, forKey: .zIndex)
        try c.encode(linkedDiagramId, forKey: .linkedDiagramId)
        try c.encodeIfPresent(parentGroupId, forKey: .parentGroupId)
    }

    var text: String { geometry.str("text") ?? "" }
    var isShape: Bool { type == .rect || type == .ellipse }
    var baseHidden: Bool { style["baseHidden"]?.bool == true }
}

struct ElementOverride: Codable, Hashable, Sendable {
    var hidden: Bool?
    var geometry: JSONObject?
    var style: JSONObject?
    var isEmpty: Bool { hidden == nil && (geometry?.isEmpty ?? true) && (style?.isEmpty ?? true) }
}

struct DiagramState: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let diagram_id: String
    var name: String
    var order_index: Int
    var element_overrides: [String: ElementOverride]
}

struct VersionSummary: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let created_at: String
    let created_by: String?
}

struct VersionFull: Codable, Identifiable, Sendable {
    let id: String
    let created_at: String
    let snapshot: JSONObject
}

struct Grant: Codable, Identifiable, Hashable, Sendable {
    var id: String { user_id }
    let user_id: String
    let email: String?
    var role: String
    let workspace_role: Role?
}

struct PublicLink: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let token: String
    let created_at: String
}

struct SharedItem: Codable, Identifiable, Hashable, Sendable {
    let kind: ItemKind
    let id: String
    let name: String
    let tags: [String]
    let updated_at: String?
    let role: String
    let workspace_name: String
}

struct SearchResult: Codable, Identifiable, Hashable, Sendable {
    let kind: ItemKind
    let id: String
    let name: String
    let tags: [String]
    let workspace_id: String
    let workspace_name: String
    let folder_id: String?
    let updated_at: String?
}

struct Favorite: Codable, Hashable, Sendable {
    let kind: ItemKind
    let id: String
    let name: String
}

struct OnboardingResult: Codable, Sendable {
    let created: Bool
    let workspaceId: String?
    let documentId: String?
    let diagramId: String?
}

struct PersonalAccessToken: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let token_prefix: String
    let created_at: String
    let expires_at: String?
    let last_used_at: String?
    let revoked_at: String?
}

struct CreatedToken: Codable, Sendable {
    let id: String
    let name: String
    let token: String
}

struct PendingChange: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let workspace_id: String
    let resource_type: ItemKind
    let resource_id: String?
    let operation: String
    let diff_payload: JSONObject
    let status: String
    let summary: String?
    let created_at: String
    let current: JSONValue?
    let stale: Bool?
    let resource_name: String?

    var proposed: JSONObject { diff_payload["proposed"]?.object ?? [:] }
    var base: JSONObject? { diff_payload["base"]?.object }
}

/// A row in any list of documents, diagrams and folders (`ListItem` on the web).
struct ListItem: Identifiable, Hashable {
    var id: String { "\(kind.rawValue):\(itemId)" }
    let kind: ItemKind
    let itemId: String
    var name: String
    var tags: [String] = []
    var updatedAt: String?
    var context: String?
}
