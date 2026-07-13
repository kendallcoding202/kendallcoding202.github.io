import SwiftUI

/// Kovyr brand palette. Navy (#1E3A5F) matches the external product's
/// `brand.json`; gold is the accent used for the "Kovyr" wordmark.
extension Color {
    /// Kovyr navy — primary brand color (#1E3A5F).
    static let kovyr = Color(red: 30 / 255, green: 58 / 255, blue: 95 / 255)

    /// Lighter steel-blue used for highlights and the top of gradients.
    static let kovyrAccent = Color(red: 74 / 255, green: 122 / 255, blue: 178 / 255)

    /// Deep navy — the dark end of backgrounds and the nav/tab bars.
    static let kovyrDeep = Color(red: 9 / 255, green: 18 / 255, blue: 33 / 255)

    /// Warm gold — the "Kovyr" wordmark and interactive accents.
    static let kovyrGold = Color(red: 214 / 255, green: 178 / 255, blue: 94 / 255)

    /// Top of the app background gradient (a touch lighter than navy).
    static let kovyrTop = Color(red: 36 / 255, green: 70 / 255, blue: 110 / 255)
}

/// Full-screen navy gradient background matching the app icon.
struct KovyrBackground: View {
    var body: some View {
        LinearGradient(
            colors: [.kovyrTop, .kovyrDeep],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }
}

/// The Kovyr wordmark: "Kovyr" in gold, the trailing word in white.
struct KovyrWordmark: View {
    var trailing: String = "Interior"
    var body: some View {
        HStack(spacing: 5) {
            Text("Kovyr").foregroundStyle(Color.kovyrGold)
            Text(trailing).foregroundStyle(.white)
        }
        .font(.headline.weight(.bold))
    }
}

extension View {
    /// Applies the Kovyr navy background and hides the default List/Form chrome
    /// so the gradient shows through. Text uses the dark color scheme, so it
    /// renders light automatically.
    func kovyrScreen() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(KovyrBackground())
    }
}
