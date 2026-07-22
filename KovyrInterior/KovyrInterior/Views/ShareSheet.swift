import SwiftUI
import UIKit

/// Thin SwiftUI wrapper over `UIActivityViewController` so a generated export
/// file can be shared / saved via the system share sheet.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
