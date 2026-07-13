import SwiftUI

@main
struct NetScanApp: App {
    @StateObject private var scanner = NetworkScanner()

    init() {
        NotificationManager.shared.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(scanner)
                .tint(.blue)
                .task { NotificationManager.shared.requestAuthorization() }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var scanner: NetworkScanner

    var body: some View {
        TabView {
            DeviceListView()
                .tabItem { Label("Overview", systemImage: "house.fill") }

            ToolsView()
                .tabItem { Label("Tools", systemImage: "wrench.and.screwdriver.fill") }

            HistoryView(store: scanner.store)
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
        }
    }
}
