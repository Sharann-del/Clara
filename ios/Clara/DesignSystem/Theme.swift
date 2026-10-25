import SwiftUI
import UIKit

/// Clara's design tokens, mirrored from `packages/frontend/src/styles.css`.
/// Dark only. Flat, solid surfaces with no borders: layers are told apart by tone alone
/// (paper < surface < surface2 < surface3 < surface4). One accent (cobalt) for focus, links,
/// selection and live state; primary actions are solid white. Amber means one thing only:
/// "an AI proposed this and it is waiting for a human".
enum Theme {
    // Surfaces
    static let paper = Color(hex: 0x0A0A0B)
    static let surface = Color(hex: 0x121214)
    static let surface2 = Color(hex: 0x19191C)
    static let surface3 = Color(hex: 0x222226)
    static let surface4 = Color(hex: 0x2C2C31)
    static let line = Color(hex: 0x26262B)
    static let lineStrong = Color(hex: 0x3A3A41)

    // Text
    static let ink = Color(hex: 0xEDEDEF)
    static let ink2 = Color(hex: 0xB4B4BB)
    static let muted = Color(hex: 0x85858E)

    // Accent
    static let cobalt = Color(hex: 0x8E98FF)
    static let cobaltInk = Color(hex: 0xB7BDFF)
    static let cobaltSoft = Color(hex: 0x1D1E33)
    static let cobaltSoft2 = Color(hex: 0x282A48)
    static let accentFg = Color(hex: 0x0A0A0B)

    // Primary action
    static let primary = Color(hex: 0xEDEDEF)
    static let primaryFg = Color(hex: 0x0A0A0B)

    // Status
    static let amber = Color(hex: 0xF3B65A)
    static let amberSoft = Color(hex: 0x2E2210)
    static let green = Color(hex: 0x4CC79D)
    static let greenSoft = Color(hex: 0x10261E)
    static let red = Color(hex: 0xF2786D)
    static let redSoft = Color(hex: 0x33171A)

    // Canvas
    static let canvas = Color(hex: 0x0D0D0F)
    static let canvasDot = Color(hex: 0x26262B)
    static let scrim = Color.black.opacity(0.62)

    // Shape
    static let rSm: CGFloat = 6
    static let rMd: CGFloat = 9
    static let rLg: CGFloat = 14

    // Motion (styles.css: --ease-out cubic-bezier(.2,.8,.2,1), --t-fast/med/slow)
    static let easeOut = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.36)
    static let fast = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.12)
    static let med = Animation.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.2)
    static let spring = Animation.spring(response: 0.32, dampingFraction: 0.86)
}

// MARK: - Typography

/// Bricolage Grotesque for display, Instrument Sans for body, JetBrains Mono for code (same as
/// the web). If the font files haven't been added (see ios/scripts/fetch-fonts.sh) the system
/// faces stand in, so the app still looks right.
enum ClaraFont {
    private static let display = "Bricolage Grotesque"
    private static let bodyFamily = "Instrument Sans"
    private static let monoFamily = "JetBrains Mono"
    private static let installed = Set(UIFont.familyNames)

    private static func uiWeight(_ w: Font.Weight) -> UIFont.Weight {
        switch w {
        case .ultraLight: .ultraLight
        case .thin: .thin
        case .light: .light
        case .medium: .medium
        case .semibold: .semibold
        case .bold: .bold
        case .heavy: .heavy
        case .black: .black
        default: .regular
        }
    }

    /// The family's face closest to `weight`. Variable fonts expose named instances, which
    /// descriptor matching picks by the weight trait.
    private static func ui(_ family: String, _ size: CGFloat, _ weight: Font.Weight) -> UIFont? {
        guard installed.contains(family) else { return nil }
        let d = UIFontDescriptor(fontAttributes: [.family: family, .traits: [UIFontDescriptor.TraitKey.weight: uiWeight(weight)]])
        return UIFont(descriptor: d, size: size)
    }

    static func display(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        ui(display, size, weight).map(Font.init) ?? .system(size: size, weight: weight)
    }

    static func body(_ size: CGFloat = 16, weight: Font.Weight = .regular) -> Font {
        ui(bodyFamily, size, weight).map(Font.init) ?? .system(size: size, weight: weight)
    }

    static func mono(_ size: CGFloat = 14, weight: Font.Weight = .regular) -> Font {
        ui(monoFamily, size, weight).map(Font.init) ?? .system(size: size, weight: weight, design: .monospaced)
    }

    static func uiMono(_ size: CGFloat) -> UIFont {
        ui(monoFamily, size, .regular) ?? .monospacedSystemFont(ofSize: size, weight: .regular)
    }
}

extension View {
    /// Page title: 32pt display, tight tracking (`.page-head h1`).
    func pageTitleStyle() -> some View {
        font(ClaraFont.display(30, weight: .bold)).tracking(-0.9).foregroundStyle(Theme.ink)
    }

    /// Section title (`.section-head h2`).
    func sectionTitleStyle() -> some View {
        font(ClaraFont.display(19, weight: .semibold)).tracking(-0.3).foregroundStyle(Theme.ink)
    }

    /// Small uppercase label (`.sidebar-section-label`, `.item-list-head`).
    func eyebrowStyle() -> some View {
        font(ClaraFont.body(12, weight: .semibold)).tracking(0.7).textCase(.uppercase).foregroundStyle(Theme.muted)
    }
}

// MARK: - Colour helpers

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: opacity)
    }

    /// Parses `#rgb`, `#rrggbb`, `#rrggbbaa` and `rgb(r,g,b)`; nil for anything else.
    init?(css: String) {
        let s = css.trimmingCharacters(in: .whitespaces).lowercased()
        if s.hasPrefix("#") {
            var h = String(s.dropFirst())
            if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
            guard h.count == 6 || h.count == 8, let v = UInt64(h, radix: 16) else { return nil }
            if h.count == 8 {
                self.init(.sRGB, red: Double((v >> 24) & 0xFF) / 255, green: Double((v >> 16) & 0xFF) / 255, blue: Double((v >> 8) & 0xFF) / 255, opacity: Double(v & 0xFF) / 255)
            } else {
                self.init(hex: UInt32(v))
            }
            return
        }
        if s.hasPrefix("rgb") {
            let nums = s.split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
            guard nums.count >= 3 else { return nil }
            self.init(.sRGB, red: nums[0] / 255, green: nums[1] / 255, blue: nums[2] / 255, opacity: nums.count > 3 ? nums[3] : 1)
            return
        }
        switch s {
        case "white": self.init(hex: 0xFFFFFF)
        case "black": self.init(hex: 0x000000)
        case "none", "transparent": self = .clear
        default: return nil
        }
    }
}
