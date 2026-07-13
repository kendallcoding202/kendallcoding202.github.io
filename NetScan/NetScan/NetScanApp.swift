import SwiftUI

@main
struct NetScanApp: App {
    @StateObject private var scanner = NetworkScanner()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(scanner)
                .tint(.blue)
        }
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            DeviceListView()
                .tabItem { Label("Overview", systemImage: "house.fill") }

            ToolsView()
                .tabItem { Label("Tools", systemImage: "wrench.and.screwdriver.fill") }
        }
    }
}
