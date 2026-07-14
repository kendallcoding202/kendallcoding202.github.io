import SwiftUI
import UIKit

@main
struct KovyrInteriorApp: App {
    @StateObject private var scanner = NetworkScanner()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        NotificationManager.shared.configure()
        BackgroundScan.register()
        Self.applyKovyrAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(scanner)
                .tint(Color.kovyrGold)
                .preferredColorScheme(.dark)
                .task { NotificationManager.shared.requestAuthorization() }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: BackgroundScan.schedule()
            case .active: NotificationManager.shared.clearBadge()
            default: break
            }
        }
    }

    /// Navy nav/tab bars with white titles, matching the app's theme.
    private static func applyKovyrAppearance() {
        let deep = UIColor(red: 9 / 255, green: 18 / 255, blue: 33 / 255, alpha: 1)

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = deep
        nav.titleTextAttributes = [.foregroundColor: UIColor.white]
        nav.largeTitleTextAttributes = [.foregroundColor: UIColor.white]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = deep
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}

struct RootView: View {
    @EnvironmentObject private var scanner: NetworkScanner
    @State private var selectedTab = Tab.overview

    private enum Tab: Hashable { case overview, tools, history, settings }

    var body: some View {
        TabView(selection: $selectedTab) {
            DeviceListView()
                .tabItem { Label("Overview", systemImage: "house.fill") }
                .tag(Tab.overview)

            ToolsView()
                .tabItem { Label("Tools", systemImage: "wrench.and.screwdriver.fill") }
                .tag(Tab.tools)

            HistoryView(store: scanner.store)
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
                .tag(Tab.history)

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                .tag(Tab.settings)
        }
        // Route notification taps into the scanner, and jump to Overview so the
        // deep-linked device is visible.
        .task {
            NotificationManager.shared.onOpenDevice = { ip in
                scanner.requestOpenDevice(ip: ip)
            }
        }
        .onChange(of: scanner.pendingOpenIP) { _, ip in
            if ip != nil { selectedTab = .overview }
        }
    }
}
